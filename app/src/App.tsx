import { useCallback, useEffect, useRef, useState } from 'react'
import { Bookmark, Columns, LayoutGrid, Settings as SettingsIcon, Sparkles } from 'lucide-react'
import Studio from './pages/Studio'
import Gallery from './pages/Gallery'
import Compare from './pages/Compare'
import Inspo from './pages/Inspo'
import SettingsPage from './pages/Settings'
import { deleteImage, favoriteImage, generateImage, getAccountStatus, getImages, getJimengStatus, getSettings, saveSettings, type AccountStatus, type AppSettings, type JimengStatus } from './api'
import { CHANNELS, type Channel, type GenRequest, type Img } from './data'

export type Page = 'studio' | 'gallery' | 'compare' | 'inspo' | 'settings'

export interface Job extends GenRequest {
  id: string
  status: 'running' | 'done' | 'failed'
  progress: number
  stage: string
  results: Img[]
}

const NAV: Array<{ id: Page; label: string; icon: typeof Sparkles; hint: string }> = [
  { id: 'studio', label: '工作台', icon: Sparkles, hint: '描述画面，生成并迭代' },
  { id: 'gallery', label: '图库', icon: LayoutGrid, hint: '所有生成结果与收藏' },
  { id: 'compare', label: '对比', icon: Columns, hint: '同一提示词，多通道横向对比' },
  { id: 'inspo', label: '提示词', icon: Bookmark, hint: '保存、整理、复用自己的提示词' },
  { id: 'settings', label: '设置', icon: SettingsIcon, hint: '通道、默认参数与存储' },
]

const uid = () => crypto.randomUUID()

const toImg = (row: { id: string; url: string; prompt: string; provider: string; model: string; ratio: string; favorite: boolean; createdAt: number; bytes: number }): Img => ({
  id: row.id,
  src: row.url,
  prompt: row.prompt,
  channel: (row.provider === 'jimeng' ? 'jimeng' : 'gpt') as Channel,
  model: row.provider === 'jimeng'
    ? (CHANNELS.jimeng.models.find(m => m.id === row.model)?.name ?? row.model)
    : (row.model === 'gpt-image-2.5-flare' ? 'GPT Image 2.5' : row.model),
  ratio: row.ratio || '1:1',
  favorite: row.favorite,
  createdAt: row.createdAt,
  bytes: row.bytes,
})

