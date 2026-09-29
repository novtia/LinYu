import { useCallback, useEffect, useMemo, useRef, useState, type TouchEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowUpRight, MessageSquareDashed, PanelLeft, PenLine, ReceiptText } from 'lucide-react'
import { ApiError, api } from '../lib/api'
import { eventThread, upsertThread } from '../lib/chatSocket'
import { formatWords, isCommissionProduct } from '../lib/commission'
import { orderCompactLabel, orderDotTone } from '../lib/orderStatus'
import { useAuth } from '../context/AuthContext'
import { useChatSocket } from '../context/ChatSocketContext'
import { useToast } from '../context/ToastContext'
import { CommissionChat } from '../components/CommissionChat'
import type { CommissionThread, CommissionThreadList, Product } from '../types'

function pad(n: number) {
  return String(n).padStart(2, '0')
}

function fmtThreadTime(iso?: string | null) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const now = new Date()
  if (d.toDateString() === now.toDateString()) return `${pad(d.getHours())}:${pad(d.getMinutes())}`
  if (d.getFullYear() === now.getFullYear()) return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}`
  return `${String(d.getFullYear()).slice(2)}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`
}

function statusMeta(t: CommissionThread): { label: string; tone: 'teal' | 'warn' | 'mute' } {
  if (!t.order_status) return { label: '沟通中', tone: 'mute' }
  const label = orderCompactLabel(t.order_status)
  const dot = orderDotTone(t.order_status)
  if (dot === 'teal') return { label, tone: 'teal' }
  if (dot === 'warn') return { label, tone: 'warn' }
  return { label, tone: 'mute' }
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
      {threads.map((t) => {
        const st = statusMeta(t)
        return (
          <button
            key={t.id}
            type="button"
            className={`cm-th ${t.id === activeId ? 'on' : ''}`}
            onClick={() => onSelect(t)}
          >
            <div className="cm-th-top">
              <b>{t.product_name}</b>
              <time>{fmtThreadTime(t.last_at)}</time>
            </div>
            <span className="cm-th-order">
              {t.order_id
                ? `${t.order_id}${t.word_count ? ` · ${formatWords(t.word_count)}` : ''}`
                : '未下单 · 商品页对话'}
            </span>
            <div className="cm-th-bottom">
              <span className="pv">{t.last_preview || '还没有消息'}</span>
              {t.unread_user > 0 ? (
                <span className="cm-unread">{t.unread_user}</span>
              ) : (
                <span className={`cm-st ${st.tone}`}>
                  <i />
                  {st.label}
                </span>
              )}
            </div>
          </button>
        )
      })}
    </div>
  )
}

export function MyCommissionsPage() {
  const { user, loading: authLoading, publicSettings, openAuth } = useAuth()
  const { connected, subscribe } = useChatSocket()
  const { showToast } = useToast()
  const [searchParams, setSearchParams] = useSearchParams()
  const [threads, setThreads] = useState<CommissionThread[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [busy, setBusy] = useState(true)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [visible, setVisible] = useState(typeof document === 'undefined' ? true : document.visibilityState === 'visible')
  const [commissionHref, setCommissionHref] = useState('/#commission')
  const payHinted = useRef(false)
  const swipeStart = useRef<{ x: number; open: boolean } | null>(null)
  const brand = publicSettings?.name || '领匣'

  const orderParam = searchParams.get('order') || ''
  const threadParam = searchParams.get('thread') || ''
  const fromPay = searchParams.get('pay') === '1'

  useEffect(() => {
    document.body.setAttribute('data-nav', 'commissions')
    return () => document.body.removeAttribute('data-nav')
  }, [])

  useEffect(() => {
    const onVis = () => setVisible(document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  useEffect(() => {
    api
      .get<Product[]>('/api/products')
      .then((list) => {
        const hit = list.find(isCommissionProduct)
        if (hit) setCommissionHref(`/product/${hit.id}`)
      })
      .catch(() => {})
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
        if (threadParam) {
          const hit = items.find((t) => t.id === threadParam)
          if (hit) {
            setActiveId(hit.id)
            return
          }
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
  }, [user, orderParam, threadParam, loadList, showToast])

  useEffect(() => {
    if (!user) return
    return subscribe((event) => {
      const thread = eventThread(event)
      if (!thread || thread.user_id !== user.id) return
      setThreads((prev) => upsertThread(prev, thread))
    })
  }, [user, subscribe])

  useEffect(() => {
    if (!visible || !user || connected) return
    const timer = window.setInterval(() => {
      loadList().catch(() => {})
    }, 15000)
    return () => window.clearInterval(timer)
  }, [visible, user, connected, loadList])

  const active = useMemo(() => threads.find((t) => t.id === activeId) || null, [threads, activeId])
  const counts = useMemo(
    () => ({
      all: threads.length,
      doing: threads.filter((t) => t.order_status === 'deposit_paid').length,
      balance: threads.filter((t) => t.order_status === 'awaiting_balance').length,
    }),
    [threads],
  )
  const activeStatus = active ? statusMeta(active) : null

  function selectThread(t: CommissionThread) {
    setActiveId(t.id)
    setDrawerOpen(false)
    setThreads((prev) => prev.map((x) => (x.id === t.id ? { ...x, unread_user: 0 } : x)))
    if (t.order_id) setSearchParams({ order: t.order_id }, { replace: true })
    else setSearchParams({ thread: t.id }, { replace: true })
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

  if (authLoading || (user && busy && !threads.length && (orderParam || threadParam))) {
    return <div className="wrap py-20 text-center text-ink-mute">加载中…</div>
  }

  if (!user) {
    return (
      <main className="pb-20 pt-8 md:pt-10">
        <div className="wrap">
          <div className="cm-empty">
            <div className="e-ico">
              <MessageSquareDashed className="h-6 w-6" strokeWidth={1.8} />
            </div>
            <h2>登录后查看约稿对话</h2>
            <p>
              下单约稿后，与作者的对话会出现在这里。
              <br />
              尾款支付与文件下载仍在「我的订单」。
            </p>
            <button
              type="button"
              className="inline-flex h-11 items-center justify-center gap-1.5 rounded-xl bg-teal px-[22px] text-[0.9rem] font-bold text-white hover:bg-teal-deep"
              onClick={() => openAuth('login')}
            >
              登录
            </button>
          </div>
        </div>
      </main>
    )
  }

  return (
    <>
      <main className="pb-10 pt-8 md:pt-10">
        <div className="wrap">
          <header className="mb-6 flex flex-wrap items-end justify-between gap-5">
            <div>
              <h1 className="mb-2 font-[family-name:var(--font-display)] text-[clamp(2rem,4vw,2.6rem)] font-extrabold leading-[1.05] tracking-[-0.045em]">
                我的约稿
              </h1>
              {threads.length ? (
                <p className="m-0 text-[0.88rem] text-ink-mute">
                  共 <b className="font-bold text-teal">{counts.all}</b> 条对话
                  {counts.doing ? (
                    <>
                      {' '}
                      · <b className="font-bold text-teal">{counts.doing}</b> 笔进行中
                    </>
                  ) : null}
                  {counts.balance ? (
                    <>
                      {' '}
                      · <b className="font-bold text-teal">{counts.balance}</b> 笔待付尾款
                    </>
                  ) : null}
                </p>
              ) : (
                <p className="m-0 text-[0.88rem] text-ink-mute">一单一会话。尾款与下载仍在订单详情。</p>
              )}
            </div>
            <Link to="/orders" className="cm-ghost">
              <ReceiptText className="h-[15px] w-[15px]" strokeWidth={1.8} />
              我的订单
            </Link>
          </header>

          {busy && !threads.length ? (
            <div className="py-16 text-center text-ink-mute">加载中…</div>
          ) : threads.length === 0 ? (
            <section className="cm-empty">
              <div className="e-ico">
                <MessageSquareDashed className="h-6 w-6" strokeWidth={1.8} />
              </div>
              <h2>还没有约稿对话</h2>
              <p>
                下单约稿后，与作者的对话会出现在这里。
                <br />
                尾款支付与文件下载仍在「我的订单」。
              </p>
              <Link
                to={commissionHref}
                className="inline-flex h-11 items-center justify-center gap-1.5 rounded-xl bg-teal px-[22px] text-[0.9rem] font-bold text-white hover:bg-teal-deep"
              >
                <PenLine className="h-[15px] w-[15px]" strokeWidth={1.8} />
                去看看定制约稿
              </Link>
            </section>
          ) : (
            <section className="cm-inbox" onTouchStart={onSwipeStart} onTouchEnd={onSwipeEnd}>
              {drawerOpen ? (
                <button
                  type="button"
                  aria-label="关闭约稿订单"
                  className="fixed inset-0 z-[45] hidden bg-[rgba(20,32,28,.35)] max-[860px]:block"
                  onClick={() => setDrawerOpen(false)}
                />
              ) : null}

              <aside className="cm-threads">
                <div className="cm-threads-head">
                  <h2>约稿订单</h2>
                  <span>{threads.length} 条对话</span>
                </div>
                <ThreadList threads={threads} activeId={activeId} onSelect={selectThread} />
              </aside>

              <aside
                className={`fixed inset-y-0 left-0 z-50 hidden w-[min(320px,86vw)] flex-col bg-white shadow-[8px_0_28px_-20px_rgba(20,32,28,.45)] transition-transform duration-200 ease-out max-[860px]:flex ${
                  drawerOpen ? 'translate-x-0' : '-translate-x-full'
                }`}
              >
                <div className="cm-threads-head">
                  <h2>约稿订单</h2>
                  <button type="button" className="text-[0.8rem] font-semibold text-ink-mute hover:text-ink" onClick={() => setDrawerOpen(false)}>
                    关闭
                  </button>
                </div>
                <ThreadList threads={threads} activeId={activeId} onSelect={selectThread} />
              </aside>

              <section className="flex min-h-0 min-w-0 flex-1 flex-col">
                {active && activeStatus ? (
                  <CommissionChat
                    threadId={active.id}
                    viewer="user"
                    active={visible && !drawerOpen}
                    mineAvatar={user.username.slice(0, 1)}
                    peerAvatar="匣"
                    placeholder="写人设、尺度、禁触，或补充修改意见…"
                    orderId={active.order_id}
                    orderStatus={active.order_status}
                    balanceAmount={active.balance_amount}
                    deliveryLabel={active.product_name}
                    onUnread={applyUnread}
                    onOrderChange={(status) => {
                      setThreads((prev) => prev.map((t) => (t.id === active.id ? { ...t, order_status: status } : t)))
                    }}
                    className="h-full min-h-0"
                    header={
                      <div className="cm-chat-head">
                        <button type="button" className="cm-drawer-btn" onClick={() => setDrawerOpen(true)}>
                          <PanelLeft className="h-3.5 w-3.5" strokeWidth={1.8} />
                          约稿订单
                        </button>
                        <div className="c-av">匣</div>
                        <div className="c-meta">
                          <b>{active.product_name}</b>
                          <small>
                            {active.order_id
                              ? `${active.order_id}${active.word_count ? ` · ${formatWords(active.word_count)}` : ''}`
                              : '商品页对话 · 未生成订单'}
                          </small>
                        </div>
                        <div className="c-right">
                          <span className={`cm-st-pill ${activeStatus.tone}`}>
                            <i />
                            {activeStatus.label}
                          </span>
                          {active.order_id ? (
                            <Link to={`/orders/${active.order_id}`} className="cm-order-link">
                              订单详情
                              <ArrowUpRight className="h-3 w-3" strokeWidth={2} />
                            </Link>
                          ) : null}
                        </div>
                      </div>
                    }
                  />
                ) : (
                  <div className="grid min-h-full place-items-center px-6 text-center text-ink-mute">
                    <div>
                      <p className="mb-3">选择约稿订单查看对话</p>
                      <button type="button" className="font-semibold text-teal hover:underline max-[860px]:inline hidden" onClick={() => setDrawerOpen(true)}>
                        打开约稿订单
                      </button>
                    </div>
                  </div>
                )}
              </section>
            </section>
          )}
        </div>
      </main>

      <footer className="border-t border-[var(--line)] py-[26px] pb-[30px]">
        <div className="wrap flex flex-wrap items-center justify-between gap-3 text-[0.8rem] text-ink-mute">
          <span className="inline-flex items-center gap-2 font-semibold text-ink-soft">
            <span className="brand-mark !h-5 !w-5 !rounded-md" aria-hidden />
            © 2026 {brand} Lingxia
          </span>
          <div className="flex gap-5">
            <Link to="/#shop" className="hover:text-teal">
              商品
            </Link>
            <Link to={commissionHref} className="hover:text-teal">
              约稿
            </Link>
            <Link to="/orders" className="hover:text-teal">
              我的订单
            </Link>
            <button type="button" className="hover:text-teal" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
              回到顶部
            </button>
          </div>
          <span className="font-[family-name:var(--font-mono)] text-[0.72rem]">{publicSettings?.domain}</span>
        </div>
      </footer>
    </>
  )
}
