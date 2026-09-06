import { withGuestEmailQuery } from './guestEmail'

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

function handleUnauthorized(status: number) {
  if (status !== 401) return
  setToken(null)
  unauthorizedHandler?.()
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
    const headers = new Headers()
    const token = getToken()
    if (token) headers.set('Authorization', `Bearer ${token}`)
    const requestUrl = token ? path : withGuestEmailQuery(path)
    const res = await fetch(requestUrl, { headers })
    if (!res.ok) {
      let detail = '下载失败'
      try {
        const data = await res.json()
        detail = data.detail || detail
      } catch {
        /* ignore */
      }
      handleUnauthorized(res.status)
      throw new ApiError(res.status, String(detail))
    }
    const blob = await res.blob()
    let name = filename || 'download'
    const cd = res.headers.get('Content-Disposition')
    if (cd) {
      const m = /filename\*?=(?:UTF-8''|")?([^";]+)/i.exec(cd)
      if (m) name = decodeURIComponent(m[1].replace(/"/g, ''))
    }
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
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
