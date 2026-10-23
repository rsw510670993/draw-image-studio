import { useMemo, useState } from 'react'
import { Copy, Download, Heart, Search, Trash2, X } from 'lucide-react'
import { CHANNELS, type Img } from '../data'

interface Props {
  images: Img[]
  onToast: (text: string) => void
  onFavorite: (id: string) => void
  onDelete: (id: string) => void
}

const FILTERS = ['全部', '即梦', 'ChatGPT', '收藏'] as const

const fmt = (ts: number) =>
  new Date(ts).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })

export default function Gallery({ images, onToast, onFavorite, onDelete }: Props) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('全部')
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const list = useMemo(() => {
    let rows = images
    if (filter === '即梦') rows = rows.filter(i => i.channel === 'jimeng')
    if (filter === 'ChatGPT') rows = rows.filter(i => i.channel === 'gpt')
    if (filter === '收藏') rows = rows.filter(i => i.favorite)
    if (query.trim()) rows = rows.filter(i => i.prompt.toLowerCase().includes(query.trim().toLowerCase()))
    return rows
  }, [images, filter, query])

  const selected = images.find(i => i.id === selectedId) ?? null

  return (
    <div className="gallery">
      <div className="gallery-bar">
        <div className="chips">
          {FILTERS.map(f => (
            <button key={f} className={`chip ${filter === f ? 'on' : ''}`} onClick={() => setFilter(f)}>
              {f}
              {f === '收藏' && <Heart size={12} />}
            </button>
          ))}
        </div>

        <label className="search">
          <Search size={15} />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索提示词…" />
        </label>

        <span className="count">{list.length} 张</span>
      </div>

      {list.length === 0 ? (
        <div className="empty-card">
          <p>没有匹配的图片</p>
          <span>试试清空搜索，或去工作台生成第一张。</span>
        </div>
      ) : (
        <div className="masonry">
          {list.map(img => (
            <figure className={`tile ${img.favorite ? 'fav' : ''}`} key={img.id} onClick={() => setSelectedId(img.id)}>
              <img src={img.src} alt={img.prompt} loading="lazy" />
              <div className="tile-hover">
                <span className={`tile-tag ${img.channel}`}>{CHANNELS[img.channel].short}</span>
                <p>{img.prompt}</p>
              </div>
              <div className="tile-actions">
                <button
                  onClick={e => { e.stopPropagation(); onFavorite(img.id) }}
                  title={img.favorite ? '取消收藏' : '收藏'}
                  className={img.favorite ? 'on' : ''}
                >
                  <Heart size={14} />
                </button>
                <button
                  onClick={e => { e.stopPropagation(); onToast('下载接入后启用') }}
                  title="下载"
                >
                  <Download size={14} />
                </button>
              </div>
            </figure>
          ))}
        </div>
      )}

      {selected && (
        <div className="modal-backdrop" onClick={() => setSelectedId(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-img">
              <img src={selected.src} alt={selected.prompt} />
              <button className="modal-close" onClick={() => setSelectedId(null)} aria-label="关闭"><X size={18} /></button>
            </div>
            <aside className="modal-side">
              <span className={`tile-tag ${selected.channel}`}>{CHANNELS[selected.channel].short}</span>
              <h3>{selected.model}</h3>
              <p className="modal-prompt">{selected.prompt}</p>
              <dl className="meta">
                <div><dt>比例</dt><dd>{selected.ratio}</dd></div>
                <div><dt>生成时间</dt><dd>{fmt(selected.createdAt)}</dd></div>
                <div><dt>状态</dt><dd>{selected.favorite ? '已收藏' : '未收藏'}</dd></div>
              </dl>
              <div className="modal-actions">
                <button className="btn-soft" onClick={() => { navigator.clipboard?.writeText(selected.prompt); onToast('提示词已复制') }}>
                  <Copy size={14} /> 复制提示词
                </button>
                <button className="btn-soft" onClick={() => onToast('下载接入后启用')}>
                  <Download size={14} /> 下载原图
                </button>
                <button className="btn-soft" onClick={() => onFavorite(selected.id)}>
                  <Heart size={14} /> {selected.favorite ? '取消收藏' : '收藏'}
                </button>
                <button
                  className="btn-soft danger"
                  onClick={() => { onDelete(selected.id); setSelectedId(null) }}
                >
                  <Trash2 size={14} /> 删除
                </button>
              </div>
              <p className="modal-foot">演示数据 · 接入后显示真实文件大小与落盘路径</p>
            </aside>
          </div>
        </div>
      )}
    </div>
  )
}
