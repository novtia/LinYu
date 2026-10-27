import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError } from '../../lib/api'
import {
  readerApi,
  saveProgressKeepalive,
  type BookInfo,
  type BookMark,
  type ChapterData,
} from '../../lib/reader'

export interface ReaderCore {
  book: BookInfo
  marks: BookMark[]
  readSet: Set<number>
  /** 打开时的起始位置：读完的书从头再读 */
  start: { ch: number; pct: number }
  loadChapter: (i: number) => Promise<ChapterData>
  peek: (i: number) => ChapterData | undefined
  /** 上报阅读位置（自动防抖，页面离开时补发） */
  report: (ch: number, pct: number) => void
  addMark: (ch: number, pct: number, text: string) => Promise<void>
  removeMark: (ch: number) => Promise<void>
}

export interface ReaderLoad {
  core: ReaderCore | null
  error: { status: number; message: string } | null
}

export function useReaderBook(fileId: string): ReaderLoad {
  const [book, setBook] = useState<BookInfo | null>(null)
  const [error, setError] = useState<{ status: number; message: string } | null>(null)
  const [marks, setMarks] = useState<BookMark[]>([])
  const [readSet, setReadSet] = useState<Set<number>>(new Set())
  const cache = useRef(new Map<number, ChapterData>())
  const pending = useRef(new Map<number, Promise<ChapterData>>())
  const latest = useRef<{ ch: number; pct: number } | null>(null)
  const dirty = useRef(false)
  const timer = useRef(0)
  const readRef = useRef(readSet)
  readRef.current = readSet

  useEffect(() => {
    let alive = true
    cache.current.clear()
    pending.current.clear()
    setBook(null)
    setError(null)
    readerApi
      .book(fileId)
      .then((b) => {
        if (!alive) return
        setBook(b)
        setMarks(b.bookmarks)
        const done = new Set<number>()
        for (let i = 0; i < (b.progress?.ch ?? 0); i++) done.add(i)
        setReadSet(done)
      })
      .catch((e) => {
        if (!alive) return
        setError(
          e instanceof ApiError
            ? { status: e.status, message: e.message }
            : { status: 0, message: '加载失败，请检查网络后重试' },
        )
      })
    return () => {
      alive = false
    }
  }, [fileId])

  const flush = useCallback(() => {
    window.clearTimeout(timer.current)
    if (!dirty.current || !latest.current) return
    dirty.current = false
    const { ch, pct } = latest.current
    readerApi.saveProgress(fileId, ch, pct).catch(() => {})
  }, [fileId])

  // 离开页面 / 切到后台 / 卸载时把最后位置补发出去
  useEffect(() => {
    const beacon = () => {
      if (!dirty.current || !latest.current) return
      dirty.current = false
      saveProgressKeepalive(fileId, latest.current.ch, latest.current.pct)
    }
    const onVis = () => document.visibilityState === 'hidden' && beacon()
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('pagehide', beacon)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('pagehide', beacon)
      flush()
    }
  }, [fileId, flush])

  const loadChapter = useCallback(
    (i: number) => {
      const hit = cache.current.get(i)
      if (hit) return Promise.resolve(hit)
      let p = pending.current.get(i)
      if (p) return p
      p = readerApi.chapter(fileId, i).then(
        (c) => {
          cache.current.set(i, c)
          pending.current.delete(i)
          return c
        },
        (e) => {
          pending.current.delete(i)
          throw e
        },
      )
      pending.current.set(i, p)
      return p
    },
    [fileId],
  )

  const peek = useCallback((i: number) => cache.current.get(i), [])

  const report = useCallback(
    (ch: number, pct: number) => {
      latest.current = { ch, pct }
      dirty.current = true
      if (!readRef.current.has(ch)) {
        const next = new Set(readRef.current)
        next.add(ch)
        readRef.current = next
        setReadSet(next)
      }
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(flush, 1500)
    },
    [flush],
  )

  const addMark = useCallback(
    async (ch: number, pct: number, text: string) => {
      const m = await readerApi.addBookmark(fileId, ch, pct, text)
      setMarks((prev) => [...prev.filter((x) => x.ch !== ch), m].sort((a, b) => a.ch - b.ch))
    },
    [fileId],
  )

  const removeMark = useCallback(
    async (ch: number) => {
      await readerApi.removeBookmark(fileId, ch)
      setMarks((prev) => prev.filter((x) => x.ch !== ch))
    },
    [fileId],
  )

  if (!book) return { core: null, error }

  const p = book.progress
  const last = Math.max(0, book.chapters.length - 1)
  const start =
    p && p.overall < 100 ? { ch: Math.min(p.ch, last), pct: p.pct } : { ch: 0, pct: 0 }

  return {
    core: { book, marks, readSet, start, loadChapter, peek, report, addMark, removeMark },
    error: null,
  }
}
