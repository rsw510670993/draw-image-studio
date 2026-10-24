import http from 'node:http'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { chromium } from 'playwright'

const ROOT = '/var/www/html/draw'
const DATA = path.join(ROOT, 'data')
const SECRETS = path.join(DATA, 'secrets')
const PORT = Number(process.env.PORT ?? 30300)
const VERSION = '0.2.0'

fs.mkdirSync(SECRETS, { recursive: true, mode: 0o700 })
fs.mkdirSync(path.join(DATA, 'media'), { recursive: true })
fs.mkdirSync(path.join(DATA, 'thumbs'), { recursive: true })

/* ---------- crypto ---------- */
function loadMasterKey() {
  const file = path.join(SECRETS, 'master.key')
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, crypto.randomBytes(32), { mode: 0o600 })
  }
  return fs.readFileSync(file)
}
const KEY = loadMasterKey()

function seal(value) {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv)
  const ct = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64')
}

function unseal(sealed) {
  const raw = Buffer.from(sealed, 'base64')
  const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, raw.subarray(0, 12))
  decipher.setAuthTag(raw.subarray(12, 28))
  const plain = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()])
  return JSON.parse(plain.toString('utf8'))
}

/* ---------- storage ---------- */
const db = new DatabaseSync(path.join(DATA, 'studio.db'))
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS accounts (
    provider TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS prompts (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    text TEXT NOT NULL,
    tags TEXT NOT NULL DEFAULT '',
    favorite INTEGER NOT NULL DEFAULT 0,
    use_count INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS images (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    prompt TEXT NOT NULL,
    ratio TEXT,
    path TEXT NOT NULL,
    bytes INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    favorite INTEGER NOT NULL DEFAULT 0,
    deleted_at INTEGER
  );
`)

const readAccount = provider => {
  const row = db.prepare('SELECT payload, updated_at FROM accounts WHERE provider = ?').get(provider)
  if (!row) return null
  return { ...unseal(row.payload), updatedAt: row.updated_at }
}
const writeAccount = (provider, blob) => {
  db.prepare('INSERT INTO accounts (provider, payload, updated_at) VALUES (?, ?, ?) ON CONFLICT(provider) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at')
    .run(provider, seal(blob), Date.now())
}
const deleteAccount = provider => db.prepare('DELETE FROM accounts WHERE provider = ?').run(provider)

/* ---------- chatgpt / codex subscription ---------- */
const CODEX = {
  clientId: 'app_EMoamEEZ73f0CkXaXp7hrann',
  redirectUri: 'http://localhost:1455/auth/callback',
  authUrl: 'https://auth.openai.com/oauth/authorize',
  tokenUrl: 'https://auth.openai.com/oauth/token',
  scope: 'openid profile email offline_access api.connectors.read api.connectors.invoke',
  imageUrl: 'https://chatgpt.com/backend-api/codex/images/generations',
  imageEditUrl: 'https://chatgpt.com/backend-api/codex/images/edits',
  imageModel: 'gpt-image-2.5-flare',
}

const DEVICE = {
  userCodeUrl: 'https://auth.openai.com/api/accounts/deviceauth/usercode',
  tokenUrl: 'https://auth.openai.com/api/accounts/deviceauth/token',
  authUrl: 'https://auth.openai.com/codex/device',
  redirectUri: 'https://auth.openai.com/deviceauth/callback',
}

const JIMENG_BASE = 'http://127.0.0.1:30301'

const b64url = buf => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')

const pendings = new Map()
const PENDING_TTL = 15 * 60 * 1000

function decodeJwt(token) {
  try {
    const part = String(token).split('.')[1]
    if (!part) return {}
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'))
  } catch {
    return {}
  }
}

function accountIdOf(claims, fallback = '') {
  if (typeof claims.chatgpt_account_id === 'string') return claims.chatgpt_account_id
  const nested = claims['https://api.openai.com/auth']
  if (nested && typeof nested === 'object' && typeof nested.chatgpt_account_id === 'string') return nested.chatgpt_account_id
  return fallback
}

function loginStart() {
  const verifier = b64url(crypto.randomBytes(32))
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest())
  const state = b64url(crypto.randomBytes(16))
  pendings.set(state, { verifier, createdAt: Date.now() })
  const url = new URL(CODEX.authUrl)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', CODEX.clientId)
  url.searchParams.set('redirect_uri', CODEX.redirectUri)
  url.searchParams.set('scope', CODEX.scope)
  url.searchParams.set('code_challenge', challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('state', state)
  url.searchParams.set('id_token_add_organizations', 'true')
  url.searchParams.set('codex_cli_simplified_flow', 'true')
  url.searchParams.set('originator', 'codex_cli_rs')
  return { authorizeUrl: url.toString(), state, redirectUri: CODEX.redirectUri }
}

async function loginComplete({ callback, state: givenState, code: givenCode }) {
  let code = givenCode
  let state = givenState
  if (callback) {
    const url = new URL(callback)
    const err = url.searchParams.get('error')
    if (err) {
      const desc = url.searchParams.get('error_description') ?? ''
      throw new Error(`授权被拒绝：${err} ${desc}`.trim())
    }
    code = url.searchParams.get('code') ?? code
    state = url.searchParams.get('state') ?? state
  }
  if (!code) throw new Error('没有拿到 code，请粘贴授权后跳转的完整地址')
  if (!state) throw new Error('缺少 state，请回到设置页重新发起登录')
  const pending = pendings.get(state)
  if (!pending || Date.now() - pending.createdAt > PENDING_TTL) {
    throw new Error('登录会话已过期，请重新点击「登录 ChatGPT」')
  }

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: CODEX.clientId,
    code,
    redirect_uri: CODEX.redirectUri,
    code_verifier: pending.verifier,
  })
  const res = await fetch(CODEX.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body,
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    const detail = json.error_description ?? json.error ?? `HTTP ${res.status}`
    throw new Error(`换取 token 失败：${String(detail).slice(0, 200)}`)
  }
  const claims = decodeJwt(json.id_token)
  const accountId = accountIdOf(claims)
  const blob = {
    accessToken: json.access_token ?? '',
    refreshToken: json.refresh_token ?? '',
    expiresAt: Date.now() + (Number(json.expires_in) || 3600) * 1000,
    accountId,
    email: claims.email ?? '',
    label: claims.email ?? 'ChatGPT',
  }
  writeAccount('chatgpt', blob)
  pendings.delete(state)
  return { email: blob.email, accountId, expiresAt: blob.expiresAt }
}

async function ensureFresh(blob) {
  if (!blob.refreshToken || blob.expiresAt - 60_000 > Date.now()) return blob
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: CODEX.clientId,
    refresh_token: blob.refreshToken,
  })
  const res = await fetch(CODEX.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body,
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`刷新 token 失败：${json.error ?? `HTTP ${res.status}`}`)
  const claims = decodeJwt(json.id_token ?? '')
  const next = {
    ...blob,
    accessToken: json.access_token ?? blob.accessToken,
    refreshToken: json.refresh_token ?? blob.refreshToken,
    expiresAt: Date.now() + (Number(json.expires_in) || 3600) * 1000,
    accountId: accountIdOf(claims, blob.accountId),
    email: claims.email ?? blob.email,
  }
  writeAccount('chatgpt', next)
  return next
}

const SIZE_TABLE = {
  '1:1': '1024x1024',
  '3:2': '1536x1024',
  '2:3': '1024x1536',
  '4:3': '1152x864',
  '3:4': '864x1152',
  '16:9': '1536x864',
  '9:16': '864x1536',
}

function imageExt(buffer) {
  if (buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpg'
  if (buffer.length > 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'png'
  if (buffer.length > 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'webp'
  if (buffer.length > 2 && buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) return 'gif'
  return 'png'
}

function saveImageBuffer(buffer, meta) {
  const now = new Date()
  const year = String(now.getFullYear())
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const dir = path.join(DATA, 'media', year, month)
  fs.mkdirSync(dir, { recursive: true })
  const id = crypto.randomUUID()
  const ext = imageExt(buffer)
  fs.writeFileSync(path.join(dir, `${id}.${ext}`), buffer)
  db.prepare('INSERT INTO images (id, provider, model, prompt, ratio, path, bytes, created_at, favorite) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)')
    .run(id, meta.provider, meta.model, meta.prompt, meta.ratio ?? '', path.join(year, month, `${id}.${ext}`), buffer.length, Date.now())
  return { id, url: `/draw/media/${year}/${month}/${id}.${ext}`, bytes: buffer.length, ratio: meta.ratio }
}

async function generateImage({ prompt, ratio, size, quality }) {
  let blob = readAccount('chatgpt')
  if (!blob) throw new Error('尚未登录 ChatGPT，请先在设置里登录')
  if (typeof prompt !== 'string' || prompt.trim().length === 0) throw new Error('提示词不能为空')
  blob = await ensureFresh(blob)
  const wireSize = size ?? SIZE_TABLE[ratio] ?? '1024x1024'
  const RATIO_HINT = {
    '1:1': '正方形构图',
    '3:2': '横向宽幅构图',
    '2:3': '竖向构图',
    '4:3': '横向构图',
    '3:4': '竖向构图',
    '16:9': '超宽横向构图',
    '9:16': '超长竖向构图',
  }
  const wirePrompt = `${prompt.trim()}\n\n输出图片的画布宽高比必须为${ratio}，${RATIO_HINT[ratio] ?? ''}，完整画面铺满画布。`
  const res = await fetch(CODEX.imageUrl, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${blob.accessToken}`,
      'chatgpt-account-id': blob.accountId,
      originator: 'codex_cli_rs',
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      prompt: wirePrompt,
      model: CODEX.imageModel,
      size: wireSize,
      ...(quality ? { quality } : {}),
    }),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    const detail = json?.error?.message ?? json?.error ?? JSON.stringify(json).slice(0, 300)
    throw new Error(`ChatGPT 生成失败 HTTP ${res.status}: ${detail}`)
  }
  const rows = Array.isArray(json.data) ? json.data : []
  const images = []
  for (const row of rows) {
    if (typeof row?.b64_json === 'string' && row.b64_json.length > 0) {
      images.push(saveImageBuffer(Buffer.from(row.b64_json, 'base64'), { provider: 'chatgpt', model: CODEX.imageModel, prompt: prompt.trim(), ratio }))
    } else if (typeof row?.url === 'string') {
      const media = await fetch(row.url)
      const buffer = Buffer.from(await media.arrayBuffer())
      images.push(saveImageBuffer(buffer, { provider: 'chatgpt', model: CODEX.imageModel, prompt: prompt.trim(), ratio }))
    }
  }
  if (images.length === 0) throw new Error(`ChatGPT 未返回图片：${JSON.stringify(json).slice(0, 300)}`)
  return { images }
}

