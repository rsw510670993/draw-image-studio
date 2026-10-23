import { useState } from 'react'
import { CheckCircle2, Copy, ExternalLink, HardDrive, KeyRound, Loader2, LogOut, RefreshCw, Sparkles } from 'lucide-react'
import type { Img } from '../data'
import { completeChatgptLogin, logoutChatgpt, startChatgptLogin, type AccountStatus, type LoginStart } from '../api'

interface Props {
  images: Img[]
  onToast: (text: string) => void
  account: AccountStatus | null
  onRefreshAccount: () => void
}

const fmt = (ts?: number) =>
  ts === undefined ? '—' : new Date(ts).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })

export default function SettingsPage({ images, onToast, account, onRefreshAccount }: Props) {
  const [pending, setPending] = useState<LoginStart | null>(null)
  const [callback, setCallback] = useState('')
  const [busy, setBusy] = useState<'start' | 'complete' | null>(null)
  const [error, setError] = useState('')

  const bytes = images.reduce((sum, img) => sum + (img.bytes ?? 0), 0)
  const usedGb = bytes / 1e9
  const pct = Math.min(100, Math.round((usedGb / 5) * 100))

  const begin = async () => {
    setBusy('start')
    setError('')
    try {
      setPending(await startChatgptLogin())
    } catch (e) {
      setError((e as Error).message)
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
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
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
    } catch (e) {
      onToast((e as Error).message)
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
            ) : pending ? (
              <div className="login-flow">
                <div className="login-step">
                  <b>1</b>
                  <span>
                    打开授权页，登录并授权（手机即可，需能访问 OpenAI）：
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
                <button className="btn-soft" onClick={begin} disabled={busy === 'start'}>
                  {busy === 'start' ? <Loader2 size={14} className="spin" /> : <KeyRound size={14} />} 登录 ChatGPT
                </button>
                <p className="login-hint">没有电脑也能登录：手机浏览器完成授权后，把打不开的 localhost 地址栏整条链接粘回来即可。</p>
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

      <p className="settings-foot">Draw v0.2 预览版 · GPT 登录已接真实接口 · 生成通道尚未接入</p>
    </div>
  )
}
