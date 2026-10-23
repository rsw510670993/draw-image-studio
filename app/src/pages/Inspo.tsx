import { useEffect, useMemo, useState } from 'react'
import { ArrowRight, Copy, Heart, Pencil, Plus, Search, Trash2 } from 'lucide-react'
import { deletePrompt, favoritePrompt, getPrompts, savePrompt, usePrompt, type PromptItem } from '../api'

interface Props {
  onUse: (text: string) => void
  onToast: (text: string) => void
}

export default function Inspo({ onUse, onToast }: Props) {
  const [items, setItems] = useState<PromptItem[]>([])
  const [query, setQuery] = useState('')
  const [favOnly, setFavOnly] = useState(false)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<PromptItem | null>(null)
  const [title, setTitle] = useState('')
  const [text, setText] = useState('')
  const [tags, setTags] = useState('')

  const load = () => {
    getPrompts()
      .then(res => setItems(res.prompts))
      .catch(() => {})
  }

  useEffect(() => {
    load()
  }, [])

  const list = useMemo(() => {
    let rows = items
    if (favOnly) rows = rows.filter(item => item.favorite)
    if (query.trim()) {
      const q = query.trim().toLowerCase()
      rows = rows.filter(item => (item.title + ' ' + item.text + ' ' + item.tags).toLowerCase().includes(q))
    }
    return rows
  }, [items, favOnly, query])

  const reset = () => {
    setCreating(false)
    setEditing(null)
    setTitle('')
    setText('')
    setTags('')
  }

  const startCreate = () => {
    reset()
    setCreating(true)
  }

  const startEdit = (item: PromptItem) => {
    setEditing(item)
    setCreating(true)
    setTitle(item.title)
    setText(item.text)
    setTags(item.tags)
  }

  const submit = async () => {
    if (!text.trim()) return
    try {
      await savePrompt({ id: editing?.id, title, text, tags })
      onToast(editing ? '提示词已更新' : '提示词已保存')
      reset()
      load()
    } catch (error) {
      onToast((error as Error).message)
    }
  }

  const use = (item: PromptItem) => {
    onUse(item.text)
    usePrompt(item.id).catch(() => {})
    setItems(prev => prev.map(row => (row.id === item.id ? { ...row, useCount: row.useCount + 1 } : row)))
  }

  const toggleFav = async (item: PromptItem) => {
    try {
      const res = await favoritePrompt(item.id)
      setItems(prev => prev.map(row => (row.id === item.id ? { ...row, favorite: res.favorite } : row)))
    } catch (error) {
      onToast((error as Error).message)
    }
  }

  const remove = async (item: PromptItem) => {
    try {
      await deletePrompt(item.id)
      setItems(prev => prev.filter(row => row.id !== item.id))
      onToast('提示词已删除')
    } catch (error) {
      onToast((error as Error).message)
    }
  }

  const copy = async (item: PromptItem) => {
    try {
      await navigator.clipboard.writeText(item.text)
      onToast('提示词已复制')
    } catch {
      onToast('复制失败，请手动选择文本')
    }
  }

  return (
    <div className="inspo">
      <div className="inspo-bar">
        <div className="chips">
          <button className={`chip ${!favOnly ? 'on' : ''}`} onClick={() => setFavOnly(false)}>全部</button>
          <button className={`chip ${favOnly ? 'on' : ''}`} onClick={() => setFavOnly(true)}>
            收藏 <Heart size={12} />
          </button>
        </div>

        <label className="search">
          <Search size={15} />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索标题、正文或标签…" />
        </label>

        <button className="btn-soft" onClick={startCreate}>
          <Plus size={14} /> 新建提示词
        </button>
      </div>

      {(creating || editing) && (
        <section className="panel prompt-editor">
          <header>
            <h2>{editing ? '编辑提示词' : '新建提示词'}</h2>
            <p>保存后可以在任何设备打开 Draw 复用；点卡片上的「带入工作台」直接填进提示词框。</p>
          </header>
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="标题（可留空，自动取正文前 24 字）" />
          <textarea value={text} onChange={e => setText(e.target.value)} rows={4} placeholder="提示词正文…" />
          <input value={tags} onChange={e => setTags(e.target.value)} placeholder="标签，用逗号分隔（可选），例如：人像,胶片,暗调" />
          <div className="editor-actions">
            <button className="btn-primary" onClick={submit} disabled={!text.trim()}>保存</button>
            <button className="ghost-btn" onClick={reset}>取消</button>
          </div>
        </section>
      )}

      {list.length === 0 ? (
        <div className="empty-card">
          <p>{items.length === 0 ? '还没有保存的提示词' : '没有匹配的提示词'}</p>
          <span>
            {items.length === 0
              ? '在工作台写好后点「保存」，或点右上角「新建提示词」。'
              : '换个关键词，或切回「全部」。'}
          </span>
        </div>
      ) : (
        <div className="prompt-grid">
          {list.map(item => (
            <article className="prompt-card" key={item.id}>
              <header>
                <h3>{item.title}</h3>
                <button
                  className={`icon-btn ${item.favorite ? 'on' : ''}`}
                  onClick={() => toggleFav(item)}
                  title={item.favorite ? '取消收藏' : '收藏'}
                >
                  <Heart size={14} />
                </button>
              </header>
              <p>{item.text}</p>
              {item.tags && (
                <div className="prompt-tags">
                  {item.tags.split(',').map(tag => tag.trim()).filter(Boolean).map(tag => (
                    <span key={tag}>{tag}</span>
                  ))}
                </div>
              )}
              <footer>
                <button className="ghost-btn" onClick={() => use(item)}>
                  带入工作台 <ArrowRight size={13} />
                </button>
                <div className="prompt-actions">
                  <button className="icon-btn" onClick={() => copy(item)} title="复制"><Copy size={13} /></button>
                  <button className="icon-btn" onClick={() => startEdit(item)} title="编辑"><Pencil size={13} /></button>
                  <button className="icon-btn danger" onClick={() => remove(item)} title="删除"><Trash2 size={13} /></button>
                </div>
              </footer>
              <span className="prompt-meta">已使用 {item.useCount} 次</span>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}