function listPrompts({ q, favoriteOnly }) {
  let rows = db.prepare('SELECT id, title, text, tags, favorite, use_count, created_at, updated_at FROM prompts ORDER BY updated_at DESC LIMIT 500').all()
  if (favoriteOnly) rows = rows.filter(row => row.favorite === 1)
  if (q && q.trim()) {
    const needle = q.trim().toLowerCase()
    rows = rows.filter(row => (row.title + ' ' + row.text + ' ' + row.tags).toLowerCase().includes(needle))
  }
  return rows.map(row => ({
    id: row.id,
    title: row.title,
    text: row.text,
    tags: row.tags,
    favorite: row.favorite === 1,
    useCount: row.use_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }))
}

function savePrompt({ id, title, text, tags }) {
  const cleanText = typeof text === 'string' ? text.trim() : ''
  if (!cleanText) throw new Error('提示词不能为空')
  const cleanTitle = typeof title === 'string' && title.trim() ? title.trim() : cleanText.slice(0, 24)
  const cleanTags = typeof tags === 'string' ? tags.trim() : ''
  const now = Date.now()
  if (id) {
    const existing = db.prepare('SELECT id FROM prompts WHERE id = ?').get(id)
    if (!existing) throw new Error('提示词不存在')
    db.prepare('UPDATE prompts SET title = ?, text = ?, tags = ?, updated_at = ? WHERE id = ?')
      .run(cleanTitle, cleanText, cleanTags, now, id)
    return { id }
  }
  const nextId = crypto.randomUUID()
  db.prepare('INSERT INTO prompts (id, title, text, tags, favorite, use_count, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 0, ?, ?)')
    .run(nextId, cleanTitle, cleanText, cleanTags, now, now)
  return { id: nextId }
}

