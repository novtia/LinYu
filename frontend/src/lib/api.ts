import { getGuestEmail, withGuestEmailQuery } from './guestEmail'

const TOKEN_KEY = 'lingxia_token'

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token)
  else localStorage.removeItem(TOKEN_KEY)
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

let unauthorizedHandler: (() => void) | null = null

/** 注册登录态失效回调，由 AuthProvider 统一处理登出与提示。 */
export function setUnauthorizedHandler(handler: (() => void) | null) {
  unauthorizedHandler = handler
}

export function notifyUnauthorized() {
  setToken(null)
  unauthorizedHandler?.()
}

function handleUnauthorized(status: number) {
  if (status !== 401) return
  notifyUnauthorized()
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers || {})
  if (!headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json')
  }
  const token = getToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)

  const res = await fetch(path, { cache: 'no-store', ...options, headers })
  if (!res.ok) {
    let detail = '请求失败'
    try {
      const data = await res.json()
      detail = data.detail || detail
      if (Array.isArray(detail)) detail = detail.map((d: { msg?: string }) => d.msg).join('; ')
    } catch {
      /* ignore */
    }
    handleUnauthorized(res.status)
    throw new ApiError(res.status, String(detail))
  }
  if (res.status === 204) return undefined as T
  return res.json()
}

function triggerFileDownload(url: string, filename?: string) {
  const ua = navigator.userAgent || ''
  // 微信 / 支付宝内置浏览器点 <a download> 常被拦截，顶层跳转才能交给系统下载器
  if (/MicroMessenger|AlipayClient/i.test(ua)) {
    window.location.assign(url)
    return
  }
  const a = document.createElement('a')
  a.href = url
  a.rel = 'noopener'
  a.download = filename || ''
  document.body.appendChild(a)
  a.click()
  a.remove()
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body !== undefined ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body: body !== undefined ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: body !== undefined ? JSON.stringify(body) : undefined }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  upload: async <T>(path: string, file: File): Promise<T> => {
    const headers = new Headers()
    const token = getToken()
    if (token) headers.set('Authorization', `Bearer ${token}`)
    const form = new FormData()
    form.append('file', file)
    const res = await fetch(path, { method: 'POST', headers, body: form })
    if (!res.ok) {
      let detail = '上传失败'
      try {
        const data = await res.json()
        detail = data.detail || detail
      } catch {
        /* ignore */
      }
      handleUnauthorized(res.status)
      throw new ApiError(res.status, String(detail))
    }
    return res.json()
  },
  uploadMany: async <T>(path: string, files: File[], field = 'files'): Promise<T> => {
    const headers = new Headers()
    const token = getToken()
    if (token) headers.set('Authorization', `Bearer ${token}`)
    const form = new FormData()
    for (const file of files) form.append(field, file)
    const res = await fetch(path, { cache: 'no-store', method: 'POST', headers, body: form })
    if (!res.ok) {
      let detail = '上传失败'
      try {
        const data = await res.json()
        detail = data.detail || detail
      } catch {
        /* ignore */
      }
      handleUnauthorized(res.status)
      throw new ApiError(res.status, String(detail))
    }
    return res.json()
  },
  download: async (path: string, filename?: string) => {
    const token = getToken()
    const abs = path.startsWith('http') ? new URL(path) : new URL(path, window.location.origin)
    const pathname = abs.pathname
    if (pathname.startsWith('/uploads/')) {
      triggerFileDownload(`${pathname}${abs.search}`, filename)
      return
    }
    const payload: { url: string; filename?: string; email?: string } = { url: `${pathname}${abs.search}` }
    if (filename) payload.filename = filename
    if (!token) {
      const email = getGuestEmail()
      if (email) payload.email = email
    }
    const ticket = await request<{ url: string }>('/api/downloads/tickets', {
      method: 'POST',
      body: JSON.stringify(payload),
    })
    triggerFileDownload(ticket.url, filename)
  },
  blobUrl: async (path: string) => {
    const headers = new Headers()
    const token = getToken()
    if (token) headers.set('Authorization', `Bearer ${token}`)
    const requestUrl = token ? path : withGuestEmailQuery(path)
    const res = await fetch(requestUrl, { headers })
    if (!res.ok) {
      let detail = '加载失败'
      try {
        const data = await res.json()
        detail = data.detail || detail
      } catch {
        /* ignore */
      }
      handleUnauthorized(res.status)
      throw new ApiError(res.status, String(detail))
    }
    return URL.createObjectURL(await res.blob())
  },
}
