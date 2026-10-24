import { useEffect, useState } from 'react'
import { BookmarkPlus, Download, Heart, ImagePlus, Layers, Loader2, Minus, Plus, Sparkles, Upload, Wand2, X } from 'lucide-react'
import { CHANNELS, RATIOS, type Channel, type GenRequest, type Img } from '../data'
import { savePrompt, type AppSettings } from '../api'
import type { Job } from '../App'

interface Props {
  prompt: string
  onPrompt: (v: string) => void
  job?: Job
  images: Img[]
  onGenerate: (req: GenRequest) => void
  onToast: (text: string) => void
  onOpenGallery: () => void
  defaults?: AppSettings
  jobs?: Job[]
}

const COST: Record<string, number> = {
  'jimeng-image-5.0-lite': 3,
  'jimeng-image-4.7': 4,
  'jimeng-image-3.1': 1,
}

export default function Studio({ prompt, onPrompt, job, images, onGenerate, onToast, onOpenGallery, defaults, jobs = [] }: Props) {
  const [channel, setChannel] = useState<Channel>('gpt')
  const [model, setModel] = useState(CHANNELS.gpt.models[0].id)
  const [res, setRes] = useState(CHANNELS.gpt.models[0].res[0])
  const [batch, setBatch] = useState(false)
  const [batchRunning, setBatchRunning] = useState(false)
  const [ratio, setRatio] = useState(defaults?.ratio ?? '1:1')
  const [count, setCount] = useState(defaults?.count ?? 2)
  const [refFiles, setRefFiles] = useState<File[]>([])
  const [refPreviews, setRefPreviews] = useState<string[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerPicked, setPickerPicked] = useState<string[]>([])

  const models = CHANNELS[channel].models
  const current = models.find(m => m.id === model) ?? models[0]
  const running = job?.status === 'running'
  const failed = job?.status === 'failed'
  const results = job?.status === 'done' ? job.results : []
  const outCount = channel === 'gpt' ? 1 : count
  const cost = channel === 'gpt' ? null : (COST[current.id] ?? 3) * outCount

  useEffect(() => {
    const preferred = channel === 'jimeng'
      ? (CHANNELS.jimeng.models.find(m => m.id === defaults?.jimengModel) ?? CHANNELS.jimeng.models[0])
      : CHANNELS[channel].models[0]
    setModel(preferred.id)
    setRes(preferred.res[0])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel])

  const addRefs = (files: FileList | null) => {
    if (!files) return
    const incoming = Array.from(files).filter(f => f.type.startsWith('image/') && f.size <= 4 * 1024 * 1024)
    if (incoming.length < files.length) onToast('已忽略非图片或超过 4MB 的文件')
    const merged = [...refFiles, ...incoming].slice(0, 4)
    setRefFiles(merged)
    setRefPreviews(merged.map(f => URL.createObjectURL(f)))
  }

  const removeRef = (index: number) => {
    const next = refFiles.filter((_, i) => i !== index)
    setRefFiles(next)
    setRefPreviews(next.map(f => URL.createObjectURL(f)))
  }

  const batchPrompts = prompt.split('\n').map(line => line.trim()).filter(Boolean).slice(0, 8)

  const toggleGalleryPick = (id: string) => {
    setPickerPicked(prev => {
      if (prev.includes(id)) return prev.filter(x => x !== id)
      if (prev.length + refFiles.length >= 4) return prev
      return [...prev, id]
    })
  }

  const addFromGallery = async () => {
    const picked = images.filter(img => pickerPicked.includes(img.id))
    const files: File[] = []
    for (const img of picked) {
      try {
        const res = await fetch(img.src, { credentials: 'same-origin' })
        if (!res.ok) continue
        const blob = await res.blob()
        if (blob.size > 4 * 1024 * 1024) continue
        files.push(new File([blob], `gallery-${img.id}.png`, { type: blob.type || 'image/png' }))
      } catch { /* skip */ }
    }
    if (files.length === 0) {
      onToast('没有可加入的图片（可能超过 4MB）')
      return
    }
    const merged = [...refFiles, ...files].slice(0, 4)
    setRefFiles(merged)
    setRefPreviews(merged.map(f => URL.createObjectURL(f)))
    setPickerOpen(false)
    setPickerPicked([])
  }

  const compressToDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      try {
        const max = 1536
        const scale = Math.min(1, max / Math.max(img.width, img.height))
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(img.width * scale))
        canvas.height = Math.max(1, Math.round(img.height * scale))
        const ctx = canvas.getContext('2d')
        if (!ctx) throw new Error('压缩参考图失败')
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/jpeg', 0.85))
      } catch (error) {
        reject(error)
      } finally {
        URL.revokeObjectURL(objectUrl)
      }
    }
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl)
      reject(new Error('读取参考图失败'))
    }
    img.src = objectUrl
  })

  const readRefs = () => Promise.all(refFiles.map(compressToDataUrl))

  const submit = async () => {
    if (!prompt.trim() || running) return
    if (batch) {
      if (batchPrompts.length === 0 || batchRunning) return
      setBatchRunning(true)
      try {
        for (const line of batchPrompts) {
          await onGenerate({ prompt: line, channel, model, ratio, resolution: res, count: 1 })
        }
        onToast(`批量完成 ${batchPrompts.length} 组`)
      } finally {
        setBatchRunning(false)
      }
      return
    }
    const refs = refFiles.length > 0 ? await readRefs() : []
    onGenerate({ prompt: prompt.trim(), channel, model, ratio, resolution: res, count: outCount, ...(refs.length ? { refs } : {}) })
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
            </button>
          ))}
        </div>

        <div className="mode-row">
          <div className="mode-switch">
            <button className={!batch ? 'on' : ''} onClick={() => setBatch(false)}>单张</button>
            <button className={batch ? 'on' : ''} onClick={() => setBatch(true)}>批量</button>
          </div>
          {batch && <span className="mode-hint">每行一个提示词，最多 8 组，每组 1 张</span>}
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
            placeholder={batch
              ? '每行一个提示词，例如：\n雨夜霓虹街头的赛博朋克猫\n清晨薄雾中的京都小巷\n雪山脚下的孤独木屋'
              : '描述你想要的画面：主体、风格、光线、构图…\n例如：雨夜霓虹街头的赛博朋克猫，湿漉漉的柏油路反光，电影感光线'}
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
          <span className="field-label">参考图 <em>可选 · 最多 4 张，单张 ≤4MB</em></span>
          <div className="refs">
            {refPreviews.map((src, i) => (
              <span className="ref" key={`${src}-${i}`}>
                <img src={src} alt={`参考图 ${i + 1}`} />
                <button onClick={() => removeRef(i)} aria-label="移除"><X size={12} /></button>
              </span>
            ))}
            {refFiles.length < 4 && (
              <label className="ref-add">
                <Upload size={16} />
                <span>上传</span>
                <input type="file" accept="image/*" multiple onChange={e => addRefs(e.target.files)} />
              </label>
            )}
            {refFiles.length < 4 && (
              <button className="ref-add" onClick={() => setPickerOpen(true)}>
                <ImagePlus size={16} />
                <span>图库</span>
              </button>
            )}
          </div>
        </div>

        <button className="btn-primary" onClick={submit} disabled={running || batchRunning || !prompt.trim()}>
          {batch
            ? (batchRunning ? <><Loader2 size={17} className="spin" /> 批量生成中…</> : <><Layers size={17} /> 批量生成 {batchPrompts.length} 组</>)
            : running ? <><Loader2 size={17} className="spin" /> 生成中…</> : <><Sparkles size={17} /> 生成 {outCount} 张</>}
        </button>
        <p className="cost-hint">
          {batch
            ? `每组 1 张 · 共 ${batchPrompts.length} 组${channel === 'jimeng' ? ` · 约 ${(COST[current.id] ?? 3) * batchPrompts.length} 积分` : ''}`
            : channel === 'jimeng' ? `预计消耗 ${cost} 积分（每日赠送 66）` : '订阅额度 · 通常 30–60 秒出图'}
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

        {batch && jobs.length > 0 && (
          <div className="batch-queue">
            {jobs.slice(0, 8).map(item => (
              <div className={`batch-row ${item.status}`} key={item.id}>
                <span className="batch-prompt">{item.prompt}</span>
                <span className="batch-state">
                  {item.status === 'running' ? `${item.progress}%` : item.status === 'done' ? '完成' : '失败'}
                </span>
              </div>
            ))}
          </div>
        )}

        {running && (
          <div className="panel running">
            <div className="bar"><i style={{ width: `${job?.progress ?? 0}%` }} /></div>
            <div className="running-meta">
              <span>{job?.stage}</span>
              <b>{job?.progress ?? 0}%</b>
            </div>
            <div className="skeletons">
              {Array.from({ length: Math.max(1, Math.min(4, outCount)) }).map((_, i) => (
              <div className="skeleton" key={i} style={{ aspectRatio: ratio.replace(':', ' / ') }} />
            ))}
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
                  <span className="result-meta">{img.width && img.height ? `${img.width}×${img.height} · ` : ''}{img.ratio} · {img.model}</span>
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

      {pickerOpen && (
        <div className="picker-backdrop" onClick={() => setPickerOpen(false)}>
          <div className="picker" onClick={e => e.stopPropagation()}>
            <header>
              <b>从图库选择参考图</b>
              <span>已选 {pickerPicked.length} / {Math.max(4 - refFiles.length, 0)}</span>
              <button className="icon-btn" onClick={() => setPickerOpen(false)} aria-label="关闭"><X size={16} /></button>
            </header>
            {images.length === 0 ? (
              <p className="picker-empty">图库还没有图片，先去工作台生成一张。</p>
            ) : (
              <div className="picker-grid">
                {images.slice(0, 48).map(img => (
                  <button
                    className={`picker-item ${pickerPicked.includes(img.id) ? 'on' : ''}`}
                    key={img.id}
                    onClick={() => toggleGalleryPick(img.id)}
                    title={img.prompt}
                  >
                    <img src={img.src} alt="" loading="lazy" />
                    {pickerPicked.includes(img.id) && <span className="pick">✓</span>}
                  </button>
                ))}
              </div>
            )}
            <footer>
              <button className="ghost-btn" onClick={() => setPickerOpen(false)}>取消</button>
              <button className="btn-primary" onClick={addFromGallery} disabled={pickerPicked.length === 0}>
                加入参考图{pickerPicked.length > 0 ? ` (${pickerPicked.length})` : ''}
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  )
}
