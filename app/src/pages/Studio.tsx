import { useEffect, useState } from 'react'
import { BookmarkPlus, Download, Heart, ImagePlus, Loader2, Minus, Plus, Sparkles, Upload, Wand2, X } from 'lucide-react'
import { CHANNELS, RATIOS, type Channel, type GenRequest, type Img } from '../data'
import { savePrompt } from '../api'
import type { Job } from '../App'

interface Props {
  prompt: string
  onPrompt: (v: string) => void
  job?: Job
  images: Img[]
  onGenerate: (req: GenRequest) => void
  onToast: (text: string) => void
  onOpenGallery: () => void
}

const COST: Record<string, number> = {
  'jimeng-image-5.0-lite': 3,
  'jimeng-image-4.7': 4,
  'jimeng-image-3.1': 1,
}

export default function Studio({ prompt, onPrompt, job, images, onGenerate, onToast, onOpenGallery }: Props) {
  const [channel, setChannel] = useState<Channel>('gpt')
  const [model, setModel] = useState(CHANNELS.gpt.models[0].id)
  const [res, setRes] = useState(CHANNELS.gpt.models[0].res[0])
  const [ratio, setRatio] = useState('1:1')
  const [count, setCount] = useState(2)
  const [refs, setRefs] = useState<string[]>([])

  const models = CHANNELS[channel].models
  const current = models.find(m => m.id === model) ?? models[0]
  const running = job?.status === 'running'
  const failed = job?.status === 'failed'
  const results = job?.status === 'done' ? job.results : []
  const outCount = channel === 'gpt' ? 1 : count
  const cost = channel === 'gpt' ? null : (COST[current.id] ?? 3) * count

  useEffect(() => {
    const first = CHANNELS[channel].models[0]
    setModel(first.id)
    setRes(first.res[0])
  }, [channel])

  const addRefs = (files: FileList | null) => {
    if (!files) return
    const next = Array.from(files)
      .slice(0, 4 - refs.length)
      .map(f => URL.createObjectURL(f))
    if (next.length > 0) setRefs(prev => [...prev, ...next].slice(0, 4))
  }

  const submit = () => {
    if (!prompt.trim() || running) return
    if (channel === 'jimeng') {
      onToast('即梦通道待接入，先用 ChatGPT 订阅通道')
      return
    }
    onGenerate({ prompt: prompt.trim(), channel, model, ratio, resolution: res, count: outCount })
  }

  return (
    <div className="studio">
      <section className="panel composer">
        <div className="seg" role="tablist" aria-label="通道">
          {(['jimeng', 'gpt'] as Channel[]).map(ch => (
            <button
              key={ch}
              className={`seg-btn ${channel === ch ? 'on' : ''}`}
              onClick={() => setChannel(ch)}
              role="tab"
              aria-selected={channel === ch}
            >
              <span className={`seg-dot ${ch}`} />
              {CHANNELS[ch].short}
              {ch === 'jimeng' && <em className="seg-flag">待接入</em>}
            </button>
          ))}
        </div>

        <label className="field">
          <span className="field-label">
            提示词
            <em>{prompt.length} / 2000</em>
          </span>
          <textarea
            value={prompt}
            maxLength={2000}
            rows={5}
            onChange={e => onPrompt(e.target.value)}
            placeholder={'描述你想要的画面：主体、风格、光线、构图…\n例如：雨夜霓虹街头的赛博朋克猫，湿漉漉的柏油路反光，电影感光线'}
          />
        </label>

        <div className="inline-actions">
          <button className="ghost-btn" onClick={() => onToast('提示词优化接入后启用')}>
            <Wand2 size={14} /> 优化提示词
          </button>
          <div className="inline-actions-right">
            <button
              className="ghost-btn"
              disabled={!prompt.trim()}
              onClick={async () => {
                try {
                  await savePrompt({ text: prompt })
                  onToast('已保存到提示词库')
                } catch (error) {
                  onToast((error as Error).message)
                }
              }}
            >
              <BookmarkPlus size={14} /> 保存
            </button>
            <button className="ghost-btn" onClick={() => onPrompt('')} disabled={!prompt}>
              清空
            </button>
          </div>
        </div>

        <div className="two">
          <label className="field">
            <span className="field-label">模型</span>
            <select value={model} onChange={e => {
              setModel(e.target.value)
              const m = models.find(x => x.id === e.target.value)
              if (m) setRes(m.res[0])
            }}>
              {models.map(m => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
            <small className="sub">{current.sub}</small>
          </label>

          <label className="field">
            <span className="field-label">分辨率</span>
            <select value={res} onChange={e => setRes(e.target.value)}>
              {current.res.map(r => (
                <option key={r} value={r}>{r.toUpperCase()}</option>
              ))}
            </select>
            <small className="sub">{channel === 'jimeng' ? '按积分自动降级' : '以实际输出为准'}</small>
          </label>
        </div>

        <div className="field">
          <span className="field-label">比例 <em>构图提示，实际以模型输出为准</em></span>
          <div className="chips">
            {RATIOS.map(r => (
              <button key={r} className={`chip ${ratio === r ? 'on' : ''}`} onClick={() => setRatio(r)}>{r}</button>
            ))}
          </div>
        </div>

        <div className="field">
          <span className="field-label">张数</span>
          <div className="stepper">
            <button onClick={() => setCount(c => Math.max(1, c - 1))} aria-label="减少" disabled={channel === 'gpt'}><Minus size={14} /></button>
            <b>{outCount}</b>
            <button onClick={() => setCount(c => Math.min(4, c + 1))} aria-label="增加" disabled={channel === 'gpt'}><Plus size={14} /></button>
          </div>
        </div>

        <div className="field">
          <span className="field-label">参考图 <em>可选 · 最多 4 张</em></span>
          <div className="refs">
            {refs.map((src, i) => (
              <span className="ref" key={src}>
                <img src={src} alt={`参考图 ${i + 1}`} />
                <button onClick={() => setRefs(prev => prev.filter(x => x !== src))} aria-label="移除"><X size={12} /></button>
              </span>
            ))}
            {refs.length < 4 && (
              <button className="ref-add" onClick={() => onToast('图生图通道接入后启用')}>
                <Upload size={16} />
                <span>图生图</span>
              </button>
            )}
          </div>
        </div>

        <button className="btn-primary" onClick={submit} disabled={running || !prompt.trim() || channel === 'jimeng'}>
          {running ? <><Loader2 size={17} className="spin" /> 生成中…</> : <><Sparkles size={17} /> 生成 {outCount} 张</>}
        </button>
        <p className="cost-hint">
          {channel === 'jimeng' ? '即梦通道待接入' : '订阅额度 · 通常 30–60 秒出图'}
        </p>
      </section>

      <section className="stage">
        <div className="stage-head">
          <div>
            <h2>生成结果</h2>
            <p>
              {running
                ? job?.stage
                : failed
                  ? '生成失败，原因见下方'
                  : results.length > 0
                    ? `${results.length} 张 · ${results[0].model}`
                    : '等待第一张图'}
            </p>
          </div>
          <button className="ghost-btn" onClick={onOpenGallery}>打开图库 →</button>
        </div>

        {running && (
          <div className="panel running">
            <div className="bar"><i style={{ width: `${job?.progress ?? 0}%` }} /></div>
            <div className="running-meta">
              <span>{job?.stage}</span>
              <b>{job?.progress ?? 0}%</b>
            </div>
            <div className="skeletons">
              {Array.from({ length: 4 }).map((_, i) => <div className="skeleton" key={i} />)}
            </div>
          </div>
        )}

        {!running && failed && (
          <div className="panel stage-error">
            <b>生成失败</b>
            <p>{job?.stage}</p>
          </div>
        )}

        {!running && results.length > 0 && (
          <div className="results">
            {results.map(img => (
              <figure className="result" key={img.id}>
                <img src={img.src} alt={img.prompt} />
                <figcaption>
                  <span>{img.prompt}</span>
                  <span className="result-meta">{img.ratio} · {img.model}</span>
                </figcaption>
                <div className="result-actions">
                  <button onClick={() => onToast('下载接入后启用')} title="下载"><Download size={15} /></button>
                  <button onClick={() => onToast('已收藏')} title="收藏"><Heart size={15} /></button>
                  <button onClick={onOpenGallery} title="相似生成"><ImagePlus size={15} /></button>
                </div>
              </figure>
            ))}
          </div>
        )}

        {!running && results.length === 0 && (
          <div className="stage-empty">
            <div className="orb" />
            <div className="empty-copy">
              <span className="kicker">STAGE</span>
              <h3>描述画面，按生成</h3>
              <p>左侧选择通道与参数。结果会落盘进入图库，可继续拿来做图生图。</p>
            </div>
            {images.length > 0 && (
              <div className="recent">
                <span className="recent-label">最近生成</span>
                <div className="recent-row">
                  {images.slice(0, 6).map(img => (
                    <button className="recent-thumb" key={img.id} onClick={onOpenGallery} title={img.prompt}>
                      <img src={img.src} alt="" />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  )
}
