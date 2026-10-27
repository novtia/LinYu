import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  BookOpen,
  ChevronRight,
  Download,
  Info,
  LayoutGrid,
  List,
  Lock,
  MessageSquare,
  MoreHorizontal,
  Play,
  ReceiptText,
  Search,
  ArrowDownUp,
  ShoppingBag,
} from 'lucide-react'
import { ApiError, api } from '../lib/api'
import {
  boughtLabel,
  hueOf,
  isReading,
  lastReadLabel,
  loadLocal,
  readLabel,
  readerApi,
  saveLocal,
  wordsLabel,
  type ShelfBook,
} from '../lib/reader'
import { parseServerTime } from '../lib/time'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { BookCover } from '../components/BookCover'
import '../styles/shelf.css'

type Tab = 'all' | 'text' | 'commission'
type Sort = 'recent' | 'bought' | 'title'
type View = 'grid' | 'list'

interface Action {
  cls: string
  icon: typeof Play
  text: string
}

function actionOf(b: ShelfBook): Action {
  if (b.state === 'locked') return { cls: 'sf-warn-btn', icon: Lock, text: '支付尾款解锁' }
  if (b.state === 'making') return { cls: 'sf-soft-btn', icon: MessageSquare, text: '查看进度' }
  if (b.state === 'download') return { cls: 'sf-soft-btn', icon: Download, text: '下载文件' }
  const finished = b.pct >= 100
  return {
    cls: finished ? 'sf-soft-btn' : 'sf-teal-btn',
    icon: Play,
    text: !b.started ? '开始阅读' : finished ? '再读一遍' : '继续阅读',
  }
}

