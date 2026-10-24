export interface AccountStatus {
  provider: 'chatgpt'
  connected: boolean
  email?: string
  accountId?: string
  expiresAt?: number
  expired?: boolean
  model?: string
}

export interface LoginStart {
  authorizeUrl: string
  state: string
  redirectUri: string
}

const BASE = '/draw/api'

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  })
  if (res.status === 401) {
    location.href = '/draw/'
    throw new Error('未登录')
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) {
    throw new Error(typeof data.error === 'string' ? data.error : `HTTP ${res.status}`)
  }
  return data as T
}

export const getAccountStatus = () => api<AccountStatus>('/account/status')

export const startChatgptLogin = () =>
  api<LoginStart>('/account/chatgpt/login/start', { method: 'POST' })

export const completeChatgptLogin = (callback: string, state: string) =>
  api<{ ok: boolean; email: string; expiresAt: number }>('/account/chatgpt/login/complete', {
    method: 'POST',
    body: JSON.stringify({ callback, state }),
  })

export const logoutChatgpt = () => api<{ ok: boolean }>('/account/chatgpt/logout', { method: 'POST' })

export interface ApiImage {
  id: string
  provider: string
  model: string
  prompt: string
  ratio: string
  bytes: number
  favorite: boolean
  createdAt: number
  deletedAt?: number | null
  url: string
}

export const getImages = (options?: { trash?: boolean; limit?: number }) =>
  api<{ images: ApiImage[] }>(`/images?limit=${options?.limit ?? 120}${options?.trash ? '&trash=1' : ''}`)

export const generateImage = (body: {
  prompt: string
  channel: 'chatgpt' | 'jimeng'
  model?: string
  ratio: string
  resolution?: string
  count?: number
  refs?: string[]
}) =>
  api<{ images: Array<{ id: string; url: string; bytes: number; ratio: string }> }>('/generate', {
    method: 'POST',
    body: JSON.stringify(body),
  })

export const favoriteImage = (id: string) =>
  api<{ ok: boolean; favorite: boolean }>('/images/favorite', { method: 'POST', body: JSON.stringify({ id }) })

export const deleteImage = (id: string) =>
  api<{ ok: boolean }>('/images/delete', { method: 'POST', body: JSON.stringify({ id }) })

export interface PromptItem {
  id: string
  title: string
  text: string
  tags: string
  favorite: boolean
  useCount: number
  createdAt: number
  updatedAt: number
}

export const getPrompts = () => api<{ prompts: PromptItem[] }>('/prompts')

export const savePrompt = (body: { id?: string; title?: string; text: string; tags?: string }) =>
  api<{ ok: boolean; id: string }>('/prompts/save', { method: 'POST', body: JSON.stringify(body) })

export const deletePrompt = (id: string) =>
  api<{ ok: boolean }>('/prompts/delete', { method: 'POST', body: JSON.stringify({ id }) })

export const favoritePrompt = (id: string) =>
  api<{ ok: boolean; favorite: boolean }>('/prompts/favorite', { method: 'POST', body: JSON.stringify({ id }) })

export const usePrompt = (id: string) =>
  api<{ ok: boolean }>('/prompts/use', { method: 'POST', body: JSON.stringify({ id }) })

export interface DeviceStart {
  userCode: string
  deviceAuthId: string
  intervalMs: number
  verificationUrl: string
  expiresAt: string | null
}

export const startChatgptDevice = () =>
  api<DeviceStart>('/account/chatgpt/device/start', { method: 'POST' })

export const pollChatgptDevice = (deviceAuthId: string, userCode: string) =>
  api<{ status: 'pending' | 'connected'; email?: string; expiresAt?: number }>('/account/chatgpt/device/poll', {
    method: 'POST',
    body: JSON.stringify({ deviceAuthId, userCode }),
  })


export interface JimengStatus {
  provider: 'jimeng'
  connected: boolean
  label?: string
  points?: number | null
  giftPoints?: number | null
  vipPoints?: number | null
  membership?: string | null
  error?: string
}

export const getJimengStatus = () => api<JimengStatus>('/account/jimeng/status')

export const loginJimeng = (sessionid: string) =>
  api<JimengStatus>('/account/jimeng/login', { method: 'POST', body: JSON.stringify({ sessionid }) })

export const logoutJimeng = () => api<{ ok: boolean }>('/account/jimeng/logout', { method: 'POST' })

export interface JimengQrStart {
  sessionId: string
  qr: string
}

export const startJimengQr = () => api<JimengQrStart>('/account/jimeng/qr/start', { method: 'POST' })

export const pollJimengQr = (session: string) =>
  api<{ status: 'pending' | 'connected' | 'expired' | 'error'; points?: number; membership?: string | null; error?: string }>(
    `/account/jimeng/qr/status?session=${encodeURIComponent(session)}`,
  )

export const cancelJimengQr = (sessionId: string) =>
  api<{ ok: boolean }>('/account/jimeng/qr/cancel', { method: 'POST', body: JSON.stringify({ sessionId }) })

export interface AppSettings {
  ratio: string
  jimengModel: string
  count: number
}

export const getSettings = () => api<AppSettings>('/settings')

export const saveSettings = (settings: AppSettings) =>
  api<AppSettings>('/settings', { method: 'POST', body: JSON.stringify({ settings }) })

export const deleteImages = (ids: string[]) =>
  api<{ ok: boolean; removed: number }>('/images/delete-batch', { method: 'POST', body: JSON.stringify({ ids }) })

export const cleanupImages = () =>
  api<{ ok: boolean; removed: number; purged: number }>('/images/cleanup', { method: 'POST' })

export const getStorage = () =>
  api<{ count: number; bytes: number; trashCount: number; trashBytes: number }>('/storage')


export const restoreImage = (id: string) =>
  api<{ ok: boolean }>('/images/restore', { method: 'POST', body: JSON.stringify({ id }) })

export interface AuthStatus {
  mode: 'token' | 'external'
  authenticated: boolean
}

export const getAuthStatus = () => api<AuthStatus>('/auth/status')

export const loginWithToken = (token: string) =>
  api<{ ok: boolean; mode: string }>('/auth/login', { method: 'POST', body: JSON.stringify({ token }) })

export const logoutAuth = () => api<{ ok: boolean }>('/auth/logout', { method: 'POST' })