function listImages(limit = 60) {
  const rows = db.prepare('SELECT id, provider, model, prompt, ratio, path, bytes, created_at, favorite FROM images WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT ?').all(limit)
  return rows.map(row => ({
    id: row.id,
    provider: row.provider,
    model: row.model,
    prompt: row.prompt,
    ratio: row.ratio,
    bytes: row.bytes,
    favorite: row.favorite === 1,
    createdAt: row.created_at,
    url: `/draw/media/${row.path}`,
  }))
}

async function deviceStart() {
  const res = await fetch(DEVICE.userCodeUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ client_id: CODEX.clientId }),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok || typeof json.user_code !== 'string' || typeof json.device_auth_id !== 'string') {
    throw new Error(`申请设备码失败：${json?.error?.message ?? `HTTP ${res.status}`}`)
  }
  return {
    userCode: json.user_code,
    deviceAuthId: json.device_auth_id,
    intervalMs: Math.max(Number(json.interval) || 5, 1) * 1000,
    verificationUrl: DEVICE.authUrl,
    expiresAt: json.expires_at ?? null,
  }
}

async function devicePoll({ deviceAuthId, userCode }) {
  if (!deviceAuthId || !userCode) throw new Error('缺少设备码参数')
  const res = await fetch(DEVICE.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ device_auth_id: deviceAuthId, user_code: userCode }),
  })
  // 403/404 = 用户还没确认授权
  if (res.status === 403 || res.status === 404) return { status: 'pending' }
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`设备码轮询失败：${json?.error?.message ?? `HTTP ${res.status}`}`)
  if (typeof json.authorization_code !== 'string' || typeof json.code_verifier !== 'string') {
    throw new Error('设备码授权响应不完整')
  }
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: CODEX.clientId,
    code: json.authorization_code,
    redirect_uri: DEVICE.redirectUri,
    code_verifier: json.code_verifier,
  })
  const tokenRes = await fetch(CODEX.tokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body,
  })
  const tokenJson = await tokenRes.json().catch(() => ({}))
  if (!tokenRes.ok) {
    throw new Error(`换取 token 失败：${tokenJson.error_description ?? tokenJson.error ?? `HTTP ${tokenRes.status}`}`)
  }
  const claims = decodeJwt(tokenJson.id_token ?? '')
  const blob = {
    accessToken: tokenJson.access_token ?? '',
    refreshToken: tokenJson.refresh_token ?? '',
    expiresAt: Date.now() + (Number(tokenJson.expires_in) || 3600) * 1000,
    accountId: accountIdOf(claims),
    email: claims.email ?? '',
    label: claims.email ?? 'ChatGPT',
  }
  if (!blob.accessToken) throw new Error('设备码授权后未拿到 access token')
  writeAccount('chatgpt', blob)
  return { status: 'connected', email: blob.email, expiresAt: blob.expiresAt }
}

