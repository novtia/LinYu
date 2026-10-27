import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import qrcode from 'qrcode-generator'
import {
  ArrowDownUp,
  BookOpen,
  Bookmark,
  Check,
  Clock,
  Download,
  FileText,
  Home,
  List,
  Moon,
  SlidersHorizontal,
  Smartphone,
  Sun,
  User,
  X,
} from 'lucide-react'
import { ApiError, api } from '../../lib/api'
import { fmtBeijingClock, fmtBeijingDate } from '../../lib/time'
import { loadLocal, saveLocal, type ChapterData } from '../../lib/reader'
import type { ReaderCore } from './useReaderBook'

const FONTS: Record<string, string> = {
  yahei: '"Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif',
  song: 'SimSun, "Songti SC", "Noto Serif SC", serif',
  kai: 'KaiTi, STKaiti, "Noto Serif SC", serif',
  hei: 'SimHei, "Heiti SC", "Noto Sans SC", sans-serif',
}
const FONT_NAMES: [string, string][] = [['yahei', '雅黑'], ['song', '宋体'], ['kai', '楷体'], ['hei', '黑体']]
const THEMES: [string, string, string][] = [
  ['cream', '#f5f1e6', '米黄'],
  ['white', '#ffffff', '白'],
  ['green', '#dfecd8', '护眼绿'],
  ['pink', '#f8e7e3', '淡粉'],
  ['night', '#232323', '夜间'],
]
const WIDTHS = [640, 800, 900, 1000, 1280]
const LINE_HEIGHTS: [number, string][] = [[1.5, '紧凑'], [1.75, '标准'], [2.1, '宽松']]
const KEY = 'lx-reader-pc'

interface PCSettings {
  theme: string
  prev: string
  font: string
  fs: number
  w: number
  lh: number
}
const DEFAULTS: PCSettings = { theme: 'cream', prev: 'cream', font: 'yahei', fs: 18, w: 800, lh: 1.75 }

function qrSvg(text: string) {
  const qr = qrcode(0, 'M')
  qr.addData(text)
  qr.make()
  return qr.createSvgTag({ cellSize: 4, margin: 0, scalable: true })
}

