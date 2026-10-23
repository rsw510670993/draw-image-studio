import { useEffect, useState } from 'react'
import { CheckCircle2, Copy, ExternalLink, HardDrive, KeyRound, Loader2, LogOut, RefreshCw, Sparkles } from 'lucide-react'
import type { Img } from '../data'
import {
  completeChatgptLogin,
  logoutChatgpt,
  pollChatgptDevice,
  startChatgptDevice,
  startChatgptLogin,
  type AccountStatus,
  type DeviceStart,
  type LoginStart,
} from '../api'

interface Props {
  images: Img[]
  onToast: (text: string) => void
  account: AccountStatus | null
  onRefreshAccount: () => void
}

const fmt = (ts?: number) =>
  ts === undefined ? '—' : new Date(ts).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })

export default function SettingsPage({ images, onToast, account, onRefreshAccount }: Props) {
  const [device, setDevice] = useState<DeviceStart | null>(null)
  const [pending, setPending] = useState<LoginStart | null>(null)
  const [callback, setCallback] = useState('')
  const [busy, setBusy] = useState<'start' | 'complete' | 'manual' | null>(null)
  const [error, setError] = useState('')

  const bytes = images.reduce((sum, img) => sum + (img.bytes ?? 0), 0)
  const usedGb = bytes / 1e9
  const pct = Math.min(100, Math.round((usedGb / 5) * 100))

  // 设备码轮询：pending 时每 interval 拉一次，授权成功自动收尾
  useEffect(() => {
    if (!device) return
    let stopped = false
    const timer = window.setInterval(async () => {
      try {
        const res = await pollChatgptDevice(device.deviceAuthId, device.userCode)
        if (stopped) return
        if (res.status === 'connected') {
          window.clearInterval(timer)
          setDevice(null)
          setError('')
          onToast(`ChatGPT 已连接：${res.email || '账号'}`)
          onRefreshAccount()
        }
      } catch (err) {
        if (stopped) return
        window.clearInterval(timer)
        setError((err as Error).message)
      }
    }, Math.max(device.intervalMs, 3000))
    return () => {
      stopped = true
      window.clearInterval(timer)
    }
  }, [device, onToast, onRefreshAccount])

  const beginDevice = async () => {
    setBusy('start')
    setError('')
    try {
      setDevice(await startChatgptDevice())
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const beginManual = async () => {
    setBusy('manual')
    setError('')
    try {
      setPending(await startChatgptLogin())
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const complete = async () => {
    if (!pending) return
    setBusy('complete')
    setError('')
    try {
      const res = await completeChatgptLogin(callback.trim(), pending.state)
      onToast(`ChatGPT 已连接：${res.email || '账号'}`)
      setPending(null)
      setCallback('')
      onRefreshAccount()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const cancelDevice = () => {
    setDevice(null)
    setError('')
  }

  const copyCode = async () => {
    if (!device) return
    try {
      await navigator.clipboard.writeText(device.userCode)
      onToast('验证码已复制')
    } catch {
      onToast('复制失败，请长按代码手动复制')
    }
  }

  const copyLink = async () => {
    if (!pending) return
    try {
      await navigator.clipboard.writeText(pending.authorizeUrl)
      onToast('授权链接已复制')
    } catch {
      onToast('复制失败，请长按链接手动复制')
    }
  }

  const signOut = async () => {
    try {
      await logoutChatgpt()
      onRefreshAccount()
      onToast('已登出 ChatGPT')
    } catch (err) {
      onToast((err as Error).message)
    }
  }

  return (
    <div className="settings">
      <section className="panel settings-card">
        <header className="card-head">
          <div>
            <h2>生成通道</h2>
            <p>两个订阅通道互相独立，单条失败不影响另一条。</p>
          </div>
        </header>

        <div className="channel-row">
          <div className="channel-box">
            <div className="channel-top">
              <span className="seg-dot jimeng" />
              <b>即梦 · 订阅</b>
              <span className="state ok"><CheckCircle2 size={13} /> 演示</span>
            </div>
            <dl className="channel-meta">
              <div><dt>账号</dt><dd>待接入 sessionid</dd></div>
              <div><dt>积分</dt><dd>66 / 66（每日赠送）</dd></div>
              <div><dt>会话</dt><dd>预计 6 天后过期</dd></div>
            </dl>
            <button className="btn-soft" onClick={() => onToast('即梦通道接入后启用')}>
              <KeyRound size={14} /> 接入即梦
            </button>
          </div>

          <div className="channel-box">
            <div className="channel-top">
              <span className="seg-dot gpt" />
              <b>ChatGPT · 订阅</b>
              <span className={account?.connected ? 'state ok' : 'state'}>
                {account?.connected ? <><CheckCircle2 size={13} /> 已连接</> : <><RefreshCw size={13} /> 未连接</>}
              </span>
            </div>
            <dl className="channel-meta">
              <div><dt>账号</dt><dd>{account?.email || '—'}</dd></div>
              <div><dt>通道</dt><dd>codex images · {account?.model || 'gpt-image-2.5'}</dd></div>
              <div><dt>计费</dt><dd>订阅额度内</dd></div>
            </dl>

            {account?.connected ? (
              <div className="login-connected">
                <span className="muted">
                  {account.expired ? 'token 已过期，下次使用时自动刷新' : `token 有效至 ${fmt(account.expiresAt)}`}
                </span>
                <button className="btn-soft" onClick={signOut}><LogOut size={14} /> 登出</button>
              </div>
            ) : device ? (
              <div className="device-flow">
                <span className="device-label">在手机或电脑浏览器打开下面的页面，输入此验证码并授权：</span>
                <div className="device-code-row">
                  <code className="device-code">{device.userCode}</code>
                  <button className="icon-btn" onClick={copyCode} title="复制验证码"><Copy size={14} /></button>
                </div>
                <a className="device-link" href={device.verificationUrl} target="_blank" rel="noreferrer">
                  {device.verificationUrl.replace('https://', '')} <ExternalLink size={12} />
                </a>
                <div className="device-status">
                  <Loader2 size={13} className="spin" />
                  <span>等待授权…授权后会自动完成，无需再复制任何链接</span>
                  <button className="ghost-btn" onClick={cancelDevice}>取消</button>
                </div>
                {error && <p className="login-error">{error}</p>}
              </div>
            ) : pending ? (
              <div className="login-flow">
                <div className="login-step">
                  <b>1</b>
                  <span>
                    打开授权页，登录并授权：
                    <a className="login-link" href={pending.authorizeUrl} target="_blank" rel="noreferrer">
                      打开 OpenAI 授权页 <ExternalLink size={11} />
                    </a>
                  </span>
                </div>
                <div className="login-step">
                  <b>2</b>
                  <span>
                    授权后浏览器会跳到 <code>localhost:1455</code> 打不开的页面，这是正常的。复制地址栏整条链接粘到下面：
                  </span>
                </div>
                <textarea
                  className="login-textarea"
                  value={callback}
                  onChange={e => setCallback(e.target.value)}
                  placeholder="http://localhost:1455/auth/callback?code=...&state=..."
                />
                <div className="login-actions">
                  <button className="btn-soft" onClick={copyLink}><Copy size={14} /> 复制链接</button>
                  <button className="btn-soft" onClick={complete} disabled={!callback.trim() || busy === 'complete'}>
                    {busy === 'complete' ? <Loader2 size={14} className="spin" /> : <CheckCircle2 size={14} />} 完成登录
                  </button>
                  <button className="ghost-btn" onClick={() => { setPending(null); setCallback(''); setError('') }}>取消</button>
                </div>
                {error && <p className="login-error">{error}</p>}
              </div>
            ) : (
              <>
                <button className="btn-soft" onClick={beginDevice} disabled={busy === 'start'}>
                  {busy === 'start' ? <Loader2 size={14} className="spin" /> : <KeyRound size={14} />} 登录 ChatGPT
                </button>
                <p className="login-hint">
                  推荐方式：点登录后会出一串 8 位验证码，手机打开 <code>auth.openai.com/codex/device</code> 输入即可，无需复制 localhost 链接。
                </p>
                <details className="manual-login">
                  <summary>或使用旧的手动粘贴回调链接</summary>
                  <button className="ghost-btn" onClick={beginManual} disabled={busy === 'manual'}>
                    {busy === 'manual' ? <Loader2 size={14} className="spin" /> : null} 生成授权链接
                  </button>
                </details>
                {error && <p className="login-error">{error}</p>}
              </>
            )}
          </div>
        </div>
      </section>

      <section className="panel settings-card">
        <header className="card-head">
          <div>
            <h2>默认参数</h2>
            <p>新建任务时的初始值，工作台里仍可临时修改。</p>
          </div>
        </header>
        <div className="settings-grid">
          <label className="field">
            <span className="field-label">默认比例</span>
            <select defaultValue="1:1">
              <option>1:1</option><option>4:3</option><option>3:2</option><option>16:9</option><option>9:16</option>
            </select>
          </label>
          <label className="field">
            <span className="field-label">默认分辨率</span>
            <select defaultValue="2k"><option>1k</option><option>2k</option><option>4k</option></select>
          </label>
          <label className="field">
            <span className="field-label">默认张数</span>
            <select defaultValue="2"><option>1</option><option>2</option><option>3</option><option>4</option></select>
          </label>
          <label className="field">
            <span className="field-label">模型并发</span>
            <select defaultValue="2"><option>1</option><option>2</option><option>3</option></select>
          </label>
        </div>
      </section>

      <section className="panel settings-card">
        <header className="card-head">
          <div>
            <h2>存储</h2>
            <p>图库落盘在本机，超限按未收藏 + 最旧清理。</p>
          </div>
          <span className="muted"><HardDrive size={14} /> 5 GB 上限</span>
        </header>

        <div className="storage">
          <div className="storage-bar"><i style={{ width: `${pct}%` }} /></div>
          <div className="storage-meta">
            <span>{usedGb.toFixed(2)} GB / 5.00 GB</span>
            <span>{images.length} 张 · 回收站 0 张</span>
          </div>
        </div>
        <button className="btn-soft" onClick={() => onToast('清理任务接入后启用')}>
          <Sparkles size={14} /> 立即清理未收藏旧图
        </button>
      </section>

      <p className="settings-foot">Draw v0.3 预览版 · GPT 通道已接通 · 支持设备码登录</p>
    </div>
  )
}
