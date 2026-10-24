export type Channel = 'jimeng' | 'gpt'

export interface ModelInfo {
  id: string
  name: string
  sub: string
  res: string[]
}

export const CHANNELS: Record<Channel, { name: string; short: string; accent: string; models: ModelInfo[] }> = {
  jimeng: {
    name: '即梦 · Seedream',
    short: '即梦',
    accent: '#59e0c8',
    models: [
      { id: 'jimeng-image-5.0-lite', name: 'Seedream 5.0 Lite', sub: '默认 · 2K 3 积分/张', res: ['2k', '4k'] },
      { id: 'jimeng-image-4.7', name: 'Seedream 4.7', sub: '细节更强 · 2K 4 积分/张', res: ['2k', '4k'] },
      { id: 'jimeng-image-3.1', name: 'Seedream 3.1', sub: '最快 · 1K 1 积分/张', res: ['1k'] },
    ],
  },
  gpt: {
    name: 'ChatGPT 订阅',
    short: 'ChatGPT',
    accent: '#a78bfa',
    models: [
      { id: 'gpt-image-2.5-flare', name: 'GPT Image 2.5', sub: '订阅通道 · 无额外费用', res: ['auto', '1k', '2k'] },
    ],
  },
}

export const RATIOS = ['1:1', '4:3', '3:2', '16:9', '9:16', '2:3']

export interface Img {
  id: string
  src: string
  prompt: string
  channel: Channel
  model: string
  ratio: string
  favorite: boolean
  createdAt: number
  bytes?: number
}

export interface GenRequest {
  prompt: string
  channel: Channel
  model: string
  ratio: string
  resolution: string
  count: number
  refs?: string[]
}