export function ReaderPC({ core }: { core: ReaderCore }) {
  const { book, marks, readSet, start, loadChapter, peek, report, addMark, removeMark } = core
  const [search] = useSearchParams()
  const total = book.chapters.length
  const last = total - 1

  const [S, setS] = useState<PCSettings>(() => loadLocal(KEY, DEFAULTS))
  const initial = useMemo(() => {
    const q = Number(search.get('c'))
    return Number.isInteger(q) && q >= 0 && q <= last ? { ch: q, pct: 0 } : start
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [cur, setCur] = useState(initial.ch)
  // 无限滚动：已载入的连续章节（升序）
  const [secs, setSecs] = useState<ChapterData[]>(() => {
    const c = peek(initial.ch)
    return c ? [c] : []
  })
  const secsRef = useRef<ChapterData[]>(secs)
  secsRef.current = secs
  const [failed, setFailed] = useState('')
  const [retry, setRetry] = useState(0)
  const [pop, setPop] = useState<'' | 'set' | 'qr'>('')
  const [modal, setModal] = useState<'' | 'toc' | 'bm'>('')
  const [desc, setDesc] = useState(false)
  const [toast, setToast] = useState('')
  const restore = useRef<{ ch: number; pct: number } | null>({ ch: initial.ch, pct: initial.pct })
  const anchor = useRef<{ h: number; top: number } | null>(null)
  const loadingNext = useRef(false)
  const loadingPrev = useRef(false)
  const toastTimer = useRef(0)
  const curRef = useRef(initial.ch)
  curRef.current = cur
  const posRef = useRef(initial)
  const tok = useRef(0)

  const showToast = useCallback((m: string) => {
    setToast(m)
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(''), 1700)
  }, [])

  // 设置：写回本地并作用在根节点
  useEffect(() => {
    saveLocal(KEY, S)
  }, [S])

  // 夜间主题时让整页（含过度滚动区域）也是暗色
  useEffect(() => {
    const bg: Record<string, string> = { cream: '#e6dfcb', white: '#f0f0f0', green: '#c8dbc3', pink: '#ecd4d0', night: '#151515' }
    const prev = [document.body.style.backgroundImage, document.body.style.backgroundColor]
    document.body.style.backgroundImage = 'none'
    document.body.style.backgroundColor = bg[S.theme] || bg.cream
    return () => {
      document.body.style.backgroundImage = prev[0]
      document.body.style.backgroundColor = prev[1]
    }
  }, [S.theme])

  const LINE = 110 // 阅读基准线：距视口顶部的像素

  const docTop = (el: HTMLElement) => el.getBoundingClientRect().top + window.scrollY

  const scrollToPos = useCallback((ch: number, pct: number) => {
    const el = document.querySelector<HTMLElement>(`[data-ch="${ch}"]`)
    if (!el) return
    const top = docTop(el)
    const first = secsRef.current[0]?.index === ch
    const y = pct <= 0 ? (first ? 0 : top - 16) : top + (pct / 100) * el.offsetHeight - LINE
    window.scrollTo({ top: Math.max(0, Math.round(y)), behavior: 'instant' as ScrollBehavior })
  }, [])

  // 首次载入起始章节
  useEffect(() => {
    if (secsRef.current.length) return
    let alive = true
    setFailed('')
    loadChapter(initial.ch)
      .then((c) => alive && setSecs([c]))
      .catch((e) => alive && setFailed(e instanceof ApiError ? e.message : '章节加载失败'))
    return () => {
      alive = false
    }
  }, [initial.ch, loadChapter, retry])

  // 接近底部 / 顶部时补充章节
  const pump = useCallback(() => {
    const list = secsRef.current
    if (!list.length) return
    const lastI = list[list.length - 1].index
    const firstI = list[0].index
    const doc = document.documentElement
    if (window.scrollY + window.innerHeight > doc.scrollHeight - 1400 && lastI < last && !loadingNext.current) {
      loadingNext.current = true
      loadChapter(lastI + 1)
        .then((c) => setSecs((s) => (s.some((x) => x.index === c.index) || s[s.length - 1]?.index !== lastI ? s : [...s, c])))
        .catch(() => {})
        .finally(() => {
          loadingNext.current = false
        })
    }
    if (window.scrollY < 700 && firstI > 0 && !loadingPrev.current) {
      loadingPrev.current = true
      loadChapter(firstI - 1)
        .then((c) => {
          anchor.current = { h: doc.scrollHeight, top: window.scrollY }
          setSecs((s) => (s.some((x) => x.index === c.index) || s[0]?.index !== firstI ? s : [c, ...s]))
        })
        .catch(() => {})
        .finally(() => {
          loadingPrev.current = false
        })
    }
  }, [last, loadChapter])

  // 章节列表变化后：回到上次位置 / 补偿向上插入造成的跳动
  useLayoutEffect(() => {
    if (!secs.length) return
    if (restore.current) {
      const r = restore.current
      restore.current = null
      scrollToPos(r.ch, r.pct)
      posRef.current = { ch: r.ch, pct: r.pct }
      setCur(r.ch)
      report(r.ch, r.pct)
    } else if (anchor.current) {
      const a = anchor.current
      anchor.current = null
      window.scrollTo({ top: a.top + (document.documentElement.scrollHeight - a.h), behavior: 'instant' as ScrollBehavior })
    }
    pump()
  }, [secs, pump, scrollToPos, report])

  // 滚动：判断当前章、上报进度、按需加载
  useEffect(() => {
    let raf = 0
    const onScroll = () => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        const line = window.scrollY + LINE
        let hit: HTMLElement | null = null
        for (const n of Array.from(document.querySelectorAll<HTMLElement>('[data-ch]'))) {
          if (docTop(n) <= line) hit = n
        }
        if (hit) {
          const n: HTMLElement = hit
          const ch = Number(n.dataset.ch)
          const pct = Math.max(0, Math.min(100, Math.round(((line - docTop(n)) / Math.max(1, n.offsetHeight)) * 100)))
          posRef.current = { ch, pct }
          if (ch !== curRef.current) setCur(ch)
          if (!modal) report(ch, pct)
        }
        pump()
      })
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [modal, pump, report])

  useEffect(() => {
    const t = book.chapters[cur]?.title
    if (t) document.title = `${t} - ${book.title} - 领匣阅读`
  }, [cur, book])

  const go = useCallback(
    (i: number, pct = 0) => {
      const n = Math.max(0, Math.min(last, i))
      setModal('')
      if (secsRef.current.some((s) => s.index === n)) {
        scrollToPos(n, pct)
        return
      }
      const t = ++tok.current
      loadChapter(n)
        .then((c) => {
          if (t !== tok.current) return
          restore.current = { ch: n, pct }
          setSecs([c])
        })
        .catch((e) => showToast(e instanceof ApiError ? e.message : '章节加载失败'))
    },
    [last, loadChapter, scrollToPos, showToast],
  )

  // 键盘：← → 切章，Esc 关弹层
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setModal('')
        setPop('')
        return
      }
      if (modal) return
      const t = e.target as HTMLElement
      if (t && /input|textarea|select/i.test(t.tagName)) return
      if (e.key === 'ArrowLeft') go(curRef.current - 1)
      if (e.key === 'ArrowRight') go(curRef.current + 1)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [go, modal])

  // 点空白关设置 / 二维码气泡
  useEffect(() => {
    if (!pop) return
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.rd-side')) setPop('')
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [pop])

  const marked = marks.some((m) => m.ch === cur)

  async function toggleMark() {
    try {
      if (marked) {
        await removeMark(cur)
        showToast('已取消书签')
      } else {
        const ps = peek(cur)?.paragraphs || []
        const pct = posRef.current.ch === cur ? posRef.current.pct : 0
        const text = ps.length ? (ps[Math.min(ps.length - 1, Math.floor((pct / 100) * ps.length))] || '').slice(0, 42) : ''
        await addMark(cur, pct, text ? `${text}……` : '')
        showToast('已添加书签')
      }
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : '操作失败')
    }
  }

  async function download() {
    try {
      await api.download(book.download_url)
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : '下载失败')
    }
  }

  const night = S.theme === 'night'
  function toggleNight() {
    setS((s) => (s.theme === 'night' ? { ...s, theme: s.prev || 'cream' } : { ...s, prev: s.theme, theme: 'night' }))
  }

  const readUrl = `${location.origin}/read/${encodeURIComponent(book.id)}`
  const qr = useMemo(() => (pop === 'qr' ? qrSvg(readUrl) : ''), [pop, readUrl])
  const pctBook = Math.round(((cur + 1) / total) * 100)

  // 章节正文：每章完整渲染，章与章之间用分隔线衔接
  const sections = useMemo(
    () =>
      secs.map((c) => (
        <section className="rd-sec" data-ch={c.index} key={c.index}>
          <h1 className="rd-title">{c.title}</h1>
          <div className="rd-meta">
            <span>
              <User width={13} height={13} strokeWidth={1.8} />
              {book.author}
            </span>
            <span>
              <BookOpen width={13} height={13} strokeWidth={1.8} />
              {book.fmt} 文件
            </span>
            <span>
              <FileText width={13} height={13} strokeWidth={1.8} />
              本章字数：{c.words}字
            </span>
            <span>
              <Clock width={13} height={13} strokeWidth={1.8} />第 {c.index + 1} / {total} 章
            </span>
          </div>
          <article className="rd-prose">
            {c.paragraphs.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </article>
          {c.index < last ? <div className="rd-done">本章完</div> : null}
        </section>
      )),
    [secs, book.author, book.fmt, total, last],
  )

  const style = {
    '--fs': `${S.fs}px`,
    '--lh': S.lh,
    '--w': `${S.w}px`,
    '--ff': FONTS[S.font] || FONTS.yahei,
  } as React.CSSProperties

  const tocIdx = useMemo(() => {
    const idx = book.chapters.map((_, i) => i)
    return desc ? idx.reverse() : idx
  }, [book.chapters, desc])
  const mainEnd = useMemo(() => {
    // 把“番外 / 后记”等放到单独一栏
    const first = book.chapters.findIndex((c, i) => i > 0 && /^(番外|后记|尾声|终章|附录|Epilogue)/i.test(c.title.trim()))
    return first < 0 ? total : first
  }, [book.chapters, total])

  useEffect(() => {
    if (modal !== 'toc') return
    requestAnimationFrame(() => document.querySelector('.rd-chs a.cur')?.scrollIntoView({ block: 'center' }))
  }, [modal])

  const tocItem = (i: number) => (
    <li key={i}>
      <a className={i === cur ? 'cur' : readSet.has(i) ? 'read' : ''} onClick={() => go(i)}>
        <span className="t">{book.chapters[i].title}</span>
        <span className="w">{book.chapters[i].words}字</span>
      </a>
    </li>
  )

  return (
    <div className="rd-pc" data-theme={S.theme} style={style}>
      <main className="rd-wrap">
        <nav className="rd-crumb">
          <Home width={13} height={13} strokeWidth={1.8} />
          <Link to="/">领匣</Link>
          <span className="sep">›</span>
          <Link to="/shelf">我的书架</Link>
          <span className="sep">›</span>
          <Link to={`/orders/${book.order_id}`}>《{book.title}》</Link>
          <span className="sep">›</span>
          <span>{book.chapters[cur]?.title}</span>
        </nav>
        <div className="rd-ribbon-wrap">
          <button type="button" className={`rd-ribbon ${marked ? 'on' : ''}`} title={marked ? '取消书签' : '添加书签'} onClick={toggleMark}>
            <svg viewBox="0 0 24 40">
              <path d="M0 0h24v40l-12-9.5L0 40z" />
            </svg>
          </button>
        </div>

        {sections}

        {!secs.length ? (
          failed ? (
            <div className="rd-load">
              {failed}
              <br />
              <button type="button" style={{ marginTop: 12, color: 'var(--red)' }} onClick={() => setRetry((n) => n + 1)}>
                重新加载
              </button>
            </div>
          ) : (
            <div className="rd-load">加载中…</div>
          )
        ) : secs[secs.length - 1].index < last ? (
          <div className="rd-load" style={{ padding: '36px 0' }}>
            加载下一章…
          </div>
        ) : (
          <section className="rd-end">
            <div className="rd-done">全书完</div>
            <div className="rd-nav3">
              <a onClick={() => go(0)}>回到第一章</a>
              <a onClick={() => setModal('toc')}>目录</a>
              <Link to="/shelf">回到书架</Link>
            </div>
            <p className="rd-tip">
              可用键盘 <kbd>←</kbd> <kbd>→</kbd> 切换章节 · 阅读进度已同步到云端，换设备自动续读
            </p>
          </section>
        )}
      </main>

      <nav className="rd-side">
        <button type="button" onClick={() => { setPop(''); setModal('toc') }}>
          <List width={22} height={22} strokeWidth={1.6} />
          <span>目录</span>
        </button>
        <button type="button" onClick={() => { setPop(''); setModal('bm') }}>
          <Bookmark width={22} height={22} strokeWidth={1.6} />
          <span>书签</span>
          {marks.length ? <b className="dot" /> : null}
        </button>
        <button type="button" onClick={download}>
          <Download width={22} height={22} strokeWidth={1.6} />
          <span>下载</span>
        </button>
        <button type="button" onClick={toggleNight}>
          {night ? <Sun width={22} height={22} strokeWidth={1.6} /> : <Moon width={22} height={22} strokeWidth={1.6} />}
          <span>{night ? '日间' : '夜间'}</span>
        </button>
        <button type="button" className={pop === 'set' ? 'on' : ''} onClick={() => setPop((p) => (p === 'set' ? '' : 'set'))}>
          <SlidersHorizontal width={22} height={22} strokeWidth={1.6} />
          <span>设置</span>
        </button>
        <button type="button" className={pop === 'qr' ? 'on' : ''} onClick={() => setPop((p) => (p === 'qr' ? '' : 'qr'))}>
          <Smartphone width={22} height={22} strokeWidth={1.6} />
          <span>手机阅读</span>
        </button>

        <div className={`rd-pop rd-pop-set ${pop === 'set' ? 'open' : ''}`}>
          <div className="rd-row">
            <label>阅读主题</label>
            <div className="rd-sws">
              {THEMES.map(([k, c, n]) => (
                <button
                  type="button"
                  key={k}
                  title={n}
                  className={`rd-sw ${S.theme === k ? 'on' : ''}`}
                  style={{ background: c }}
                  onClick={() => setS((s) => ({ ...s, theme: k }))}
                >
                  <Check width={18} height={18} strokeWidth={2.4} />
                </button>
              ))}
            </div>
          </div>
          <div className="rd-row">
            <label>正文字体</label>
            <div className="rd-opts">
              {FONT_NAMES.map(([k, n]) => (
                <button type="button" key={k} className={`rd-opt ${S.font === k ? 'on' : ''}`} onClick={() => setS((s) => ({ ...s, font: k }))}>
                  {n}
                </button>
              ))}
            </div>
          </div>
          <div className="rd-row">
            <label>字体大小</label>
            <div className="rd-stepper">
              <button type="button" onClick={() => setS((s) => ({ ...s, fs: Math.max(12, s.fs - 1) }))}>
                −
              </button>
              <b>{S.fs}</b>
              <button type="button" onClick={() => setS((s) => ({ ...s, fs: Math.min(32, s.fs + 1) }))}>
                +
              </button>
            </div>
          </div>
          <div className="rd-row">
            <label>页面宽度</label>
            <div className="rd-opts">
              {WIDTHS.map((w) => (
                <button type="button" key={w} className={`rd-opt ${S.w === w ? 'on' : ''}`} onClick={() => setS((s) => ({ ...s, w }))}>
                  {w}
                </button>
              ))}
            </div>
          </div>
          <div className="rd-row">
            <label>行间距</label>
            <div className="rd-opts">
              {LINE_HEIGHTS.map(([v, n]) => (
                <button type="button" key={v} className={`rd-opt ${S.lh === v ? 'on' : ''}`} onClick={() => setS((s) => ({ ...s, lh: v }))}>
                  {n}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className={`rd-pop rd-pop-qr ${pop === 'qr' ? 'open' : ''}`}>
          <div className="rd-qr" dangerouslySetInnerHTML={{ __html: qr }} />
          <b>手机扫码继续阅读</b>
          <small>
            登录同一账号，进度自动同步
            <br />
            需先在手机浏览器打开领匣
          </small>
        </div>
      </nav>

      <div className={`rd-mask ${modal ? 'open' : ''}`} onMouseDown={(e) => e.target === e.currentTarget && setModal('')}>
        <div className="rd-modal" role="dialog" aria-label="目录">
          <div className="rd-md-head">
            <span className="rd-md-cover">{book.cover_url ? <img src={book.cover_url} alt="" /> : book.title.slice(0, 1)}</span>
            <div>
              <h3>{book.title}</h3>
              <p>
                {book.author} · {book.fmt} · 共 {total} 章 · 已读 {pctBook}%
              </p>
            </div>
            <span className="grow" />
            <button type="button" className="rd-x" onClick={() => setModal('')}>
              <X width={20} height={20} strokeWidth={1.6} />
            </button>
          </div>
          <div className="rd-md-tabs">
            <button type="button" className={modal === 'toc' ? 'on' : ''} onClick={() => setModal('toc')}>
              目录
            </button>
            <button type="button" className={modal === 'bm' ? 'on' : ''} onClick={() => setModal('bm')}>
              书签
            </button>
            {modal === 'toc' ? (
              <button type="button" className="sort" onClick={() => setDesc((d) => !d)}>
                <ArrowDownUp width={15} height={15} strokeWidth={1.6} />
                <span>{desc ? '正序' : '倒序'}</span>
              </button>
            ) : null}
          </div>
          <div className="rd-md-body">
            {modal === 'bm' ? (
              marks.length ? (
                <ul className="rd-bms">
                  {marks.map((m) => (
                    <li key={m.ch}>
                      <div className="i" onClick={() => go(m.ch, m.pct)}>
                        <b>{book.chapters[m.ch]?.title}</b>
                        <p>{m.text}</p>
                      </div>
                      <small>{`${fmtBeijingDate(m.created_at)} ${fmtBeijingClock(m.created_at)}`}</small>
                      <button type="button" className="del" onClick={() => removeMark(m.ch).catch(() => showToast('删除失败'))}>
                        删除
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="rd-empty">
                  还没有书签
                  <br />
                  <small>点击正文右上角的书签丝带即可添加</small>
                </div>
              )
            ) : mainEnd < total ? (
              (() => {
                const parts = [
                  { name: '正文', ids: tocIdx.filter((i) => i < mainEnd) },
                  { name: '番外', ids: tocIdx.filter((i) => i >= mainEnd) },
                ]
                return (desc ? parts.reverse() : parts).map((p) => (
                  <div key={p.name}>
                    <div className="rd-vol">
                      {p.name}
                      <small>共 {p.ids.length} 章</small>
                    </div>
                    <ul className="rd-chs">{p.ids.map(tocItem)}</ul>
                  </div>
                ))
              })()
            ) : (
              <ul className="rd-chs" style={{ marginTop: 10 }}>
                {tocIdx.map(tocItem)}
              </ul>
            )}
          </div>
        </div>
      </div>

      <div className={`rd-toast ${toast ? 'show' : ''}`}>{toast}</div>
    </div>
  )
}
