import { useState } from 'react'
import { KeyRound, Loader2 } from 'lucide-react'
import { loginWithToken } from '../api'

interface Props {
  mode: 'token' | 'external'
  onSuccess: () => void
}

export default function Login({ mode, onSuccess }: Props) {
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async () => {
    if (!token.trim() || busy) return
    setBusy(true)
    setError('')
    try {
      await loginWithToken(token.trim())
      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        <span className="brand-mark">D</span>
        <h1>Draw</h1>
        <p className="login-sub">个人 AI 生图工作站</p>

        {mode === 'external' ? (
          <p className="login-hint">当前站点由统一登录保护，请通过站点登录后访问。</p>
        ) : (
          <>
            <input
              type="password"
              value={token}
              onChange={e => setToken(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') submit() }}
              placeholder="输入访问 token"
              autoFocus
            />
            <button className="btn-primary" onClick={submit} disabled={busy || !token.trim()}>
              {busy ? <><Loader2 size={16} className="spin" /> 登录中…</> : <><KeyRound size={16} /> 登录</>}
            </button>
            <p className="login-hint">
              token 在服务端 <code>data/secrets/access-token</code>，或首次启动日志里打印一次。
            </p>
            {error && <p className="login-error">{error}</p>}
          </>
        )}
      </div>
    </div>
  )
}