function normalizeSession(input) {
  let value = String(input ?? '').trim()
  if (!value) throw new Error('sessionid 不能为空')
  if (/^cookie:/i.test(value)) value = value.slice(7).trim()
  const match = value.match(/sessionid=([^;\s]+)/i)
  if (match) value = match[1].replace(/^["']|["']$/g, '')
  return value
}

async function fetchJimengStatus(sessionid) {
  const res = await fetch(`${JIMENG_BASE}/v1/account/status`, {
    headers: { authorization: `Bearer ${sessionid}`, accept: 'application/json' },
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    const detail = json?.message ?? json?.error ?? `HTTP ${res.status}`
    throw new Error(`即梦 sessionid 校验失败：${detail}`)
  }
  if (typeof json?.code === 'number' && json.code !== 0) {
    throw new Error(`即梦 sessionid 校验失败：${json.message ?? `code ${json.code}`}`)
  }
  const status = json?.account?.status ?? {}
  if (typeof status.totalCredit !== 'number') {
    throw new Error('即梦 sessionid 校验失败：返回数据缺少积分信息，可能已过期')
  }
  return {
    points: typeof status.totalCredit === 'number' ? status.totalCredit : null,
    giftPoints: typeof status.giftCredit === 'number' ? status.giftCredit : null,
    vipPoints: typeof status.vipCredit === 'number' ? status.vipCredit : null,
    membership: status.membership ?? null,
  }
}

async function jimengStatus() {
  const blob = readAccount('jimeng')
  if (!blob?.sessionid) return { provider: 'jimeng', connected: false }
  try {
    const info = await fetchJimengStatus(blob.sessionid)
    return { provider: 'jimeng', connected: true, label: blob.label ?? '', ...info }
  } catch (error) {
    return { provider: 'jimeng', connected: false, label: blob.label ?? '', error: error.message }
  }
}

async function jimengLogin(input) {
  const sessionid = normalizeSession(input)
  const info = await fetchJimengStatus(sessionid)
  writeAccount('jimeng', { sessionid, label: info.membership ?? '即梦账号', updatedAt: Date.now() })
  return { provider: 'jimeng', connected: true, ...info }
}

const qrSessions = new Map()
const QR_TTL = 5 * 60 * 1000

async function captureJimengQr(popup) {
  const el = popup.locator('img.semi-image-img').first()
  if (await el.count()) {
    const box = await el.boundingBox().catch(() => null)
    if (box && box.width > 120) {
      const buffer = await el.screenshot().catch(() => null)
      if (buffer) return buffer
    }
  }
  return popup.screenshot({ clip: { x: 108, y: 200, width: 186, height: 186 } })
}

async function closeQrSession(session) {
  if (!session) return
  await session.browser.close().catch(() => {})
}

async function jimengQrStart() {
  for (const [id, existing] of qrSessions) {
    qrSessions.delete(id)
    await closeQrSession(existing)
  }
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] })
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'zh-CN' })
    const page = await context.newPage()
    await page.goto('https://jimeng.jianying.com/ai-tool/home', { waitUntil: 'domcontentloaded', timeout: 45000 })
    await page.waitForTimeout(4000)
    await page.getByText('登录', { exact: true }).first().click({ timeout: 10000 })
    await page.waitForTimeout(1800)
    await page.getByText('已阅读并同意').click({ timeout: 5000 }).catch(() => {})
    const popupPromise = context.waitForEvent('page', { timeout: 12000 }).catch(() => null)
    await page.mouse.click(886, 625)
    const popup = await popupPromise
    if (!popup) throw new Error('未能打开抖音扫码窗口，请重试')
    await popup.waitForLoadState('domcontentloaded').catch(() => {})
    await popup.waitForTimeout(4000)
    const qr = await captureJimengQr(popup)
    const sessionId = crypto.randomUUID()
    qrSessions.set(sessionId, { browser, context, page, popup, createdAt: Date.now() })
    return { sessionId, qr: `data:image/png;base64,${qr.toString('base64')}` }
  } catch (error) {
    await browser.close().catch(() => {})
    throw error
  }
}