export default function App() {
  const [page, setPage] = useState<Page>('studio')
  const [prompt, setPrompt] = useState('')
  const [images, setImages] = useState<Img[]>([])
  const [jobs, setJobs] = useState<Job[]>([])
  const [toasts, setToasts] = useState<Array<{ id: string; text: string }>>([])
  const [account, setAccount] = useState<AccountStatus | null>(null)
  const [jimeng, setJimeng] = useState<JimengStatus | null>(null)
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const toastTimers = useRef<number[]>([])

  const refreshAccount = useCallback(() => {
    getAccountStatus().then(setAccount).catch(() => setAccount(null))
  }, [])

  const refreshJimeng = useCallback(() => {
    getJimengStatus().then(setJimeng).catch(() => setJimeng(null))
  }, [])

  useEffect(() => {
    refreshAccount()
    refreshJimeng()
    getSettings().then(setSettings).catch(() => {})
  }, [refreshAccount, refreshJimeng])

  const loadImages = useCallback(() => {
    getImages().then(res => setImages(res.images.map(toImg))).catch(() => {})
  }, [])

  useEffect(() => {
    loadImages()
  }, [loadImages])

  const toast = useCallback((text: string) => {
    const id = uid()
    setToasts(prev => [...prev, { id, text }].slice(-3))
    const timer = window.setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id))
    }, 2600)
    toastTimers.current.push(timer)
  }, [])

  const generate = useCallback(async (req: GenRequest) => {
    const id = uid()
    const job: Job = { id, ...req, status: 'running', progress: 6, stage: '已提交，等待 ChatGPT 出图…', results: [] }
    setJobs(prev => [job, ...prev].slice(0, 12))

    const timer = window.setInterval(() => {
      setJobs(prev => prev.map(j => (j.id === id ? { ...j, progress: Math.min(92, j.progress + 2) } : j)))
    }, 1400)

    try {
      const res = await generateImage({
        prompt: req.prompt,
        channel: req.channel === 'jimeng' ? 'jimeng' : 'chatgpt',
        model: req.model,
        ratio: req.ratio,
        resolution: req.resolution,
        count: req.count,
        refs: req.refs,
      })
      window.clearInterval(timer)
      const made: Img[] = res.images.map(img => ({
        id: img.id,
        src: img.url,
        prompt: req.prompt,
        channel: (req.channel === 'jimeng' ? 'jimeng' : 'gpt') as Channel,
        model: req.channel === 'jimeng'
          ? (CHANNELS.jimeng.models.find(m => m.id === req.model)?.name ?? 'Seedream')
          : 'GPT Image 2.5',
        ratio: img.ratio || req.ratio,
        favorite: false,
        createdAt: Date.now(),
        bytes: img.bytes,
      }))
      setImages(prev => [...made, ...prev])
      setJobs(prev => prev.map(j => (j.id === id ? { ...j, status: 'done', progress: 100, stage: '完成', results: made } : j)))
      refreshJimeng()
      toast(`已生成 ${made.length} 张真实图片${req.refs?.length ? '（图生图）' : ''}`)
    } catch (error) {
      window.clearInterval(timer)
      const message = error instanceof Error ? error.message : String(error)
      setJobs(prev => prev.map(j => (j.id === id ? { ...j, status: 'failed', stage: message } : j)))
      toast(message)
    }
  }, [toast, refreshJimeng])

  const activeJob = jobs[0]

  const toggleFavorite = async (imgId: string) => {
    try {
      const res = await favoriteImage(imgId)
      setImages(prev => prev.map(img => (img.id === imgId ? { ...img, favorite: res.favorite } : img)))
    } catch (error) {
      toast((error as Error).message)
    }
  }

  const removeImage = async (imgId: string) => {
    try {
      await deleteImage(imgId)
      setImages(prev => prev.filter(img => img.id !== imgId))
      toast('已移到回收站（30 天后清理）')
    } catch (error) {
      toast((error as Error).message)
    }
  }

  const current = NAV.find(n => n.id === page)!

  return (
    <div className="shell">
      <aside className="side">
        <div className="brand">
          <span className="brand-mark">D</span>
          <span className="brand-text">
            <b>Draw</b>
            <small>生图工作站</small>
          </span>
        </div>

        <nav className="nav">
          {NAV.map(item => {
            const Icon = item.icon
            return (
              <button
                key={item.id}
                className={`nav-item ${page === item.id ? 'active' : ''}`}
                onClick={() => setPage(item.id)}
                title={item.label}
              >
                <Icon size={19} strokeWidth={1.9} />
                <span className="nav-label">{item.label}</span>
              </button>
            )
          })}
        </nav>

        <div className="side-foot">
          <span className="demo-dot" />
          <span className="side-foot-text">v0.5.0 · 双通道已接通</span>
        </div>
      </aside>

      <main className="main">
        <header className="top">
          <div className="top-title">
            <h1>{current.label === '对比' ? '多通道对比' : current.label}</h1>
            <p>{current.hint}</p>
          </div>

          <div className="top-right">
            <div className="pills">
              <span className={jimeng?.connected ? 'pill ok' : 'pill idle'}>
                <i />{jimeng?.connected ? `即梦 · ${jimeng.points ?? '?'} 积分` : '即梦 未接入'}
              </span>
              {account?.connected ? (
                <span className="pill ok" title={account.email}>
                  <i />ChatGPT · {account.email?.split('@')[0] ?? '已连接'}
                </span>
              ) : (
                <span className="pill idle"><i />ChatGPT 未连接</span>
              )}
            </div>
            <span className="avatar" title="本地单用户">C</span>
          </div>
        </header>

        <div className="page">
          {page === 'studio' && (
            <Studio
              prompt={prompt}
              onPrompt={setPrompt}
              job={activeJob}
              images={images}
              onGenerate={generate}
              onToast={toast}
              onOpenGallery={() => setPage('gallery')}
              defaults={settings ?? undefined}
              jobs={jobs}
            />
          )}
          {page === 'gallery' && (
            <Gallery
              images={images}
              onToast={toast}
              onFavorite={toggleFavorite}
              onDelete={removeImage}
              onDeleted={ids => setImages(prev => prev.filter(img => !ids.includes(img.id)))}
              onRefreshImages={loadImages}
            />
          )}
          {page === 'compare' && (
            <Compare
              onToast={toast}
              account={account}
              jimeng={jimeng}
              onGenerated={img => {
                setImages(prev => [img, ...prev])
                refreshJimeng()
              }}
              onOpenGallery={() => setPage('gallery')}
            />
          )}
          {page === 'inspo' && (
            <Inspo
              onUse={text => {
                setPrompt(text)
                setPage('studio')
                toast('已带入工作台')
              }}
              onToast={toast}
            />
          )}
          {page === 'settings' && (
            <SettingsPage
              images={images}
              onToast={toast}
              account={account}
              onRefreshAccount={refreshAccount}
              jimeng={jimeng}
              onRefreshJimeng={refreshJimeng}
              settings={settings}
              onRefreshImages={loadImages}
              onSaveSettings={async next => {
                try {
                  const saved = await saveSettings(next)
                  setSettings(saved)
                  toast('默认参数已保存')
                } catch (error) {
                  toast(error instanceof Error ? error.message : String(error))
                }
              }}
            />
          )}
        </div>
      </main>

      <div className="toasts">
        {toasts.map(t => (
          <div className="toast" key={t.id}>{t.text}</div>
        ))}
      </div>
    </div>
  )
}
