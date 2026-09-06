import { useCallback, useEffect, useMemo, useRef, useState, type TouchEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ApiError, api } from '../lib/api'
import { formatWords } from '../lib/commission'
import { orderStatusLabel } from '../lib/orderStatus'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { CommissionChat } from '../components/CommissionChat'
import type { CommissionThread, CommissionThreadList } from '../types'

function fmtTime(iso?: string | null) {
  if (!iso) return ''
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function ThreadList({
  threads,
  activeId,
  onSelect,
}: {
  threads: CommissionThread[]
  activeId: string | null
  onSelect: (t: CommissionThread) => void
}) {
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      {threads.map((t) => (
        <button
          key={t.id}
          type="button"
          className={`grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2.5 px-[18px] py-3 text-left hover:bg-fog ${t.id === activeId ? 'bg-fog' : ''}`}
          onClick={() => onSelect(t)}
        >
          <div className="min-w-0">
            <b className="block truncate text-[0.88rem]">{t.product_name}</b>
            <div className="truncate font-[family-name:var(--font-mono)] text-[0.7rem] text-ink-mute">
              {t.order_id}
              {t.word_count ? ` · ${formatWords(t.word_count)}` : ''}
            </div>
            <div className="truncate text-[0.74rem] text-ink-mute">{t.last_preview || '还没有消息'}</div>
          </div>
          <div className="text-right">
            <div className="text-[0.7rem] text-ink-mute">{fmtTime(t.last_at)}</div>
            {t.unread_user > 0 ? (
              <span className="mt-1 inline-grid min-w-4 place-items-center rounded-full bg-danger px-1.5 text-[0.66rem] font-extrabold text-white">
                {t.unread_user}
              </span>
            ) : (
              <span className="text-[0.72rem] font-bold text-teal">
                {t.order_status ? orderStatusLabel(t.order_status) : '沟通中'}
              </span>
            )}
          </div>
        </button>
      ))}
    </div>
  )
}