async function jimengQrStatus(sessionId) {
  const session = qrSessions.get(sessionId)
  if (!session) return { status: 'expired' }
  if (Date.now() - session.createdAt > QR_TTL) {
    qrSessions.delete(sessionId)
    await closeQrSession(session)
    return { status: 'expired' }
  }
  const cookies = await session.context.cookies().catch(() => [])
  const hit = cookies.find(c => c.name === 'sessionid_ss' && c.value) || cookies.find(c => c.name === 'sessionid' && c.value)
  if (!hit) return { status: 'pending' }
  try {
    const info = await fetchJimengStatus(hit.value)
    writeAccount('jimeng', { sessionid: hit.value, label: info.membership ?? '即梦账号', updatedAt: Date.now() })
    qrSessions.delete(sessionId)
    await closeQrSession(session)
    return { status: 'connected', ...info }
  } catch (error) {
    qrSessions.delete(sessionId)
    await closeQrSession(session)
    return { status: 'error', error: error.message }
  }
}

async function jimengQrCancel(sessionId) {
  const session = qrSessions.get(sessionId)
  if (session) {
    qrSessions.delete(sessionId)
    await closeQrSession(session)
  }
  return { ok: true }
}

async function generateJimeng({ prompt, model, ratio, resolution, count }) {
  const blob = readAccount('jimeng')
  if (!blob?.sessionid) throw new Error('尚未接入即梦，请先在设置里保存 sessionid')
  if (typeof prompt !== 'string' || prompt.trim().length === 0) throw new Error('提示词不能为空')
  const wireModel = model || 'jimeng-image-5.0-lite'
  const body = {
    model: wireModel,
    prompt: prompt.trim(),
    ratio: ratio || '1:1',
    resolution: resolution || '2k',
    n: Math.min(Math.max(Number(count) || 1, 1), 8),
  }
  const res = await fetch(`${JIMENG_BASE}/v1/images/generations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json', authorization: `Bearer ${blob.sessionid}` },
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    const detail = json?.message ?? json?.error?.message ?? json?.error ?? `HTTP ${res.status}`
    throw new Error(`即梦生成失败：${detail}`)
  }
  const rows = Array.isArray(json.data) ? json.data : []
  const images = []
  for (const row of rows) {
    if (typeof row?.url === 'string') {
      const media = await fetch(row.url)
      if (!media.ok) continue
      const buffer = Buffer.from(await media.arrayBuffer())
      images.push(saveImageBuffer(buffer, { provider: 'jimeng', model: wireModel, prompt: prompt.trim(), ratio: body.ratio }))
    } else if (typeof row?.b64_json === 'string' && row.b64_json.length > 0) {
      images.push(saveImageBuffer(Buffer.from(row.b64_json, 'base64'), { provider: 'jimeng', model: wireModel, prompt: prompt.trim(), ratio: body.ratio }))
    }
  }
  if (images.length === 0) throw new Error('即梦未返回图片，请检查积分或账号状态')
  return { images }
}

function accountStatus() {
  const blob = readAccount('chatgpt')
  if (!blob) return { provider: 'chatgpt', connected: false }
  return {
    provider: 'chatgpt',
    connected: true,
    email: blob.email,
    accountId: blob.accountId,
    expiresAt: blob.expiresAt,
    expired: blob.expiresAt < Date.now(),
    model: CODEX.imageModel,
  }
}

/* ---------- http ---------- */
function sendJson(res, status, data) {
  const body = JSON.stringify(data)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', chunk => {
      size += chunk.length
      if (size > 1_000_000) {
        reject(new Error('请求体过大'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (chunks.length === 0) return resolve({})
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        reject(new Error('请求体不是合法 JSON'))
      }
    })
    req.on('error', reject)
  })
}

setInterval(async () => {
  const now = Date.now()
  for (const [id, session] of qrSessions) {
    if (now - session.createdAt > QR_TTL) {
      qrSessions.delete(id)
      await closeQrSession(session)
    }
  }
}, 60 * 1000).unref()

setInterval(() => {
  const now = Date.now()
  for (const [state, pending] of pendings) {
    if (now - pending.createdAt > PENDING_TTL) pendings.delete(state)
  }
}, 5 * 60 * 1000).unref()

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const route = url.pathname.replace(/\/+$/, '') || '/'
  const method = req.method ?? 'GET'

  try {
    if (method === 'GET' && (route === '/health' || route === '/')) {
      return sendJson(res, 200, { ok: true, version: VERSION })
    }

    if (method === 'GET' && route === '/account/status') {
      return sendJson(res, 200, accountStatus())
    }

    if (method === 'GET' && route === '/account/jimeng/status') {
      return sendJson(res, 200, await jimengStatus())
    }

    if (method === 'POST' && route === '/account/jimeng/qr/start') {
      return sendJson(res, 200, await jimengQrStart())
    }

    if (method === 'GET' && route === '/account/jimeng/qr/status') {
      return sendJson(res, 200, await jimengQrStatus(url.searchParams.get('session') ?? ''))
    }

    if (method === 'POST' && route === '/account/jimeng/qr/cancel') {
      const body = await readBody(req)
      return sendJson(res, 200, await jimengQrCancel(String(body.sessionId ?? '')))
    }

    if (method === 'POST' && route === '/account/jimeng/login') {
      const body = await readBody(req)
      return sendJson(res, 200, await jimengLogin(body.sessionid))
    }

    if (method === 'POST' && route === '/account/jimeng/logout') {
      deleteAccount('jimeng')
      return sendJson(res, 200, { ok: true })
    }

    if (method === 'POST' && route === '/account/chatgpt/device/start') {
      return sendJson(res, 200, await deviceStart())
    }

    if (method === 'POST' && route === '/account/chatgpt/device/poll') {
      const body = await readBody(req)
      return sendJson(res, 200, await devicePoll({
        deviceAuthId: typeof body.deviceAuthId === 'string' ? body.deviceAuthId : '',
        userCode: typeof body.userCode === 'string' ? body.userCode : '',
      }))
    }

    if (method === 'POST' && route === '/account/chatgpt/login/start') {
      return sendJson(res, 200, loginStart())
    }

    if (method === 'POST' && route === '/account/chatgpt/login/complete') {
      const body = await readBody(req)
      const result = await loginComplete({
        callback: typeof body.callback === 'string' ? body.callback.trim() : '',
        state: typeof body.state === 'string' ? body.state.trim() : '',
        code: typeof body.code === 'string' ? body.code.trim() : '',
      })
      return sendJson(res, 200, { ok: true, ...result })
    }

    if (method === 'POST' && route === '/generate') {
      const body = await readBody(req)
      if (body.channel === 'jimeng') {
        const result = await generateJimeng({
          prompt: body.prompt,
          model: typeof body.model === 'string' ? body.model : undefined,
          ratio: typeof body.ratio === 'string' ? body.ratio : '1:1',
          resolution: typeof body.resolution === 'string' ? body.resolution : '2k',
          count: Number(body.count) || 1,
        })
        return sendJson(res, 200, result)
      }
      const result = await generateImage({
        prompt: body.prompt,
        ratio: typeof body.ratio === 'string' ? body.ratio : '1:1',
        size: typeof body.size === 'string' ? body.size : undefined,
        quality: typeof body.quality === 'string' ? body.quality : undefined,
      })
      return sendJson(res, 200, result)
    }

    if (method === 'GET' && route === '/prompts') {
      return sendJson(res, 200, {
        prompts: listPrompts({
          q: url.searchParams.get('q') ?? '',
          favoriteOnly: url.searchParams.get('favorite') === '1',
        }),
      })
    }

    if (method === 'POST' && route === '/prompts/save') {
      const body = await readBody(req)
      return sendJson(res, 200, { ok: true, ...savePrompt({ id: body.id, title: body.title, text: body.text, tags: body.tags }) })
    }

    if (method === 'POST' && route === '/prompts/delete') {
      const body = await readBody(req)
      db.prepare('DELETE FROM prompts WHERE id = ?').run(String(body.id ?? ''))
      return sendJson(res, 200, { ok: true })
    }

    if (method === 'POST' && route === '/prompts/favorite') {
      const body = await readBody(req)
      const row = db.prepare('SELECT favorite FROM prompts WHERE id = ?').get(String(body.id ?? ''))
      if (!row) throw new Error('提示词不存在')
      const next = row.favorite === 1 ? 0 : 1
      db.prepare('UPDATE prompts SET favorite = ?, updated_at = ? WHERE id = ?').run(next, Date.now(), body.id)
      return sendJson(res, 200, { ok: true, favorite: next === 1 })
    }

    if (method === 'POST' && route === '/prompts/use') {
      const body = await readBody(req)
      db.prepare('UPDATE prompts SET use_count = use_count + 1 WHERE id = ?').run(String(body.id ?? ''))
      return sendJson(res, 200, { ok: true })
    }

    if (method === 'GET' && route === '/images') {
      const limit = Math.min(Number(url.searchParams.get('limit') ?? 60) || 60, 200)
      return sendJson(res, 200, { images: listImages(limit) })
    }

    if (method === 'POST' && route === '/images/favorite') {
      const body = await readBody(req)
      const row = db.prepare('SELECT favorite FROM images WHERE id = ?').get(String(body.id ?? ''))
      if (!row) throw new Error('图片不存在')
      const next = row.favorite === 1 ? 0 : 1
      db.prepare('UPDATE images SET favorite = ? WHERE id = ?').run(next, body.id)
      return sendJson(res, 200, { ok: true, favorite: next === 1 })
    }

    if (method === 'POST' && route === '/images/delete') {
      const body = await readBody(req)
      db.prepare('UPDATE images SET deleted_at = ? WHERE id = ?').run(Date.now(), String(body.id ?? ''))
      return sendJson(res, 200, { ok: true })
    }

    if (method === 'POST' && route === '/account/chatgpt/logout') {
      deleteAccount('chatgpt')
      return sendJson(res, 200, { ok: true })
    }

    if (method === 'POST' && route === '/account/chatgpt/refresh') {
      const blob = readAccount('chatgpt')
      if (!blob) return sendJson(res, 400, { error: '尚未登录 ChatGPT' })
      const next = await ensureFresh(blob)
      return sendJson(res, 200, { ok: true, expiresAt: next.expiresAt })
    }

    return sendJson(res, 404, { error: 'not found' })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(new Date().toISOString(), method, url.pathname, '-', message)
    return sendJson(res, 400, { error: message })
  }
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`draw-api listening on 127.0.0.1:${PORT} (${VERSION})`)
})
