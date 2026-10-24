import { useState } from 'react'
import { ArrowUpRight, Loader2, Sparkles } from 'lucide-react'
import { CHANNELS, RATIOS, type Img } from '../data'
import { generateImage, type AccountStatus, type JimengStatus } from '../api'

interface Props {
  onToast: (text: string) => void
  account: AccountStatus | null
  jimeng: JimengStatus | null
  onGenerated: (img: Img) => void
  onOpenGallery: () => void
}

const COST: Record<string, number> = {
  'jimeng-image-5.0-lite': 3,
  'jimeng-image-4.7': 4,
  'jimeng-image-3.1': 1,
}

type SideState = { status: 'idle' | 'running' | 'done' | 'error'; image?: Img; error?: string; ms?: number }

export default function Compare({ onToast, account, jimeng, onGenerated, onOpenGallery }: Props) {
  const [prompt, setPrompt] = useState('')
  const [ratio, setRatio] = useState('1:1')
  const [jimengModel, setJimengModel] = useState('jimeng-image-5.0-lite')
  const [gptSide, setGptSide] = useState<SideState>({ status: 'idle' })
  const [jmSide, setJmSide] = useState<SideState>({ status: 'idle' })
  const [runPrompt, setRunPrompt] = useState('')

  const running = gptSide.status === 'running' || jmSide.status === 'running'
  const jimengName = CHANNELS.jimeng.models.find(m => m.id === jimengModel)?.name ?? 'Seedream'
  const jimengPoints = COST[jimengModel] ?? 3
  const jimengResolution = jimengModel === 'jimeng-image-3.1' ? '1k' : '2k'

  const run = async () => {
    const text = prompt.trim()
    if (!text || running) return
    setGptSide({ status: 'running' })
    setJmSide({ status: 'running' })
    setRunPrompt(text)
    const t0 = performance.now()
    const timed = (task: Promise<{ images: Array<{ id: string; url: string; bytes: number; ratio: string; width?: number | null; height?: number | null }> }>) =>
      task.then(
        res => ({ ok: true as const, res, ms: Math.round(performance.now() - t0) }),
        err => ({ ok: false as const, err, ms: Math.round(performance.now() - t0) }),
      )

    const [gptOut, jmOut] = await Promise.all([
      timed(generateImage({ prompt: text, channel: 'chatgpt', ratio, count: 1 })),
      timed(generateImage({
        prompt: text,
        channel: 'jimeng',
        model: jimengModel,
        ratio,
        resolution: jimengResolution,
        count: 1,
      })),
    ])

    const errorText = (out: { ok: boolean; err?: unknown }) =>
      out.ok ? '未返回图片' : out.err instanceof Error ? out.err.message : String(out.err ?? '未知错误')

    if (gptOut.ok && gptOut.res.images[0]) {
      const row = gptOut.res.images[0]
      const image: Img = {
        id: row.id,
        src: row.url,
        prompt: text,
        channel: 'gpt',
        model: 'GPT Image 2.5',
        ratio: row.ratio || ratio,
        favorite: false,
        createdAt: Date.now(),
        bytes: row.bytes,
        width: row.width ?? null,
        height: row.height ?? null,
      }
      setGptSide({ status: 'done', image, ms: gptOut.ms })
      onGenerated(image)
    } else {
      setGptSide({ status: 'error', error: errorText(gptOut), ms: gptOut.ms })
    }

    if (jmOut.ok && jmOut.res.images[0]) {
      const row = jmOut.res.images[0]
      const image: Img = {
        id: row.id,
        src: row.url,
        prompt: text,
        channel: 'jimeng',
        model: jimengName,
        ratio: row.ratio || ratio,
        favorite: false,
        createdAt: Date.now(),
        bytes: row.bytes,
        width: row.width ?? null,
        height: row.height ?? null,
      }
      setJmSide({ status: 'done', image, ms: jmOut.ms })
      onGenerated(image)
    } else {
      setJmSide({ status: 'error', error: errorText(jmOut), ms: jmOut.ms })
    }

    const okCount = (gptOut.ok && gptOut.res.images.length > 0 ? 1 : 0) + (jmOut.ok && jmOut.res.images.length > 0 ? 1 : 0)
    onToast(okCount === 2 ? '对比完成，两张结果已进图库' : `对比完成：${okCount} 个通道成功，详见卡片`)
  }

  const sideCard = (
    title: string,
    dot: 'gpt' | 'jimeng',
    subtitle: string,
    meta: string,
    state: SideState,
  ) => (
    <article className="compare-col panel">
      <header>
        <span className={`seg-dot ${dot}`} />
        <b>{title}</b>
        <em>{subtitle}</em>
      </header>
      <div className="compare-stage">
        {state.status === 'done' && state.image && (
          <a className="compare-img-link" href={state.image.src} target="_blank" rel="noreferrer">
            <img className="compare-result" src={state.image.src} alt={title} />
          </a>
        )}
        {state.status === 'running' && (
          <div className="compare-loading">
            <Loader2 size={18} className="spin" />
            生成中…
          </div>
        )}
        {state.status === 'idle' && (
          <div className={`compare-placeholder ${dot}`}>
            <span>发起对比后在这里看结果</span>
          </div>
        )}
        {state.status === 'error' && (
          <div className="compare-error">
            <b>生成失败</b>
            <p>{state.error}</p>
          </div>
        )}
      </div>
      <div className="compare-meta">
        {state.status === 'idle' ? (
          <span className="muted">{meta}</span>
        ) : (
          <>
            <span>{state.ms ? `${(state.ms / 1000).toFixed(1)} 秒` : ''}</span>
            <span>{meta}</span>
          </>
        )}
      </div>
    </article>
  )

  return (
    <div className="compare">
      <section className="panel compare-prompt">
        <header>
          <h2>同一提示词，两个通道各出一张</h2>
          <p>同时发给 ChatGPT 订阅与即梦，结果并排比较，作品自动进图库。</p>
        </header>
        <textarea
          rows={3}
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          placeholder="例如：雨后的江南小镇，青石板路反光，白墙黛瓦，清晨薄雾，胶片质感"
        />
        <div className="compare-controls">
          <div className="chips">
            {RATIOS.map(r => (
              <button key={r} className={`chip ${ratio === r ? 'on' : ''}`} onClick={() => setRatio(r)}>{r}</button>
            ))}
          </div>
          <label className="field compare-model">
            <select aria-label="即梦模型" value={jimengModel} onChange={e => setJimengModel(e.target.value)}>
              {CHANNELS.jimeng.models.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </label>
          <button className="btn-primary compare-run" onClick={run} disabled={running || !prompt.trim()}>
            {running ? <><Loader2 size={16} className="spin" /> 对比中…</> : <><Sparkles size={16} /> 发起对比</>}
          </button>
        </div>
        {(gptSide.status === 'done' || jmSide.status === 'done') && runPrompt !== prompt.trim() && (
          <p className="compare-stale">提示词已修改，当前结果对应上一次提示词，请重新发起。</p>
        )}
        <p className="compare-hint">
          ChatGPT 订阅额度（每次 1 张）· 即梦 {jimengPoints} 积分/张（余额 {jimeng?.points ?? '—'}）
          {!account?.connected && ' · ChatGPT 未连接'}
          {!jimeng?.connected && ' · 即梦未接入'}
        </p>
      </section>

      <div className="compare-grid">
        {sideCard('ChatGPT 订阅', 'gpt', 'gpt-image-2.5', '订阅额度', gptSide)}
        {sideCard('即梦 · Seedream', 'jimeng', jimengName, `${jimengPoints} 积分`, jmSide)}
      </div>

      {(gptSide.status === 'done' || jmSide.status === 'done') && (
        <div className="compare-foot">
          <button className="ghost-btn" onClick={onOpenGallery}>
            结果已保存到图库 <ArrowUpRight size={13} />
          </button>
        </div>
      )}
    </div>
  )
}