export function MyCommissionsPage() {
  const { user, loading: authLoading, openAuth } = useAuth()
  const { showToast } = useToast()
  const [searchParams, setSearchParams] = useSearchParams()
  const [threads, setThreads] = useState<CommissionThread[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [busy, setBusy] = useState(true)
  const [drawerOpen, setDrawerOpen] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches,
  )
  const [visible, setVisible] = useState(typeof document === 'undefined' ? true : document.visibilityState === 'visible')
  const payHinted = useRef(false)
  const swipeStart = useRef<{ x: number; open: boolean } | null>(null)

  const orderParam = searchParams.get('order') || ''
  const fromPay = searchParams.get('pay') === '1'

  useEffect(() => {
    const onVis = () => setVisible(document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  useEffect(() => {
    if (authLoading) return
    if (!user) openAuth('login')
  }, [authLoading, user, openAuth])

  useEffect(() => {
    if (!fromPay || payHinted.current || busy) return
    const hit = threads.find((t) => t.order_id === orderParam) || threads.find((t) => t.id === activeId)
    if (!hit && threads.length === 0) return
    payHinted.current = true
    showToast(hit?.order_status === 'completed' ? '尾款已支付，稿件已解锁' : '定金已支付')
    const next = new URLSearchParams(searchParams)
    next.delete('pay')
    setSearchParams(next, { replace: true })
  }, [fromPay, busy, threads, orderParam, activeId, searchParams, setSearchParams, showToast])

  const loadList = useCallback(async () => {
    const res = await api.get<CommissionThreadList>('/api/commission/threads/mine')
    setThreads(res.items)
    return res.items
  }, [])

  useEffect(() => {
    if (!user) {
      setThreads([])
      setActiveId(null)
      setBusy(false)
      return
    }
    let alive = true
    setBusy(true)
    loadList()
      .then(async (items) => {
        if (!alive) return
        if (orderParam) {
          const hit = items.find((t) => t.order_id === orderParam)
          if (hit) {
            setActiveId(hit.id)
            return
          }
          try {
            const thread = await api.get<CommissionThread>(`/api/commission/threads/mine/${encodeURIComponent(orderParam)}`)
            if (!alive) return
            setThreads((prev) => (prev.some((t) => t.id === thread.id) ? prev : [thread, ...prev]))
            setActiveId(thread.id)
          } catch (e) {
            if (alive) showToast(e instanceof ApiError ? e.message : '无法打开该约稿对话')
          }
          return
        }
        if (items[0]) setActiveId((cur) => cur || items[0].id)
      })
      .catch((e) => {
        if (alive) showToast(e instanceof ApiError ? e.message : '约稿列表加载失败')
      })
      .finally(() => {
        if (alive) setBusy(false)
      })
    return () => {
      alive = false
    }
  }, [user, orderParam, loadList, showToast])

  useEffect(() => {
    if (!visible || !user) return
    const timer = window.setInterval(() => {
      loadList().catch(() => {})
    }, 15000)
    return () => window.clearInterval(timer)
  }, [visible, user, loadList])

  const active = useMemo(() => threads.find((t) => t.id === activeId) || null, [threads, activeId])

  function selectThread(t: CommissionThread) {
    setActiveId(t.id)
    setDrawerOpen(false)
    setThreads((prev) => prev.map((x) => (x.id === t.id ? { ...x, unread_user: 0 } : x)))
    if (t.order_id) {
      setSearchParams({ order: t.order_id }, { replace: true })
    }
  }

  function onSwipeStart(e: TouchEvent) {
    const x = e.touches[0]?.clientX ?? 0
    if (!drawerOpen && x > 48) return
    swipeStart.current = { x, open: drawerOpen }
  }

  function onSwipeEnd(e: TouchEvent) {
    const start = swipeStart.current
    swipeStart.current = null
    if (!start) return
    const dx = (e.changedTouches[0]?.clientX ?? start.x) - start.x
    if (!start.open && dx > 48) setDrawerOpen(true)
    if (start.open && dx < -48) setDrawerOpen(false)
  }

  useEffect(() => {
    if (!drawerOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [drawerOpen])

  function applyUnread(unread: number, threadId: string) {
    setThreads((prev) => prev.map((t) => (t.id === threadId ? { ...t, unread_user: unread } : t)))
  }

  if (authLoading || (user && busy && !threads.length)) {
    return <div className="wrap py-20 text-center text-ink-mute">加载中…</div>
  }

  if (!user) {
    return (
      <main className="pb-20 pt-8">
        <div className="wrap py-16 text-center">
          <h1 className="mb-3 font-[family-name:var(--font-display)] text-2xl font-extrabold tracking-tight">我的约稿</h1>
          <p className="mb-6 text-ink-mute">登录后查看约稿对话与订单进度。</p>
          <button
            type="button"
            className="inline-flex h-11 items-center bg-teal px-5 font-bold text-white hover:bg-teal-deep"
            onClick={() => openAuth('login')}
          >
            登录
          </button>
        </div>
      </main>
    )
  }

  return (
    <main className="pb-10 pt-6 md:pt-8">
      <div className="wrap">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-[family-name:var(--font-display)] text-2xl font-extrabold tracking-tight">我的约稿</h1>
            <p className="mt-1 text-[0.9rem] text-ink-mute">一笔订单一条对话。尾款与下载仍在订单详情。</p>
          </div>
          <div className="flex items-center gap-4">
            {threads.length > 0 ? (
              <button
                type="button"
                className="text-[0.9rem] font-semibold text-teal hover:underline md:hidden"
                onClick={() => setDrawerOpen(true)}
              >
                约稿订单
              </button>
            ) : null}
            <Link to="/orders" className="text-[0.9rem] font-semibold text-teal hover:underline">
              我的订单
            </Link>
          </div>
        </div>

        {threads.length === 0 ? (
          <div className="rounded-[22px] border border-[var(--line)] bg-white px-6 py-16 text-center">
            <p className="mb-2 text-[1.05rem] font-bold text-ink">还没有约稿订单</p>
            <p className="mb-6 text-[0.9rem] leading-relaxed text-ink-mute">下单约稿后，对话会出现在这里。尾款和下载仍在订单详情。</p>
            <Link
              to="/#shop"
              className="inline-flex h-11 items-center bg-teal px-5 font-bold text-white hover:bg-teal-deep"
            >
              去看看约稿商品
            </Link>
          </div>
        ) : (
        <div
          className="relative flex min-h-[calc(100dvh-11rem)] overflow-hidden border border-[var(--line)] bg-white"
          onTouchStart={onSwipeStart}
          onTouchEnd={onSwipeEnd}
        >
          {drawerOpen ? (
            <button
              type="button"
              aria-label="关闭约稿订单"
              className="fixed inset-0 z-40 bg-[rgba(20,32,28,.35)] md:hidden"
              onClick={() => setDrawerOpen(false)}
            />
          ) : null}

          <aside className="hidden w-[300px] shrink-0 flex-col border-r border-[var(--line)] md:flex">
            <div className="px-[18px] pt-[18px] pb-2">
              <h3 className="text-[0.95rem] font-bold">约稿订单</h3>
            </div>
            <ThreadList threads={threads} activeId={activeId} onSelect={selectThread} />
          </aside>

          <aside
            className={`fixed inset-y-0 left-0 z-50 flex w-[min(300px,86vw)] flex-col border-r border-[var(--line)] bg-white shadow-[8px_0_28px_-20px_rgba(20,32,28,.45)] transition-transform duration-200 ease-out md:hidden ${
              drawerOpen ? 'translate-x-0' : '-translate-x-full'
            }`}
          >
            <div className="flex items-center justify-between px-[18px] pt-[18px] pb-2">
              <h3 className="text-[0.95rem] font-bold">约稿订单</h3>
              <button
                type="button"
                className="text-[0.82rem] font-semibold text-ink-mute hover:text-ink"
                onClick={() => setDrawerOpen(false)}
              >
                关闭
              </button>
            </div>
            <ThreadList threads={threads} activeId={activeId} onSelect={selectThread} />
          </aside>

          <section className="flex min-h-0 min-w-0 flex-1 flex-col">
            {active ? (
              <CommissionChat
                threadId={active.id}
                viewer="user"
                active={visible && !drawerOpen}
                mineAvatar={user.username.slice(0, 1)}
                peerAvatar="匣"
                orderId={active.order_id}
                orderStatus={active.order_status}
                balanceAmount={active.balance_amount}
                onUnread={applyUnread}
                onOrderChange={(status) => {
                  setThreads((prev) => prev.map((t) => (t.id === active.id ? { ...t, order_status: status } : t)))
                }}
                className="h-full min-h-0 min-w-0 border-0 px-3 pb-4 md:px-6 md:pb-5"
                header={
                  <div className="mb-2 border-b border-[var(--line)] py-[18px]">
                    <button
                      type="button"
                      className="mb-3 text-[0.82rem] font-semibold text-ink-soft hover:text-teal md:hidden"
                      onClick={() => setDrawerOpen(true)}
                    >
                      约稿订单
                    </button>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5">
                        <div className="grid h-9 w-9 place-items-center rounded-full bg-teal text-[0.78rem] font-bold text-white">匣</div>
                        <div>
                          <strong className="block text-[0.95rem]">{active.product_name}</strong>
                          <span className="text-[0.75rem] text-ink-mute">
                            {active.order_id}
                            {active.word_count ? ` · ${formatWords(active.word_count)}` : ''}
                          </span>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-3">
                        <span className="text-[0.78rem] font-bold text-teal">
                          {active.order_status ? orderStatusLabel(active.order_status) : '沟通中'}
                        </span>
                        {active.order_id ? (
                          <Link to={`/orders/${active.order_id}`} className="text-[0.78rem] font-semibold text-teal hover:underline">
                            订单详情
                          </Link>
                        ) : null}
                      </div>
                    </div>
                  </div>
                }
              />
            ) : (
              <div className="grid min-h-full place-items-center px-6 text-center text-ink-mute">
                <div>
                  <p className="mb-3">选择约稿订单查看对话</p>
                  <button
                    type="button"
                    className="font-semibold text-teal hover:underline md:hidden"
                    onClick={() => setDrawerOpen(true)}
                  >
                    打开约稿订单
                  </button>
                </div>
              </div>
            )}
          </section>
        </div>
        )}
      </div>
    </main>
  )
}
