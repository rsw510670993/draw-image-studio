import { useEffect, useMemo, useState } from 'react'
import { Copy, Download, Heart, Search, Trash2, X } from 'lucide-react'
import { CHANNELS, type Img } from '../data'
import { deleteImages, getImages, restoreImage, type ApiImage } from '../api'

interface Props {
  images: Img[]
  onToast: (text: string) => void
  onFavorite: (id: string) => void
  onDelete: (id: string) => void
  onDeleted: (ids: string[]) => void
  onRefreshImages: () => void
}

const FILTERS = ['全部', '即梦', 'ChatGPT', '收藏', '回收站'] as const

const fmt = (ts: number) =>
  new Date(ts).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })

export default function Gallery({ images, onToast, onFavorite, onDelete, onDeleted, onRefreshImages }: Props) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('全部')
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selecting, setSelecting] = useState(false)
  const [picked, setPicked] = useState<string[]>([])
  const [trashItems, setTrashItems] = useState<ApiImage[]>([])

  const loadTrash = () => getImages({ trash: true }).then(res => setTrashItems(res.images)).catch(() => {})

  useEffect(() => {
    if (filter === '回收站') loadTrash()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter])

  const restore = async (id: string) => {
    try {
      await restoreImage(id)
      setTrashItems(prev => prev.filter(item => item.id !== id))
      onRefreshImages()
      onToast('已恢复到图库')
    } catch (error) {
      onToast(error instanceof Error ? error.message : String(error))
    }
  }

  const togglePick = (id: string) =>
    setPicked(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]))

  const exitSelect = () => {
    setSelecting(false)
    setPicked([])
  }

  const toggleAll = () => {
    setPicked(prev => (prev.length === list.length ? [] : list.map(img => img.id)))
  }

  const batchDelete = async () => {
    if (picked.length === 0) return
    try {
      await deleteImages(picked)
      onDeleted(picked)
      onToast(`已删除 ${picked.length} 张（回收站保留 30 天）`)
      exitSelect()
    } catch (error) {
      onToast(error instanceof Error ? error.message : String(error))
    }
  }

  const list = useMemo(() => {
    if (filter === '回收站') return []
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

        <span className="count">{filter === '回收站' ? trashItems.length : list.length} 张</span>
        {selecting ? (
          <div className="select-bar">
            <button className="ghost-btn" onClick={toggleAll}>
              {picked.length === list.length && list.length > 0 ? '取消全选' : '全选'}
            </button>
            <button className="btn-soft danger" onClick={batchDelete} disabled={picked.length === 0}>
              删除所选 {picked.length}
            </button>
            <button className="ghost-btn" onClick={exitSelect}>退出</button>
          </div>
        ) : (
          <button className="btn-soft" onClick={() => setSelecting(true)}>批量选择</button>
        )}
      </div>

      {filter === '回收站' ? (
        trashItems.length === 0 ? (
          <div className="empty-card">
            <p>回收站是空的</p>
            <span>删除的图片会在这里保留 30 天，可随时恢复。</span>
          </div>
        ) : (
          <div className="masonry">
            {trashItems.map(item => (
              <figure className="tile trash" key={item.id}>
                <img src={item.url} alt={item.prompt} loading="lazy" />
                <div className="tile-actions">
                  <button onClick={() => restore(item.id)} title="恢复">恢复</button>
                </div>
                <figcaption className="trash-meta">
                  <span>{item.prompt.slice(0, 40)}</span>
                  <span>删除于 {fmt(item.deletedAt ?? item.createdAt)}</span>
                </figcaption>
              </figure>
            ))}
          </div>
        )
      ) : list.length === 0 ? (
        <div className="empty-card">
          <p>没有匹配的图片</p>
          <span>试试清空搜索，或去工作台生成第一张。</span>
        </div>
      ) : (
        <div className="masonry">
          {list.map(img => (
            <figure
              className={`tile ${img.favorite ? 'fav' : ''} ${picked.includes(img.id) ? 'picked' : ''}`}
              key={img.id}
              onClick={() => (selecting ? togglePick(img.id) : setSelectedId(img.id))}
            >
              <img src={img.src} alt={img.prompt} loading="lazy" />
              {selecting && (
                <span className={`pick ${picked.includes(img.id) ? 'on' : ''}`}>
                  {picked.includes(img.id) ? '✓' : ''}
                </span>
              )}
              <div className="tile-hover">
                <span className={`tile-tag ${img.channel}`}>{CHANNELS[img.channel].short}</span>
                <p>{img.prompt}</p>
              </div>
              {!selecting && (
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
              )}
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
                <div><dt>尺寸</dt><dd>{selected.width && selected.height ? `${selected.width}×${selected.height}` : '—'}</dd></div>
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
