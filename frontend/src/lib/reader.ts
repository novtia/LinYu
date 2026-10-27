import { api, getToken } from './api'
import { fmtBeijingClock, fmtBeijingConv, fmtBeijingShort, isBeijingToday, isBeijingYesterday } from './time'

/* ---------------------------------------------------------------- 类型 */

export type ShelfState = 'ready' | 'download' | 'locked' | 'making'
export type ShelfKind = 'text' | 'commission'

export interface ShelfBook {
  id: string
  title: string
  author: string
  kind: ShelfKind
  fmt: string
  state: ShelfState
  order_id: string
  product_id: number
  cover_url?: string | null
  bought_at?: string | null
  words: number
  chapters: number
  due?: number | null
  download_url?: string | null
  started: boolean
  /** 读到的章节序号（从 0 起） */
  ch: number
  ch_title: string
  /** 全书进度 0-100 */
  pct: number
  last_at?: string | null
}

export interface ChapterItem {
  i: number
  title: string
  words: number
}

export interface BookProgress {
  ch: number
  pct: number
  overall: number
  updated_at?: string | null
}

export interface BookMark {
  ch: number
  pct: number
  text: string
  created_at: string
}

export interface BookInfo {
  id: string
  title: string
  author: string
  fmt: string
  kind: ShelfKind
  order_id: string
  product_id: number
  cover_url?: string | null
  download_url: string
  words: number
  chapters: ChapterItem[]
  progress?: BookProgress | null
  bookmarks: BookMark[]
}

export interface ChapterData {
  index: number
  title: string
  words: number
  paragraphs: string[]
}

export interface SearchHit {
  ch: number
  title: string
  snippet: string
  pct: number
}

/* ---------------------------------------------------------------- 接口 */

export const readerApi = {
  shelf: () => api.get<{ books: ShelfBook[] }>('/api/reader/shelf').then((r) => r.books),
  book: (id: string) => api.get<BookInfo>(`/api/reader/books/${encodeURIComponent(id)}`),
  chapter: (id: string, i: number) =>
    api.get<ChapterData>(`/api/reader/books/${encodeURIComponent(id)}/chapters/${i}`),
  search: (id: string, q: string) =>
    api.get<SearchHit[]>(`/api/reader/books/${encodeURIComponent(id)}/search?q=${encodeURIComponent(q)}`),
  saveProgress: (id: string, ch: number, pct: number) =>
    api.put<BookProgress>(`/api/reader/books/${encodeURIComponent(id)}/progress`, { ch, pct }),
  addBookmark: (id: string, ch: number, pct: number, text: string) =>
    api.post<BookMark>(`/api/reader/books/${encodeURIComponent(id)}/bookmarks`, { ch, pct, text }),
  removeBookmark: (id: string, ch: number) =>
    api.delete<{ message: string }>(`/api/reader/books/${encodeURIComponent(id)}/bookmarks/${ch}`),
}

/** 页面关闭 / 切后台时的进度上报：普通请求可能被浏览器取消，用 keepalive。 */
export function saveProgressKeepalive(id: string, ch: number, pct: number) {
  const token = getToken()
  if (!token) return
  try {
    void fetch(`/api/reader/books/${encodeURIComponent(id)}/progress`, {
      method: 'PUT',
      keepalive: true,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ ch, pct }),
    })
  } catch {
    /* ignore */
  }
}

/* ---------------------------------------------------------------- 展示 */

/** 没有封面图时，按书的 id 稳定地生成一个色相。 */
export function hueOf(key: string): number {
  let h = 7
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) % 360
  return h
}

export function wordsLabel(words: number): string {
  if (!words) return '—'
  if (words >= 10000) return `${(words / 10000).toFixed(1).replace(/\.0$/, '')} 万字`
  return `${words} 字`
}

export function lastReadLabel(iso?: string | null): string {
  if (!iso) return ''
  const clock = fmtBeijingClock(iso)
  if (isBeijingToday(iso)) return `今天 ${clock}`
  if (isBeijingYesterday(iso)) return `昨天 ${clock}`
  return fmtBeijingConv(iso)
}

export function boughtLabel(iso?: string | null): string {
  if (!iso) return ''
  return fmtBeijingShort(iso).slice(0, 5)
}

export function isReading(b: ShelfBook): boolean {
  return b.state === 'ready' && b.started && b.pct < 100
}

export function readLabel(b: ShelfBook): { text: string; tone: 'teal' | 'warn' | 'mute'; pulse?: boolean } {
  if (b.state === 'making') return { text: '创作中 · 等待作者交稿', tone: 'teal', pulse: true }
  if (b.state === 'locked') return { text: `已交稿 · 待付尾款 ¥${b.due ?? ''}`, tone: 'warn' }
  if (b.state === 'download') return { text: '仅下载 · 无在线阅读', tone: 'mute' }
  if (b.pct >= 100) return { text: '已读完', tone: 'teal' }
  if (!b.started) return { text: '未读', tone: 'mute' }
  return { text: `读至第 ${b.ch + 1} 章 · ${b.pct}%`, tone: 'teal' }
}

/* ---------------------------------------------------------------- 阅读设置（本地） */

export function loadLocal<T extends object>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (raw) return { ...fallback, ...JSON.parse(raw) }
  } catch {
    /* ignore */
  }
  return fallback
}

export function saveLocal(key: string, value: object) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* ignore */
  }
}