export function ShelfPage() {
  const { user, loading: authLoading, publicSettings, openAuth } = useAuth()
  const { showToast } = useToast()
  const navigate = useNavigate()
  const [books, setBooks] = useState<ShelfBook[]>([])
  const [busy, setBusy] = useState(true)
  const [tab, setTab] = useState<Tab>('all')
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<Sort>('recent')
  const [view, setView] = useState<View>(() => loadLocal<{ v: View }>('lx-shelf-view', { v: 'grid' }).v)
  const [menuId, setMenuId] = useState<string | null>(null)
  const brand = publicSettings?.name || '领匣'

  useEffect(() => {
    if (authLoading) return
    if (!user) {
      setBooks([])
      setBusy(false)
      openAuth('login')
      return
    }
    let alive = true
    setBusy(true)
    readerApi
      .shelf()
      .then((list) => alive && setBooks(list))
      .catch((e) => alive && showToast(e instanceof ApiError ? e.message : '书架加载失败'))
      .finally(() => alive && setBusy(false))
    return () => {
      alive = false
    }
  }, [user, authLoading, openAuth, showToast])

  useEffect(() => {
    saveLocal('lx-shelf-view', { v: view })
  }, [view])

  // 点空白处 / Esc 关闭“更多”菜单
  useEffect(() => {
    if (!menuId) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement
      if (!t.closest('.sf-menu') && !t.closest('[data-more]')) setMenuId(null)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenuId(null)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuId])

  const counts = useMemo(
    () => ({
      all: books.length,
      text: books.filter((b) => b.kind === 'text').length,
      commission: books.filter((b) => b.kind === 'commission').length,
    }),
    [books],
  )
  const lead = useMemo(
    () => ({
      reading: books.filter(isReading).length,
      locked: books.filter((b) => b.state === 'locked').length,
      making: books.filter((b) => b.state === 'making').length,
    }),
    [books],
  )

  const visible = useMemo(() => {
    let list = books.filter((b) => tab === 'all' || b.kind === tab)
    const kw = q.trim().toLowerCase()
    if (kw) list = list.filter((b) => `${b.title}${b.author}`.toLowerCase().includes(kw))
    const time = (iso?: string | null) => parseServerTime(iso)?.getTime() ?? 0
    const cmp: Record<Sort, (a: ShelfBook, b: ShelfBook) => number> = {
      recent: (a, b) => time(b.last_at) - time(a.last_at) || time(b.bought_at) - time(a.bought_at),
      bought: (a, b) => time(b.bought_at) - time(a.bought_at),
      title: (a, b) => a.title.localeCompare(b.title, 'zh'),
    }
    return [...list].sort(cmp[sort])
  }, [books, tab, q, sort])

  const resume = useMemo(
    () =>
      books
        .filter(isReading)
        .sort((a, b) => (b.last_at || '').localeCompare(a.last_at || '')),
    [books],
  )

  const menuBook = menuId ? books.find((b) => b.id === menuId) || null : null

  const runAction = useCallback(
    async (b: ShelfBook) => {
      if (b.state === 'locked') return navigate(`/orders/${b.order_id}`)
      if (b.state === 'making') return navigate(`/commissions?order=${encodeURIComponent(b.order_id)}`)
      if (b.state === 'download') {
        try {
          if (b.download_url) await api.download(b.download_url)
        } catch (e) {
          showToast(e instanceof ApiError ? e.message : '下载失败')
        }
        return
      }
      navigate(`/read/${encodeURIComponent(b.id)}`)
    },
    [navigate, showToast],
  )

  async function onMenu(kind: 'order' | 'dl' | 'chat') {
    const b = menuBook
    setMenuId(null)
    if (!b) return
    if (kind === 'order') navigate(`/orders/${b.order_id}`)
    if (kind === 'chat') navigate(`/commissions?order=${encodeURIComponent(b.order_id)}`)
    if (kind === 'dl' && b.download_url) {
      try {
        await api.download(b.download_url)
      } catch (e) {
        showToast(e instanceof ApiError ? e.message : '下载失败')
      }
    }
  }

  const metaOf = (b: ShelfBook) => (
    <>
      {b.kind === 'commission' ? (
        <span className="sf-badge">约稿</span>
      ) : null}
      <span>{b.kind === 'commission' ? wordsLabel(b.words) : b.author}</span>
      <span className="sf-fmt">{b.fmt}</span>
      {b.kind !== 'commission' && b.words ? <span>{wordsLabel(b.words)}</span> : null}
    </>
  )

  const statusOf = (b: ShelfBook) => {
    const l = readLabel(b)
    return (
      <span className={`sf-st ${l.tone} ${l.pulse ? 'pulse' : ''}`}>
        <i />
        {l.text}
      </span>
    )
  }

  const menuOf = (b: ShelfBook) => {
    const canDl = b.state === 'ready' || b.state === 'download'
    const dlText = canDl ? '下载原文件' : b.state === 'locked' ? '付清尾款后可下载' : '交稿后可下载'
    return (
      <div className="sf-menu">
        <div className="mh">
          <b>{b.title}</b>
          <span>订单 {b.order_id}</span>
        </div>
        <button type="button" onClick={() => onMenu('order')}>
          <ReceiptText width={16} height={16} strokeWidth={1.8} />
          查看订单详情
        </button>
        <button type="button" disabled={!canDl} onClick={() => onMenu('dl')}>
          <Download width={16} height={16} strokeWidth={1.8} />
          {dlText}
        </button>
        {b.kind === 'commission' ? (
          <button type="button" onClick={() => onMenu('chat')}>
            <MessageSquare width={16} height={16} strokeWidth={1.8} />
            联系作者 / 约稿沟通
          </button>
        ) : null}
      </div>
    )
  }

  const actionsOf = (b: ShelfBook) => {
    const a = actionOf(b)
    const Icon = a.icon
    return (
      <div className="sf-ba">
        <button type="button" className={a.cls} onClick={() => runAction(b)}>
          <Icon width={14} height={14} strokeWidth={1.8} />
          {a.text}
        </button>
        <button
          type="button"
          className="sf-icon-btn"
          data-more
          aria-label="更多"
          onClick={() => setMenuId((cur) => (cur === b.id ? null : b.id))}
        >
          <MoreHorizontal width={16} height={16} strokeWidth={1.8} />
        </button>
        {menuId === b.id ? menuOf(b) : null}
      </div>
    )
  }

  if (authLoading || (user && busy && !books.length)) {
    return (
      <main className="sf-page">
        <div className="wrap py-20 text-center text-ink-mute">加载中…</div>
      </main>
    )
  }

  if (!user) {
    return (
      <main className="sf-page">
        <div className="wrap">
          <div className="sf-empty">
            <div className="e-ico">
              <BookOpen width={24} height={24} strokeWidth={1.8} />
            </div>
            <h2>登录后查看我的书架</h2>
            <p>
              你购买过的文本与专属约稿，支付成功后会自动上架到这里。
              <br />
              游客只能在订单页下载文件。
            </p>
            <button
              type="button"
              className="sf-teal-btn lg"
              onClick={() => openAuth('login')}
            >
              登录
            </button>
          </div>
        </div>
      </main>
    )
  }

  const top = resume[0]
  const side = resume.slice(1, 3)

  return (
    <>
      <main className="sf-page">
        <div className="wrap">
          <header className="sf-head">
            <div>
              <h1>我的书架</h1>
              <p className="sf-lead">
                共 <b>{books.length}</b> 本 · <b>{lead.reading}</b> 本在读 · <b>{lead.locked}</b> 本待付尾款 ·{' '}
                <b>{lead.making}</b> 本创作中
              </p>
            </div>
            <Link to="/" className="sf-ghost">
              <ShoppingBag width={15} height={15} strokeWidth={1.8} />
              去商城选书
            </Link>
          </header>

          {top ? (
            <section className="sf-resume">
              <div
                className="sf-rs-main"
                style={{ '--h': hueOf(top.id) } as CSSProperties}
                onClick={() => runAction(top)}
              >
                <div className="sf-rs-cover">
                  <BookCover book={top} />
                </div>
                <div className="sf-rs-info">
                  <div className="sf-eyebrow">CONTINUE READING</div>
                  <h2>{top.title}</h2>
                  <p>
                    读至 {top.ch_title || `第 ${top.ch + 1} 章`}
                    <br />
                    {lastReadLabel(top.last_at)} · 共 {top.chapters} 章 · {top.fmt}
                    {top.kind === 'commission' ? ' · 专属约稿' : ''}
                  </p>
                  <div className="sf-rs-prog">
                    <div className="sf-pbar">
                      <i style={{ width: `${top.pct}%` }} />
                    </div>
                    <b>{top.pct}%</b>
                  </div>
                  <button type="button" className="sf-teal-btn lg">
                    <Play width={14} height={14} strokeWidth={1.8} />
                    继续阅读
                  </button>
                </div>
              </div>
              <div className="sf-rs-side">
                <h3>RECENTLY READ</h3>
                {side.map((x) => (
                  <button type="button" key={x.id} className="sf-rs-item" onClick={() => runAction(x)}>
                    <BookCover book={x} />
                    <div>
                      <b>{x.title}</b>
                      <span>
                        {x.ch_title || `第 ${x.ch + 1} 章`} · {x.pct}%
                      </span>
                    </div>
                    <i>
                      <ChevronRight width={16} height={16} strokeWidth={1.8} />
                    </i>
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          <div className="sf-toolbar">
            <div className="sf-tabs">
              {(
                [
                  ['all', '全部'],
                  ['text', '商城文本'],
                  ['commission', '我的约稿'],
                ] as [Tab, string][]
              ).map(([k, label]) => (
                <button type="button" key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
                  {label} <span className="c">{counts[k]}</span>
                </button>
              ))}
            </div>
            <div className="sf-tools">
              <label className="sf-field">
                <Search width={15} height={15} strokeWidth={1.8} />
                <input
                  type="search"
                  placeholder="搜索书名 / 作者"
                  autoComplete="off"
                  value={q}
                  onChange={(e) => {
                    setQ(e.target.value)
                    setMenuId(null)
                  }}
                />
              </label>
              <label className="sf-field sort">
                <ArrowDownUp width={15} height={15} strokeWidth={1.8} />
                <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
                  <option value="recent">最近阅读</option>
                  <option value="bought">购买时间</option>
                  <option value="title">书名</option>
                </select>
              </label>
              <div className="sf-seg">
                <button type="button" className={view === 'grid' ? 'on' : ''} title="封面视图" onClick={() => setView('grid')}>
                  <LayoutGrid width={16} height={16} strokeWidth={1.8} />
                </button>
                <button type="button" className={view === 'list' ? 'on' : ''} title="列表视图" onClick={() => setView('list')}>
                  <List width={16} height={16} strokeWidth={1.8} />
                </button>
              </div>
            </div>
          </div>

          {visible.length ? (
            <div className={`sf-shelf ${view}`}>
              {visible.map((b, i) =>
                view === 'grid' ? (
                  <article key={b.id} className="sf-bk" style={{ animationDelay: `${Math.min(i, 12) * 40}ms` }}>
                    <BookCover book={b} onOpen={() => runAction(b)} />
                    <div className="sf-bi">
                      <h3 title={b.title} onClick={() => runAction(b)}>
                        {b.title}
                      </h3>
                      <div className="sf-meta">{metaOf(b)}</div>
                      {b.state === 'ready' ? (
                        <div className="sf-pbar">
                          <i style={{ width: `${b.pct}%` }} />
                        </div>
                      ) : (
                        <div style={{ height: 10 }} />
                      )}
                      {statusOf(b)}
                    </div>
                    {actionsOf(b)}
                  </article>
                ) : (
                  <article key={b.id} className="sf-lr" style={{ animationDelay: `${Math.min(i, 12) * 30}ms` }}>
                    <div className="sf-mini">
                      <BookCover book={b} onOpen={() => runAction(b)} />
                    </div>
                    <div>
                      <h3 onClick={() => runAction(b)}>
                        <span>{b.title}</span>
                      </h3>
                      <div className="sf-meta">{metaOf(b)}</div>
                    </div>
                    <div className="sf-pg">
                      {b.state === 'ready' ? (
                        <div className="sf-pbar">
                          <i style={{ width: `${b.pct}%` }} />
                        </div>
                      ) : null}
                      {statusOf(b)}
                    </div>
                    <div className="sf-when">
                      {b.last_at ? (
                        <>
                          最近阅读<b>{lastReadLabel(b.last_at)}</b>
                        </>
                      ) : (
                        <>
                          购买于<b>{boughtLabel(b.bought_at)}</b>
                        </>
                      )}
                    </div>
                    {actionsOf(b)}
                  </article>
                ),
              )}
            </div>
          ) : (
            <div className="sf-empty">
              <div className="e-ico">
                <BookOpen width={24} height={24} strokeWidth={1.8} />
              </div>
              <p>{q ? `没有找到“${q}”相关的书籍` : books.length ? '这个分类下还没有书' : '这里还没有书，去商城挑一本吧'}</p>
              <Link to="/">去商城逛逛</Link>
            </div>
          )}

          <aside className="sf-note">
            <Info width={16} height={16} strokeWidth={1.8} />
            <div>
              <b>书架如何收录：</b>
              你购买过的文本商品（TXT / EPUB）与专属约稿，支付成功后自动上架。TXT / EPUB 可在线阅读，PDF
              等格式仅提供下载；约稿交稿后需付清尾款才开放阅读，创作中的约稿会先占位显示进度。
            </div>
          </aside>
        </div>
      </main>
      <div className={`sf-scrim ${menuId ? 'on' : ''}`} onClick={() => setMenuId(null)} />
      <footer className="border-t border-[var(--line)] py-[26px] pb-[30px]">
        <div className="wrap flex flex-wrap items-center justify-between gap-3 text-[0.8rem] text-ink-mute">
          <span className="inline-flex items-center gap-2 font-semibold text-ink-soft">
            <span className="brand-mark !h-5 !w-5 !rounded-md" aria-hidden />© 2026 {brand} Lingxia
          </span>
          <span className="font-[family-name:var(--font-mono)] text-[0.72rem]">{publicSettings?.domain}</span>
        </div>
      </footer>
    </>
  )
}
