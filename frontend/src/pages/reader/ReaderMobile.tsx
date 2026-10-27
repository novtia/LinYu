import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  ArrowDownUp,
  BookOpen,
  Bookmark,
  ChevronLeft,
  Ellipsis,
  Eye,
  List,
  Moon,
  Pause,
  Play,
  Search,
  SlidersHorizontal,
  Sun,
  SunDim,
} from 'lucide-react'
import { ApiError, api } from '../../lib/api'
import { fmtBeijingDate } from '../../lib/time'
import { loadLocal, readerApi, saveLocal, type ChapterData, type SearchHit } from '../../lib/reader'
import type { ReaderCore } from './useReaderBook'

const KEY = 'lx-reader-m2'
const THEMES: [string, string, string][] = [
  ['parch', '#ecdfbd', '羊皮纸'],
  ['white', '#ffffff', '白'],
  ['night', '#1b1b1d', '夜间'],
  ['sand', '#ebdcd0', '米沙'],
  ['green', '#dcead0', '护眼绿'],
  ['pink', '#fbe3de', '淡粉'],
]
const FONTS: [string, string, string][] = [
  ['sys', '系统', '"PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif'],
  ['song', '宋体', '"Songti SC", "Noto Serif SC", SimSun, serif'],
  ['kai', '楷体', '"Kaiti SC", KaiTi, STKaiti, serif'],
]
const LHS: [number, string][] = [[1.4, '紧凑'], [1.62, '标准'], [1.9, '宽松']]
const GAP = 44 // 与 reader.css 中分栏间距一致
const AUTO_SCROLL_PX = 36 // 自动阅读：滚动模式每秒像素
const AUTO_FLIP_MS = 7000 // 自动阅读：翻页模式翻页间隔

interface MSettings {
  theme: string
  mode: 'scroll' | 'page'
  fs: number
  lh: number
  font: string
  eye: boolean
  dim: number
  prevTheme: string
}
const DEFAULTS: MSettings = { theme: 'parch', mode: 'scroll', fs: 18, lh: 1.62, font: 'sys', eye: false, dim: 0, prevTheme: 'parch' }

type Ui = '' | 'menu' | 'sheet' | 'drawer'

