import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { PanelRightClose, PanelRightOpen, X } from 'lucide-react'
import { ApiError, api } from '../../lib/api'
import { eventThread, upsertThread } from '../../lib/chatSocket'
import { formatWords } from '../../lib/commission'
import { allOrderFiles, AdminOrderDetail } from '../../components/AdminOrderDetail'
import { orderStatusLabel } from '../../lib/orderStatus'
import { useChatSocket } from '../../context/ChatSocketContext'
import { useToast } from '../../context/ToastContext'
import { CommissionChat } from '../../components/CommissionChat'
import type { CommissionThread, CommissionThreadList, Order } from '../../types'

type Filter = 'all' | 'unread' | 'deposit'

function fmtTime(iso?: string | null) {
  if (!iso) return ''
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function shouldOpenDetail(order: Order) {
  return order.status === 'awaiting_balance' || order.status === 'completed' || allOrderFiles(order).length > 0
}

function threadMatchesQuery(t: CommissionThread, q: string) {
  const s = q.trim().toLowerCase()
  if (!s) return true
  return [t.username, t.product_name, t.order_id, t.last_preview].some((x) => (x || '').toLowerCase().includes(s))
}

function threadMatchesFilter(t: CommissionThread, filter: Filter) {
  if (filter === 'unread') return t.unread_admin > 0
  if (filter === 'deposit') return t.has_deposit
  return true
}

export function ConversationsPage() {
  const { showToast } = useToast()
  const { connected, subscribe } = useChatSocket()
  const [searchParams, setSearchParams] = useSearchParams()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [threads, setThreads] = useState<CommissionThread[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [order, setOrder] = useState<Order | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [recalling, setRecalling] = useState(false)
  const [visible, setVisible] = useState(typeof document === 'undefined' ? true : document.visibilityState === 'visible')
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onVis = () => setVisible(document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  const loadList = useCallback(async () => {
    const params = new URLSearchParams()
    if (query.trim()) params.set('q', query.trim())
    if (filter !== 'all') params.set('filter', filter)
    params.set('limit', '50')
    const res = await api.get<CommissionThreadList>(`/api/commission/threads?${params}`)
    setThreads(res.items)
    return res.items
  }, [query, filter])

  useEffect(() => {
    let alive = true
    loadList()
      .then((items) => {
        if (!alive) return
        const orderId = searchParams.get('order')
        const user = searchParams.get('user')
        const product = searchParams.get('product')
        if (orderId) {
          const hit = items.find((t) => t.order_id === orderId)
          if (hit) setActiveId(hit.id)
        } else if (user && product) {
          const hit = items.find((t) => t.user_id === user && String(t.product_id) === product)
          if (hit) setActiveId(hit.id)
        }
      })
      .catch((e) => {
        if (alive) showToast(e instanceof ApiError ? e.message : '对话列表加载失败')
      })
    return () => {
      alive = false
    }
  }, [loadList, searchParams, showToast])

  useEffect(() => {
    return subscribe((event) => {
      const thread = eventThread(event)
      if (!thread) return
      setThreads((prev) => {
        const keepActive = thread.id === activeId
        if (!threadMatchesQuery(thread, query) && !keepActive) {
          return prev.filter((t) => t.id !== thread.id)
        }
        if (!threadMatchesFilter(thread, filter) && !keepActive) {
          return prev.filter((t) => t.id !== thread.id)
        }
        return upsertThread(prev, thread)
      })
    })
  }, [subscribe, query, filter, activeId])

  useEffect(() => {
    if (!visible || connected) return
    const timer = window.setInterval(() => {
      loadList().catch(() => {})
    }, 15000)
    return () => window.clearInterval(timer)
  }, [visible, connected, loadList])

  const active = useMemo(() => threads.find((t) => t.id === activeId) || null, [threads, activeId])

  const reloadOrder = useCallback(async (orderId?: string | null) => {
    const id = orderId || active?.order_id
    if (!id) {
      setOrder(null)
      return null
    }
    const o = await api.get<Order>(`/api/orders/${encodeURIComponent(id)}`)
    setOrder(o)
    return o
  }, [active?.order_id])

  useEffect(() => {
    if (!active?.order_id) {
      setOrder(null)
      setDetailOpen(false)
      return
    }
    let alive = true
    api
      .get<Order>(`/api/orders/${encodeURIComponent(active.order_id)}`)
      .then((o) => {
        if (!alive) return
        setOrder(o)
        setDetailOpen(shouldOpenDetail(o))
      })
      .catch(() => {
        if (alive) setOrder(null)
      })
    return () => {
      alive = false
    }
  }, [active?.id, active?.order_id])

  async function copyText(text: string, ok = '已复制') {
    try {
      await navigator.clipboard.writeText(text)
      showToast(ok)
    } catch {
      showToast('复制失败')
    }
  }

  async function handleUpload(file: File) {
    if (!order) return
    setUploading(true)
    try {
      await api.upload(`/api/orders/${order.id}/files`, file)
      await reloadOrder(order.id)
      showToast('稿件已上传')
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : '上传失败')
    } finally {
      setUploading(false)
    }
  }

  async function handleDelete(fileId: string) {
    if (!order) return
    try {
      await api.delete(`/api/orders/${order.id}/files/${fileId}`)
      const next = await reloadOrder(order.id)
      showToast('已删除稿件')
      if (next) setThreads((prev) => prev.map((t) => (t.order_id === next.id ? { ...t, order_status: next.status } : t)))
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : '删除失败')
    }
  }

  async function handleRecallDelivery() {
    if (!order) return
    if (!window.confirm('撤回发货后，对话里的发货通知会一并撤回，订单回到待交稿。确定撤回？')) return
    setRecalling(true)
    try {
      const o = await api.post<Order>(`/api/orders/${encodeURIComponent(order.id)}/recall-delivery`)
      setOrder(o)
      setThreads((prev) =>
        prev.map((t) =>
          t.order_id === o.id ? { ...t, order_status: o.status, last_preview: t.last_kind === 'delivery' ? '已撤回发货' : t.last_preview } : t,
        ),
      )
      showToast('已撤回发货')
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : '撤回失败')
    } finally {
      setRecalling(false)
    }
  }

  const canToggleDetail = Boolean(active?.order_id)
  const paneOpen = Boolean(detailOpen && order && active?.order_id === order.id)

  function toggleDetail() {
    if (!active?.order_id) return
    if (paneOpen) {
      setDetailOpen(false)
      return
    }
    if (order && order.id === active.order_id) {
      setDetailOpen(true)
      return
    }
    void reloadOrder(active.order_id)
      .then((o) => {
        if (o) setDetailOpen(true)
        else showToast('订单详情加载失败')
      })
      .catch((e) => showToast(e instanceof ApiError ? e.message : '订单详情加载失败'))
  }

  return (
    <div className="relative flex h-full min-h-0 min-w-0 flex-1 overflow-hidden bg-white">
      <section className="flex w-[300px] shrink-0 flex-col border-r border-[var(--line)]">
        <div className="px-[18px] pt-[18px] pb-2">
          <h3 className="mb-3 text-[0.95rem] font-bold">用户</h3>
          <input
            className="h-9 w-full border-0 border-b border-[var(--line)] bg-transparent outline-none"
            placeholder="搜索用户、篇名或订单码"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="flex gap-3 px-[18px] py-3">
          {(
            [
              ['all', '全部'],
              ['unread', '未读'],
              ['deposit', '已付定金'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`bg-transparent text-[0.78rem] font-semibold ${filter === id ? 'text-ink' : 'text-ink-mute'}`}
              onClick={() => setFilter(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {threads.length === 0 ? (
            <p className="px-6 py-6 text-[0.86rem] text-ink-mute">没有匹配的对话</p>
          ) : (
            threads.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`grid w-full grid-cols-[36px_minmax(0,1fr)_auto] items-center gap-2.5 px-[18px] py-3 text-left hover:bg-fog ${t.id === activeId ? 'bg-fog' : ''}`}
                onClick={() => {
                  setActiveId(t.id)
                  setThreads((prev) => prev.map((x) => (x.id === t.id ? { ...x, unread_admin: 0 } : x)))
                  setSearchParams(t.order_id ? { order: t.order_id } : { user: t.user_id, product: String(t.product_id) }, { replace: true })
                }}
              >
                <div className="grid h-9 w-9 place-items-center rounded-full bg-ink text-[0.78rem] font-bold text-white">
                  {t.username.slice(0, 1)}
                </div>
                <div className="min-w-0">
                  <b className="block text-[0.88rem]">{t.username}</b>
                  <div className="truncate font-[family-name:var(--font-mono)] text-[0.7rem] text-ink-mute">
                    {t.order_id || `${t.product_name} · 商品沟通`}
                  </div>
                  <div className="truncate text-[0.74rem] text-ink-mute">{t.last_preview || t.product_name}</div>
                </div>
                <div className="text-right">
                  <div className="text-[0.7rem] text-ink-mute">{fmtTime(t.last_at)}</div>
                  {t.unread_admin > 0 ? (
                    <span className="mt-1 inline-grid min-w-4 place-items-center rounded-full bg-danger px-1.5 text-[0.66rem] font-extrabold text-white">
                      {t.unread_admin}
                    </span>
                  ) : (
                    <span className="text-[0.72rem] font-bold text-teal">{t.has_deposit ? '已付定金' : '沟通中'}</span>
                  )}
                </div>
              </button>
            ))
          )}
        </div>
      </section>

      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        {active ? (
          <CommissionChat
            threadId={active.id}
            viewer="admin"
            active={visible}
            mineAvatar="匣"
            peerAvatar={active.username.slice(0, 1)}
            orderId={active.order_id}
            orderStatus={active.order_status}
            balanceAmount={active.balance_amount}
            deliveryLabel={active.product_name}
            onUnread={(unread, threadId) => {
              setThreads((prev) => prev.map((t) => (t.id === threadId ? { ...t, unread_admin: unread } : t)))
            }}
            onOrderChange={(status, meta) => {
              setThreads((prev) =>
                prev.map((t) =>
                  t.id === active.id
                    ? {
                        ...t,
                        order_status: status,
                        last_preview:
                          status === 'awaiting_balance'
                            ? '[稿件已发货]'
                            : meta?.recalled
                              ? t.last_preview
                              : t.last_preview,
                      }
                    : t,
                ),
              )
              void reloadOrder(active.order_id).catch(() => {})
              if (meta?.shipped || status === 'awaiting_balance' || status === 'completed') setDetailOpen(true)
            }}
            className="h-full min-h-0"
            header={
              <div className="cm-chat-head">
                <div className="c-av mine">{active.username.slice(0, 1)}</div>
                <div className="c-meta">
                  <b>{active.username}</b>
                  <small>
                    {active.order_id ? `${active.order_id} · ` : '商品沟通 · '}
                    {active.product_name}
                    {active.word_count ? ` · ${formatWords(active.word_count)}` : ''}
                  </small>
                </div>
                <div className="c-right">
                  {canToggleDetail ? (
                    <button type="button" className="cm-order-toggle" onClick={toggleDetail}>
                      {paneOpen ? <PanelRightClose className="h-3.5 w-3.5" strokeWidth={1.9} /> : <PanelRightOpen className="h-3.5 w-3.5" strokeWidth={1.9} />}
                      {paneOpen ? '收起详情' : '订单详情'}
                    </button>
                  ) : null}
                  <span className="cm-st-pill teal">
                    <i />
                    {active.order_status ? orderStatusLabel(active.order_status) : active.order_id ? '沟通中' : '商品沟通'}
                  </span>
                </div>
              </div>
            }
          />
        ) : (
          <div className="grid min-h-full place-items-center text-ink-mute">选择左侧用户</div>
        )}
      </section>

      {canToggleDetail && !paneOpen ? (
        <button type="button" className="cm-order-rail flex" onClick={toggleDetail} title="打开订单详情">
          <PanelRightOpen className="h-4 w-4" strokeWidth={1.8} />
          <span>订单详情</span>
        </button>
      ) : null}

      {paneOpen && order ? (
        <>
          <button
            type="button"
            className="absolute inset-0 z-20 bg-[rgba(20,32,28,.28)] xl:hidden"
            aria-label="关闭订单详情"
            onClick={toggleDetail}
          />
          <button type="button" className="cm-order-rail cm-order-rail-on hidden xl:flex" onClick={toggleDetail} title="收起订单详情">
            <PanelRightClose className="h-4 w-4" strokeWidth={1.8} />
            <span>收起</span>
          </button>
          <aside className="absolute inset-y-0 right-0 z-30 flex w-[min(100%,400px)] flex-col border-l border-[var(--line)] bg-white xl:relative xl:z-0 xl:w-[400px] xl:shrink-0">
            <div className="flex h-12 shrink-0 items-center justify-between border-b border-[var(--line)] px-5">
              <b className="text-[0.86rem]">订单详情</b>
              <button
                type="button"
                className="grid h-8 w-8 place-items-center rounded-lg text-ink-mute hover:bg-paper hover:text-ink"
                onClick={toggleDetail}
                aria-label="收起订单"
              >
                <X className="h-4 w-4" strokeWidth={1.8} />
              </button>
            </div>
            <div className="hover-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5 md:px-7">
              <AdminOrderDetail
                order={order}
                uploading={uploading}
                recalling={recalling}
                hideChatLink
                onCopy={copyText}
                onUploadClick={() => fileRef.current?.click()}
                onDownload={async (url, name) => {
                  try {
                    await api.download(url, name)
                  } catch (e) {
                    showToast(e instanceof ApiError ? e.message : '下载失败')
                  }
                }}
                onDelete={handleDelete}
                onRecallDelivery={handleRecallDelivery}
              />
            </div>
          </aside>
        </>
      ) : null}

      <input
        ref={fileRef}
        type="file"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) handleUpload(file)
        }}
      />
    </div>
  )
}