function clockText() {
  const d = new Date()
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function ReaderMobile({ core }: { core: ReaderCore }) {
  const { book, marks, readSet, start, loadChapter, peek, report, addMark, removeMark } = core
  const [query] = useSearchParams()
  const total = book.chapters.length
  const last = total - 1

  const [S, setS] = useState<MSettings>(() => loadLocal(KEY, DEFAULTS))
  const [ui, setUi] = useState<Ui>('')
  const [moreOpen, setMoreOpen] = useState(false)
  const [topPop, setTopPop] = useState(false)
  const [dtab, setDtab] = useState<'toc' | 'bm' | 'search'>('toc')
  const [desc, setDesc] = useState(false)
  const [auto, setAuto] = useState(false)
  const [toast, setToast] = useState('')
  const [busy, setBusy] = useState(true)
  const [clock, setClock] = useState(clockText)
  const [battery, setBattery] = useState<number | null>(null)

  const rootRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const flowRef = useRef<HTMLDivElement>(null)
  const toastTimer = useRef(0)
  const tok = useRef(0)

  const initial = useMemo(() => {
    const q = Number(query.get('c'))
    return Number.isInteger(q) && q >= 0 && q <= last ? { ch: q, pct: 0 } : start
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [pos, setPos] = useState(initial)
  const posRef = useRef(initial)

  // 滚动模式：已载入的章节（连续、升序）
  const [secs, setSecs] = useState<ChapterData[]>([])
  const secsRef = useRef<ChapterData[]>([])
  secsRef.current = secs
  const restoreRef = useRef<{ ch: number; pct: number } | null>(null)
  const anchorRef = useRef<{ h: number; top: number } | null>(null)
  const loadingNext = useRef(false)
  const loadingPrev = useRef(false)

  // 翻页模式：当前章 + 页码
  const [cur, setCur] = useState<ChapterData | null>(null)
  const curRef = useRef<ChapterData | null>(null)
  curRef.current = cur
  const [page, setPage] = useState(0)
  const [count, setCount] = useState(1)
  const pageRef = useRef(0)
  const countRef = useRef(1)
  pageRef.current = page
  countRef.current = count
  const pending = useRef<number | null>(null)
  const measured = useRef(-1)
  const [fontTick, setFontTick] = useState(0)
  const [size, setSize] = useState({ w: 360, h: 640 })

  const paged = S.mode === 'page'
  const modeRef = useRef(S.mode)
  modeRef.current = S.mode

  const showToast = useCallback((m: string) => {
    setToast(m)
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(''), 1600)
  }, [])

  useEffect(() => saveLocal(KEY, S), [S])

  // 时钟 / 电量
  useEffect(() => {
    const t = window.setInterval(() => setClock(clockText()), 20000)
    return () => window.clearInterval(t)
  }, [])
  useEffect(() => {
    let off: (() => void) | undefined
    const nav = navigator as Navigator & { getBattery?: () => Promise<any> }
    nav.getBattery?.().then((b) => {
      const upd = () => setBattery(Math.round(b.level * 100))
      upd()
      b.addEventListener('levelchange', upd)
      off = () => b.removeEventListener('levelchange', upd)
    }).catch(() => {})
    return () => off?.()
  }, [])

  // 容器尺寸（翻页模式依赖）
  useLayoutEffect(() => {
    const upd = () => {
      const el = rootRef.current
      if (el) setSize({ w: el.clientWidth, h: el.clientHeight })
    }
    upd()
    window.addEventListener('resize', upd)
    return () => window.removeEventListener('resize', upd)
  }, [])

  useEffect(() => {
    document.fonts?.ready.then(() => setFontTick((n) => n + 1)).catch(() => {})
  }, [])

  const setPosition = useCallback(
    (ch: number, pct: number) => {
      const p = posRef.current
      if (p.ch === ch && p.pct === pct) return
      posRef.current = { ch, pct }
      setPos({ ch, pct })
      report(ch, pct)
    },
    [report],
  )

  /* ---------------------------------------------------------- 滚动模式 */

  const sectionTop = (ch: number, pct: number) => {
    const el = scrollRef.current?.querySelector<HTMLElement>(`[data-ch="${ch}"]`)
    if (!el) return null
    return pct <= 0 ? el.offsetTop - 44 : el.offsetTop + (pct / 100) * el.offsetHeight - 60
  }

  const scrollToPos = useCallback((ch: number, pct: number) => {
    const el = scrollRef.current
    const y = sectionTop(ch, pct)
    if (el && y != null) el.scrollTop = Math.max(0, y)
  }, [])

  const pump = useCallback(() => {
    const el = scrollRef.current
    const list = secsRef.current
    if (!el || modeRef.current !== 'scroll' || !list.length) return
    const lastI = list[list.length - 1].index
    const firstI = list[0].index
    if (el.scrollTop + el.clientHeight > el.scrollHeight - 900 && lastI < last && !loadingNext.current) {
      loadingNext.current = true
      loadChapter(lastI + 1)
        .then((c) => setSecs((s) => (s.some((x) => x.index === c.index) || s[s.length - 1]?.index !== lastI ? s : [...s, c])))
        .catch(() => {})
        .finally(() => {
          loadingNext.current = false
        })
    }
    if (el.scrollTop < 500 && firstI > 0 && !loadingPrev.current) {
      loadingPrev.current = true
      loadChapter(firstI - 1)
        .then((c) => {
          const box = scrollRef.current
          if (box) anchorRef.current = { h: box.scrollHeight, top: box.scrollTop }
          setSecs((s) => (s.some((x) => x.index === c.index) || s[0]?.index !== firstI ? s : [c, ...s]))
        })
        .catch(() => {})
        .finally(() => {
          loadingPrev.current = false
        })
    }
  }, [last, loadChapter])

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el || modeRef.current !== 'scroll') return
    if (restoreRef.current) {
      const r = restoreRef.current
      restoreRef.current = null
      scrollToPos(r.ch, r.pct)
    } else if (anchorRef.current) {
      const a = anchorRef.current
      anchorRef.current = null
      el.scrollTop = a.top + (el.scrollHeight - a.h)
    }
    pump()
  }, [secs, pump, scrollToPos])

  const scrollRaf = useRef(0)
  const onScroll = useCallback(() => {
    if (scrollRaf.current) return
    scrollRaf.current = requestAnimationFrame(() => {
      scrollRaf.current = 0
      const el = scrollRef.current
      if (!el || modeRef.current !== 'scroll') return
      const line = el.scrollTop + 60
      const nodes = el.querySelectorAll<HTMLElement>('[data-ch]')
      let n: HTMLElement | null = null
      for (const node of Array.from(nodes)) if (node.offsetTop <= line) n = node
      if (n) {
        const pct = Math.max(0, Math.min(100, Math.round(((line - n.offsetTop) / Math.max(1, n.offsetHeight)) * 100)))
        setPosition(Number(n.dataset.ch), pct)
      }
      pump()
    })
  }, [pump, setPosition])

  /* ---------------------------------------------------------- 翻页模式 */

  const measure = useCallback(() => {
    const flow = flowRef.current
    const c = curRef.current
    if (!flow || !c || modeRef.current !== 'page') return
    const W = rootRef.current?.clientWidth || 360
    const n = Math.max(1, Math.round((flow.scrollWidth + GAP) / W))
    let p = pageRef.current
    if (pending.current != null) {
      const pc = pending.current
      pending.current = null
      p = pc >= 100 ? n - 1 : Math.round((pc / 100) * (n - 1))
    } else {
      const keep = posRef.current.ch === c.index ? posRef.current.pct : 0
      p = measured.current === c.index ? Math.min(pageRef.current, n - 1) : Math.round((keep / 100) * (n - 1))
    }
    measured.current = c.index
    setCount(n)
    setPage(Math.max(0, Math.min(n - 1, p)))
  }, [])

  useLayoutEffect(() => {
    measure()
  }, [cur, size.w, size.h, S.fs, S.lh, S.font, S.mode, fontTick, measure])

  useEffect(() => {
    if (modeRef.current !== 'page' || !cur || measured.current !== cur.index) return
    setPosition(cur.index, count > 1 ? Math.round((page / (count - 1)) * 100) : 0)
  }, [cur, page, count, setPosition])

  /* ---------------------------------------------------------- 跳转 */

  const openPaged = useCallback(
    (ch: number, pct: number) => {
      const t = ++tok.current
      setBusy(true)
      loadChapter(ch)
        .then((c) => {
          if (t !== tok.current) return
          pending.current = pct
          measured.current = -1
          setCur(c)
          setBusy(false)
          if (ch < last) loadChapter(ch + 1).catch(() => {})
          if (ch > 0) loadChapter(ch - 1).catch(() => {})
        })
        .catch((e) => {
          if (t !== tok.current) return
          setBusy(false)
          showToast(e instanceof ApiError ? e.message : '章节加载失败')
        })
    },
    [last, loadChapter, showToast],
  )

  const openScroll = useCallback(
    (ch: number, pct: number) => {
      const t = ++tok.current
      setBusy(true)
      loadChapter(ch)
        .then((c) => {
          if (t !== tok.current) return
          restoreRef.current = { ch, pct }
          setSecs([c])
          setBusy(false)
        })
        .catch((e) => {
          if (t !== tok.current) return
          setBusy(false)
          showToast(e instanceof ApiError ? e.message : '章节加载失败')
        })
    },
    [loadChapter, showToast],
  )

  const jump = useCallback(
    (ch: number, pct = 0) => {
      const n = Math.max(0, Math.min(last, ch))
      setUi('')
      setTopPop(false)
      if (modeRef.current === 'page') {
        if (curRef.current?.index === n) {
          const c = countRef.current
          setPage(pct >= 100 ? c - 1 : Math.round((pct / 100) * (c - 1)))
        } else {
          openPaged(n, pct)
        }
      } else if (secsRef.current.some((s) => s.index === n)) {
        scrollToPos(n, pct)
      } else {
        openScroll(n, pct)
      }
    },
    [last, openPaged, openScroll, scrollToPos],
  )

  // 首次进入 / 切换阅读方式：从当前位置重新打开
  useEffect(() => {
    const p = posRef.current
    if (S.mode === 'page') {
      setSecs([])
      openPaged(p.ch, p.pct)
    } else {
      setCur(null)
      measured.current = -1
      openScroll(p.ch, p.pct)
    }
  }, [S.mode, openPaged, openScroll])

  const flip = useCallback(
    (d: 1 | -1) => {
      const p = pageRef.current + d
      if (p >= 0 && p < countRef.current) {
        setPage(p)
        return
      }
      const ch = posRef.current.ch + d
      if (ch < 0) return showToast('已经是第一页')
      if (ch > last) return showToast('已读完全书')
      openPaged(ch, d > 0 ? 0 : 100)
    },
    [last, openPaged, showToast],
  )

  /* ---------------------------------------------------------- 点击 / 滑动 */

  const touch = useRef<{ x: number; y: number } | null>(null)
  const swiped = useRef(0)

  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0]
    touch.current = { x: t.clientX, y: t.clientY }
  }
  const onTouchEnd = (e: React.TouchEvent) => {
    const s = touch.current
    touch.current = null
    if (!s || !paged || ui) return
    const t = e.changedTouches[0]
    const dx = t.clientX - s.x
    const dy = t.clientY - s.y
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.4) {
      swiped.current = Date.now()
      flip(dx < 0 ? 1 : -1)
    }
  }

  const onTap = (e: React.MouseEvent) => {
    if (Date.now() - swiped.current < 450) return
    if ((e.target as HTMLElement).closest('a,button')) return
    const sel = window.getSelection()
    if (sel && !sel.isCollapsed) return
    if (ui || topPop) {
      setUi('')
      setTopPop(false)
      return
    }
    const r = rootRef.current!.getBoundingClientRect()
    const fx = (e.clientX - r.left) / r.width
    const fy = (e.clientY - r.top) / r.height
    if (paged) {
      if (fx < 0.3) flip(-1)
      else if (fx > 0.7) flip(1)
      else setUi('menu')
    } else {
      const el = scrollRef.current!
      if (fy < 0.3) el.scrollBy({ top: -el.clientHeight * 0.85, behavior: 'smooth' })
      else if (fy > 0.7) el.scrollBy({ top: el.clientHeight * 0.85, behavior: 'smooth' })
      else setUi('menu')
    }
  }

  /* ---------------------------------------------------------- 自动阅读 */

  useEffect(() => {
    if (!auto || ui || busy) return
    if (paged) {
      const t = window.setInterval(() => flip(1), AUTO_FLIP_MS)
      return () => window.clearInterval(t)
    }
    let raf = 0
    let prev = performance.now()
    let acc = 0
    const loop = (now: number) => {
      const el = scrollRef.current
      acc += ((now - prev) / 1000) * AUTO_SCROLL_PX
      prev = now
      if (el && acc >= 1) {
        const step = Math.floor(acc)
        acc -= step
        el.scrollTop += step
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [auto, ui, busy, paged, flip])

  /* ---------------------------------------------------------- 书签 / 搜索 / 下载 */

  const marked = marks.some((m) => m.ch === pos.ch)

  async function toggleMark() {
    try {
      if (marked) {
        await removeMark(pos.ch)
        showToast('已取消书签')
      } else {
        const ps = peek(pos.ch)?.paragraphs || []
        const text = ps.length ? (ps[Math.min(ps.length - 1, Math.floor((pos.pct / 100) * ps.length))] || '').slice(0, 42) : ''
        await addMark(pos.ch, pos.pct, text ? `${text}……` : '')
        showToast('已添加书签')
      }
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : '操作失败')
    }
  }

  async function download() {
    setTopPop(false)
    try {
      await api.download(book.download_url)
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : '下载失败')
    }
  }

  const [q, setQ] = useState('')
  const [hits, setHits] = useState<SearchHit[] | null>(null)
  const [searching, setSearching] = useState(false)
  useEffect(() => {
    const kw = q.trim()
    if (!kw) {
      setHits(null)
      setSearching(false)
      return
    }
    setSearching(true)
    let alive = true
    const t = window.setTimeout(() => {
      readerApi
        .search(book.id, kw)
        .then((r) => alive && setHits(r))
        .catch(() => alive && setHits([]))
        .finally(() => alive && setSearching(false))
    }, 350)
    return () => {
      alive = false
      window.clearTimeout(t)
    }
  }, [q, book.id])

  useEffect(() => {
    if (ui !== 'drawer' || dtab !== 'toc') return
    requestAnimationFrame(() => document.querySelector('.rd-dr-item.cur')?.scrollIntoView({ block: 'center' }))
  }, [ui, dtab])

  /* ---------------------------------------------------------- 进度条 */

  const overall = total ? ((pos.ch + pos.pct / 100) / total) * 1000 : 0
  const [seek, setSeek] = useState<number | null>(null)
  const seekVal = seek ?? overall
  const seekCh = Math.min(last, Math.floor((seekVal / 1000) * total))
  function commitSeek() {
    if (seek == null) return
    const t = (seek / 1000) * total
    const ch = Math.min(last, Math.floor(t))
    setSeek(null)
    jump(ch, ch === last && seek >= 995 ? 100 : Math.round((t - ch) * 100))
  }

  /* ---------------------------------------------------------- 渲染 */

  const font = FONTS.find((f) => f[0] === S.font) || FONTS[0]
  const night = S.theme === 'night'
  const toggleNight = () =>
    setS((s) => (s.theme === 'night' ? { ...s, theme: s.prevTheme || 'parch' } : { ...s, prevTheme: s.theme, theme: 'night' }))
  const cycleFont = () => {
    const i = FONTS.findIndex((f) => f[0] === S.font)
    setS((s) => ({ ...s, font: FONTS[(i + 1) % FONTS.length][0] }))
  }

  const style = {
    '--fs': `${S.fs}px`,
    '--lh': S.lh,
    '--rf': font[2],
    '--dim': S.dim,
  } as React.CSSProperties

  const sections = useMemo(
    () =>
      secs.map((c) => (
        <section className="rd-m-sec" data-ch={c.index} key={c.index}>
          <h2 className="rd-m-ch">{c.title}</h2>
          <div className="rd-m-prose">
            {c.paragraphs.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
        </section>
      )),
    [secs],
  )

  const flowStyle: React.CSSProperties = {
    width: size.w - GAP,
    columnWidth: size.w - GAP,
    height: Math.max(120, size.h - 46 - 34),
    transform: `translateX(${-page * size.w}px)`,
  }

  const cls = [
    'rd-m',
    ui === 'menu' || ui === 'sheet' ? 'is-menu' : '',
    ui === 'sheet' ? 'is-sheet' : '',
    ui === 'drawer' ? 'is-drawer' : '',
    moreOpen ? 'more-open' : '',
    paged ? 'paged' : '',
    S.eye ? 'eye' : '',
  ]
    .filter(Boolean)
    .join(' ')

  const tocIdx = useMemo(() => {
    const a = book.chapters.map((_, i) => i)
    return desc ? a.reverse() : a
  }, [book.chapters, desc])

  const hl = (text: string) => {
    const kw = q.trim()
    if (!kw) return text
    return text.split(new RegExp(`(${escapeRe(kw)})`, 'gi')).map((part, i) =>
      part.toLowerCase() === kw.toLowerCase() ? <mark key={i}>{part}</mark> : <Fragment key={i}>{part}</Fragment>,
    )
  }

  const title = book.chapters[pos.ch]?.title || ''
  const atEnd = !paged && secs.length > 0 && secs[secs.length - 1].index === last

  return (
    <div className={cls} data-theme={S.theme} style={style} ref={rootRef}>
      <div
        className="rd-m-scroll"
        ref={scrollRef}
        onScroll={paged ? undefined : onScroll}
        onClick={onTap}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
        {paged ? (
          cur ? (
            <div className="rd-m-flow" ref={flowRef} style={flowStyle}>
              <h2 className="rd-m-ch">{cur.title}</h2>
              <div className="rd-m-prose">
                {cur.paragraphs.map((p, i) => (
                  <p key={i}>{p}</p>
                ))}
              </div>
            </div>
          ) : null
        ) : (
          <>
            {sections}
            {atEnd ? (
              <div className="rd-m-endstate">
                <BookOpen width={40} height={40} strokeWidth={1.3} />
                <b>全书完</b>
                <p>
                  {book.title}
                  <br />
                  感谢阅读
                </p>
                <Link to="/shelf" className="rd-cap" style={{ padding: '0 22px' }}>
                  回到书架
                </Link>
              </div>
            ) : null}
          </>
        )}
        {busy ? <div className="rd-m-loading">加载中…</div> : null}
      </div>

      <div className="rd-hdr">
        <span className="l">{title}</span>
        <span className="r">
          {battery != null ? (
            <i className="rd-bat">
              <b style={{ width: `${Math.max(8, Math.min(100, battery)) * 0.16}px` }} />
            </i>
          ) : null}
          {clock}
        </span>
      </div>

      <div className="rd-tint" />

      {/* 顶栏 */}
      <div className="rd-m-top">
        <Link className="rd-tb-btn back" to="/shelf">
          <ChevronLeft width={22} height={22} strokeWidth={1.8} />
          <span>书架</span>
        </Link>
        <span className="sp" />
        <button type="button" className={`rd-tb-btn ${marked ? 'on' : ''}`} onClick={toggleMark} aria-label="书签">
          <Bookmark width={21} height={21} strokeWidth={1.7} />
          {marks.length ? <span className="badge">{marks.length}</span> : null}
        </button>
        <button type="button" className="rd-tb-btn" onClick={() => setTopPop((v) => !v)} aria-label="更多">
          <Ellipsis width={22} height={22} strokeWidth={1.8} />
        </button>
      </div>
      {topPop && ui !== 'drawer' ? (
        <div className="rd-more-pop">
          <Link to="/shelf">返回书架</Link>
          <Link to={`/orders/${book.order_id}`}>订单详情</Link>
          <button type="button" onClick={download}>
            下载原文件
          </button>
        </div>
      ) : null}

      {/* 底栏 */}
      <div className="rd-m-bottom">
        <div className="rd-slide">
          <button type="button" disabled={pos.ch <= 0} onClick={() => jump(pos.ch - 1)}>
            上一章
          </button>
          <input
            type="range"
            min={0}
            max={1000}
            value={Math.round(seekVal)}
            onChange={(e) => setSeek(Number(e.target.value))}
            onPointerUp={commitSeek}
            onTouchEnd={commitSeek}
            onKeyUp={commitSeek}
            aria-label="阅读进度"
          />
          <button type="button" disabled={pos.ch >= last} onClick={() => jump(pos.ch + 1)}>
            下一章
          </button>
        </div>
        <div style={{ textAlign: 'center', fontSize: 11.5, color: 'var(--mute)', margin: '-2px 0 2px' }}>
          {seek != null
            ? `${book.chapters[seekCh]?.title}`
            : `第 ${pos.ch + 1} / ${total} 章 · 全书 ${Math.round(overall / 10)}%`}
        </div>
        <div className="rd-tabs">
          <button type="button" className="rd-tab" onClick={() => { setTopPop(false); setDtab('toc'); setUi('drawer') }}>
            <List width={22} height={22} strokeWidth={1.6} />
            目录
          </button>
          <button type="button" className="rd-tab" onClick={() => { setTopPop(false); setDtab('search'); setUi('drawer') }}>
            <Search width={22} height={22} strokeWidth={1.6} />
            搜索
          </button>
          <button type="button" className="rd-tab" onClick={toggleNight}>
            {night ? <Sun width={22} height={22} strokeWidth={1.6} /> : <Moon width={22} height={22} strokeWidth={1.6} />}
            {night ? '日间' : '夜间'}
          </button>
          <button type="button" className="rd-tab" onClick={() => { setTopPop(false); setUi('sheet') }}>
            <SlidersHorizontal width={22} height={22} strokeWidth={1.6} />
            设置
          </button>
        </div>
      </div>

      {/* 设置面板 */}
      <div className="rd-m-mask" onClick={() => setUi('')} />
      <div className="rd-m-sheet">
        <div className="rd-sh">
          <label>亮度</label>
          <SunDim className="ico" width={18} height={18} strokeWidth={1.6} />
          <input
            type="range"
            min={40}
            max={100}
            value={Math.round(100 - S.dim * 100)}
            onChange={(e) => setS((s) => ({ ...s, dim: (100 - Number(e.target.value)) / 100 }))}
            aria-label="亮度"
          />
          <Sun className="ico" width={20} height={20} strokeWidth={1.6} />
          <button type="button" className={`rd-sys-chk ${S.eye ? 'on' : ''}`} onClick={() => setS((s) => ({ ...s, eye: !s.eye }))}>
            <i />
            护眼
          </button>
        </div>
        <div className="rd-sh">
          <label>字号</label>
          <div className="rd-fsr">
            <button type="button" className="rd-cap" onClick={() => setS((s) => ({ ...s, fs: Math.max(14, s.fs - 1) }))}>
              A−
            </button>
            <span className="n">{S.fs}</span>
            <button type="button" className="rd-cap" onClick={() => setS((s) => ({ ...s, fs: Math.min(30, s.fs + 1) }))}>
              A+
            </button>
            <button type="button" className="rd-cap font" onClick={cycleFont}>
              {font[1]}
            </button>
          </div>
        </div>
        <div className="rd-sh">
          <label>背景</label>
          <div className="rd-bgs">
            {THEMES.map(([k, c, n]) => (
              <button
                type="button"
                key={k}
                title={n}
                className={`rd-bg ${S.theme === k ? 'on' : ''}`}
                style={{ background: c }}
                onClick={() => setS((s) => ({ ...s, theme: k }))}
              />
            ))}
          </div>
        </div>
        <div className="rd-quick">
          <button type="button" className="rd-tab" onClick={() => setS((s) => ({ ...s, mode: s.mode === 'page' ? 'scroll' : 'page' }))}>
            <BookOpen width={22} height={22} strokeWidth={1.6} />
            {paged ? '左右翻页' : '上下滑动'}
          </button>
          <button type="button" className={`rd-tab ${S.eye ? 'on' : ''}`} onClick={() => setS((s) => ({ ...s, eye: !s.eye }))}>
            <Eye width={22} height={22} strokeWidth={1.6} />
            护眼
          </button>
          <button
            type="button"
            className={`rd-tab ${auto ? 'on' : ''}`}
            onClick={() => {
              setAuto((a) => !a)
              setUi('')
            }}
          >
            {auto ? <Pause width={22} height={22} strokeWidth={1.6} /> : <Play width={22} height={22} strokeWidth={1.6} />}
            {auto ? '停止' : '自动阅读'}
          </button>
          <button type="button" className={`rd-tab ${moreOpen ? 'on' : ''}`} onClick={() => setMoreOpen((v) => !v)}>
            <Ellipsis width={22} height={22} strokeWidth={1.6} />
            更多
          </button>
        </div>
        <div className="rd-more">
          <div className="rd-sh" style={{ minHeight: 48 }}>
            <label>行距</label>
            <div className="rd-seg">
              {LHS.map(([v, n]) => (
                <button type="button" key={v} className={S.lh === v ? 'on' : ''} onClick={() => setS((s) => ({ ...s, lh: v }))}>
                  {n}
                </button>
              ))}
            </div>
          </div>
          <div className="rd-sh" style={{ minHeight: 48 }}>
            <label>翻页</label>
            <div className="rd-seg">
              <button type="button" className={!paged ? 'on' : ''} onClick={() => setS((s) => ({ ...s, mode: 'scroll' }))}>
                上下滑动
              </button>
              <button type="button" className={paged ? 'on' : ''} onClick={() => setS((s) => ({ ...s, mode: 'page' }))}>
                左右翻页
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 目录抽屉 */}
      <aside className="rd-m-drawer">
        <div className="rd-dr-head">
          <span className="rd-dr-cov">{book.cover_url ? <img src={book.cover_url} alt="" /> : book.title.slice(0, 1)}</span>
          <div>
            <b>{book.title}</b>
            <small>
              {book.author} · 共 {total} 章
            </small>
          </div>
        </div>
        <div className="rd-dr-tabs">
          <button type="button" className={dtab === 'toc' ? 'on' : ''} onClick={() => setDtab('toc')}>
            目录
          </button>
          <button type="button" className={dtab === 'bm' ? 'on' : ''} onClick={() => setDtab('bm')}>
            书签{marks.length ? ` ${marks.length}` : ''}
          </button>
          <button type="button" className={dtab === 'search' ? 'on' : ''} onClick={() => setDtab('search')}>
            搜索
          </button>
          {dtab === 'toc' ? (
            <button type="button" className="sort" onClick={() => setDesc((d) => !d)}>
              <ArrowDownUp width={14} height={14} strokeWidth={1.6} />
              {desc ? '正序' : '倒序'}
            </button>
          ) : null}
        </div>
        {dtab === 'search' ? (
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
            <label className="rd-dr-search">
              <Search width={16} height={16} strokeWidth={1.7} />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索全文" enterKeyHint="search" />
            </label>
            <ul className="rd-dr-list">
              {!q.trim() ? (
                <li className="rd-dr-empty">输入关键词，在全书中查找</li>
              ) : searching && !hits ? (
                <li className="rd-dr-empty">搜索中…</li>
              ) : hits && hits.length === 0 ? (
                <li className="rd-dr-empty">没有找到相关内容</li>
              ) : (
                hits?.map((h, i) => (
                  <li key={`${h.ch}-${i}`}>
                    <button type="button" className="rd-dr-hit" onClick={() => jump(h.ch, h.pct)}>
                      <b>{h.title}</b>
                      <p>{hl(h.snippet)}</p>
                    </button>
                  </li>
                ))
              )}
            </ul>
          </div>
        ) : dtab === 'bm' ? (
          <ul className="rd-dr-list">
            {marks.length ? (
              marks.map((m) => (
                <li key={m.ch}>
                  <div className="rd-dr-bm" role="button" onClick={() => jump(m.ch, m.pct)}>
                    <b>{book.chapters[m.ch]?.title}</b>
                    <p>{m.text}</p>
                    <small>{fmtBeijingDate(m.created_at)}</small>
                    <button
                      type="button"
                      style={{ position: 'absolute', right: 18, bottom: 12, fontSize: 12, color: 'var(--mute)' }}
                      onClick={(e) => {
                        e.stopPropagation()
                        removeMark(m.ch).catch(() => showToast('删除失败'))
                      }}
                    >
                      删除
                    </button>
                  </div>
                </li>
              ))
            ) : (
              <li className="rd-dr-empty">
                还没有书签
                <br />
                点击顶栏的书签图标即可添加
              </li>
            )}
          </ul>
        ) : (
          <ul className="rd-dr-list">
            {tocIdx.map((i) => (
              <li key={i}>
                <button
                  type="button"
                  className={`rd-dr-item ${i === pos.ch ? 'cur' : readSet.has(i) ? 'read' : ''}`}
                  onClick={() => jump(i)}
                >
                  <span className="t">{book.chapters[i].title}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>

      <div className={`rd-m-toast ${toast ? 'show' : ''}`}>{toast}</div>
      <div className="rd-dim" />
    </div>
  )
}
