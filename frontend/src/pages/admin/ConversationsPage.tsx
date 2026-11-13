import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Search, Upload } from 'lucide-react'
import { ApiError, api } from '../../lib/api'
import { eventThread, upsertThread } from '../../lib/chatSocket'
import { formatWords } from '../../lib/commission'
import { AdminOrderDetail } from '../../components/AdminOrderDetail'
import { orderStatusLabel } from '../../lib/orderStatus'
import { fmtBeijingClock } from '../../lib/time'
import { useChatSocket } from '../../context/ChatSocketContext'
import { useToast } from '../../context/ToastContext'
import { CommissionChat } from '../../components/CommissionChat'
import { yuanText } from '../../lib/ledger'
import type { Analytics, AnalyticsStock, CommissionThread, CommissionThreadList, Order } from '../../types'

type Filter = 'all' | 'unread' | 'deposit' | 'late'

function fmtTime(iso?: string | null) {
  return fmtBeijingClock(iso)
}

function threadMatchesQuery(t: CommissionThread, q: string) {
  const s = q.trim().toLowerCase()
  if (!s) return true
  return [t.username, t.product_name, t.order_id, t.last_preview].some((x) => (x || '').toLowerCase().includes(s))
}

function isLate(t: CommissionThread) {
  if (t.unread_admin <= 0 || !t.last_at) return false
  return Date.now() - new Date(t.last_at).getTime() > 4 * 3600 * 1000
}

function threadMatchesFilter(t: CommissionThread, filter: Filter) {
  if (filter === 'unread') return t.unread_admin > 0
  if (filter === 'deposit') return t.has_deposit
  if (filter === 'late') return isLate(t)
  return true
}

function stepOf(t: CommissionThread, o: Order | null) {
  const status = o?.status || t.order_status || ''
  if (status === 'completed') return 3
  if (status === 'awaiting_balance') return 2
  if (status === 'deposit_paid') return 1
  return 0
}

export function ConversationsPage() {
  const { showToast } = useToast()
  const { connected, subscribe } = useChatSocket()
  const [searchParams, setSearchParams] = useSearchParams()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [threads, setThreads] = useState<CommissionThread[]>([])
  const [stock, setStock] = useState<AnalyticsStock | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [order, setOrder] = useState<Order | null>(null)
  const [uploading, setUploading] = useState(false)
  const [recalling, setRecalling] = useState(false)
  const [deletingOrder, setDeletingOrder] = useState(false)
  const [visible, setVisible] = useState(typeof document === 'undefined' ? true : document.visibilityState === 'visible')
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    api.get<Analytics>('/api/analytics').then((a) => setStock(a.stock)).catch(() => setStock(null))
  }, [])

  useEffect(() => {
    const onVis = () => setVisible(document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  const loadList = useCallback(async () => {
    const params = new URLSearchParams()
    if (query.trim()) params.set('q', query.trim())
    if (filter === 'unread' || filter === 'deposit') params.set('filter', filter)
    params.set('limit', '80')
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

  const reloadOrder = useCallback(
    async (orderId?: string | null) => {
      const id = orderId || active?.order_id
      if (!id) {
        setOrder(null)
        return null
      }
      const o = await api.get<Order>(`/api/orders/${encodeURIComponent(id)}`)
      setOrder(o)
      return o
    },
    [active?.order_id],
  )

  useEffect(() => {
    if (!active?.order_id) {
      setOrder(null)
      return
    }
    let alive = true
    api
      .get<Order>(`/api/orders/${encodeURIComponent(active.order_id)}`)
      .then((o) => {
        if (alive) setOrder(o)
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

  async function handleDeleteOrder() {
    if (!order) return
    if (!window.confirm(`确定删除订单「${order.id}」？此操作会同步清理该笔约稿对话与交付记录，且不可恢复。`)) return
    setDeletingOrder(true)
    try {
      await api.delete(`/api/orders/${encodeURIComponent(order.id)}`)
      const deletedId = order.id
      setOrder(null)
      setThreads((prev) => prev.filter((t) => t.order_id !== deletedId))
      setActiveId(null)
      showToast('订单已删除')
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : '删除订单失败')
    } finally {
      setDeletingOrder(false)
    }
  }

  const shown = threads.filter((t) => threadMatchesFilter(t, filter))
  const unreadThreads = threads.filter((t) => t.unread_admin > 0)
  const lateThreads = threads.filter(isLate)
  const depositN = threads.filter((t) => t.has_deposit).length
  const curStep = active ? stepOf(active, order) : 0

  return (
    <div className="lx-desk absolute inset-0 flex flex-col overflow-hidden bg-fog">
      <div className="studio-top">
        <div className="studio-head">
          <div className="studio-title">
            <h1>约稿收件箱</h1>
            <p className="lead">先回已付定金且等待最久的单，再接新问价</p>
          </div>
          <div className="sla-strip">
            <span className={`sla-pill ${unreadThreads.length ? 'alert' : ''}`}>
              {unreadThreads.length ? <i className="pulse" /> : null}
              未读 <b>{unreadThreads.length}</b> 条
            </span>
            <span className={`sla-pill ${lateThreads.length ? 'alert' : ''}`}>
              超 4h 未回 <b>{lateThreads.length}</b>
            </span>
            <span className="sla-pill">
              已付定金在聊 <b>{depositN}</b>
              {stock ? ` · 在制 ${stock.writing}` : ''}
            </span>
          </div>
        </div>

        <div className="studio-filter">
          <div className="chips">
            {(
              [
                ['all', '全部会话'],
                ['unread', '未读消息'],
                ['deposit', '已付定金'],
                ['late', '超过 4 小时'],
              ] as const
            ).map(([id, label]) => (
              <button key={id} type="button" className={filter === id ? 'on' : ''} onClick={() => setFilter(id)}>
                {label}
              </button>
            ))}
          </div>
          <label className="search">
            <Search className="h-3.5 w-3.5 text-ink-mute" />
            <input value={query} placeholder="搜索买家、商品名或订单号…" onChange={(e) => setQuery(e.target.value)} />
          </label>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 xl:grid-cols-[312px_minmax(0,1fr)_308px]">
        <div className="flex min-h-0 flex-col gap-1.5 overflow-y-auto border-[var(--line-strong)] bg-white p-2.5 xl:border-r">
          {shown.length === 0 ? (
            <p className="empty">没有符合条件的对话</p>
          ) : (
            shown.map((t) => {
              const late = isLate(t)
              return (
                <button
                  key={t.id}
                  type="button"
                  className={`thread-card ${t.id === activeId ? 'on' : ''} ${late ? 'late' : ''}`}
                  onClick={() => {
                    setActiveId(t.id)
                    setThreads((prev) => prev.map((x) => (x.id === t.id ? { ...x, unread_admin: 0 } : x)))
                    setSearchParams(
                      t.order_id ? { order: t.order_id } : { user: t.user_id, product: String(t.product_id) },
                      { replace: true },
                    )
                  }}
                >
                  <div className="top">
                    <span className="who">
                      <span className="u-dot">{t.username.slice(0, 1).toUpperCase()}</span>
                      <b>{t.username}</b>
                    </span>
                    <time>{fmtTime(t.last_at)}</time>
                  </div>
                  <div className="prod-line">
                    {t.product_name}
                    {t.order_id ? ` · ${t.order_id}` : ''}
                  </div>
                  <p>{t.last_preview || t.product_name}</p>
                  <div className="meta">
                    <span className={`tag ${t.has_deposit ? 'gold' : 'mute'}`}>{t.has_deposit ? '已付定金' : '未付定金'}</span>
                    {late ? <span className="tag danger">超过 4h</span> : null}
                    {t.unread_admin > 0 ? <span className="badge" style={{ marginLeft: 'auto' }}>{t.unread_admin}</span> : null}
                  </div>
                </button>
              )
            })
          )}
        </div>

        <div className="admin-chat-pane flex min-h-0 flex-col overflow-hidden border-[var(--line-strong)] bg-[#f6f9f7] xl:border-r">
          {active ? (
            <>
              <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--line)] bg-white px-5 py-3">
                <div className="min-w-0">
                  <h3 className="m-0 truncate font-[family-name:var(--font-display)] text-[1rem] font-bold tracking-tight">
                    {active.username} · {active.product_name}
                  </h3>
                  <small className="mt-0.5 block font-[family-name:var(--font-mono)] text-[0.72rem] text-ink-mute">
                    {active.order_id || '问价沟通'}
                    {active.word_count ? ` · ${formatWords(active.word_count)}` : ''}
                  </small>
                </div>
                <span className={`tag ${active.has_deposit ? 'gold' : 'mute'}`}>
                  {active.order_status ? orderStatusLabel(active.order_status) : '问价中'}
                </span>
              </div>
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
                onOrderChange={(status) => {
                  setThreads((prev) =>
                    prev.map((t) =>
                      t.id === active.id
                        ? {
                            ...t,
                            order_status: status,
                            last_preview: status === 'awaiting_balance' ? '[稿件已发货]' : t.last_preview,
                          }
                        : t,
                    ),
                  )
                  void reloadOrder(active.order_id).catch(() => {})
                }}
                className="h-full min-h-0 flex-1"
              />
            </>
          ) : (
            <div className="grid h-full place-items-center text-[0.86rem] text-ink-mute">从左边选一条对话</div>
          )}
        </div>

        <aside className="hidden min-h-0 overflow-y-auto bg-white p-4 xl:block">
          {active ? (
            <>
              <div className="rounded-[10px] border border-[var(--line)] bg-fog p-3.5">
                <div className="text-[0.7rem] font-bold tracking-[0.06em] text-ink-mute">这笔约稿</div>
                <h2 className="mt-1.5 font-[family-name:var(--font-display)] text-[1.15rem] leading-snug font-bold tracking-tight">
                  {active.product_name}
                </h2>
                <div className="mt-1 text-[0.75rem] text-ink-mute">
                  {active.username}
                  {active.word_count ? ` · ${formatWords(active.word_count)}` : ''}
                  {active.last_at ? ` · ${fmtTime(active.last_at)}` : ''}
                </div>
                <ol className="mt-3 grid list-none grid-cols-4 gap-1.5 border-t border-dashed border-[var(--line-strong)] pt-2.5">
                  {(['付定金', '沟通设定', '按章交稿', '付尾款'] as const).map((lbl, idx) => {
                    const on = idx <= curStep
                    const now = idx === curStep
                    return (
                      <li key={lbl} className={`text-[0.68rem] ${on ? 'font-bold text-ink' : 'text-ink-mute'}`}>
                        <i
                          className={`mb-1 block h-1 rounded-full ${
                            now ? 'bg-gold' : on ? 'bg-teal' : 'bg-[var(--line-strong)]'
                          }`}
                        />
                        {lbl}
                      </li>
                    )
                  })}
                </ol>
              </div>

              <dl className="kv">
                <dt>订单</dt>
                <dd className="mono">
                  {active.order_id ? (
                    <Link to={`/admin/revenue/${encodeURIComponent(active.order_id)}`} style={{ color: 'var(--teal)' }}>
                      {active.order_id}
                    </Link>
                  ) : (
                    '还没有订单'
                  )}
                </dd>
                <dt>状态</dt>
                <dd>{active.order_status ? orderStatusLabel(active.order_status) : '商品沟通'}</dd>
                <dt>款项</dt>
                <dd>
                  {active.order_status === 'pending'
                    ? `定金 ${yuanText(active.deposit_amount || 0)} 还没付`
                    : active.has_deposit && active.order_status === 'deposit_paid'
                      ? `定金 ${yuanText(active.deposit_amount || 0)} 已收`
                      : active.order_status === 'awaiting_balance'
                        ? `尾款 ${yuanText(active.balance_amount || 0)} 未付`
                        : active.order_status === 'completed'
                          ? '已结清'
                          : '问价中'}
                </dd>
              </dl>

              {order ? (
                <button
                  type="button"
                  disabled={uploading}
                  onClick={() => fileRef.current?.click()}
                  className="mt-4 w-full rounded-[10px] border border-dashed border-[var(--line-strong)] px-3 py-3 text-center text-[0.78rem] text-ink-mute transition hover:border-teal hover:bg-[rgba(232,241,238,.35)] hover:text-teal"
                >
                  <Upload className="mr-1.5 inline h-3.5 w-3.5" />
                  {uploading ? '上传中…' : '上传交稿文件（DOCX / TXT / 图）'}
                </button>
              ) : null}

              {active.order_id ? (
                <div className="mt-3">
                  <Link className="teal-btn w-full justify-center" to={`/admin/revenue/${encodeURIComponent(active.order_id)}`}>
                    打开订单与交付明细
                  </Link>
                </div>
              ) : null}

              {order && active.order_id === order.id ? (
                <div className="mt-5">
                  <AdminOrderDetail
                    order={order}
                    uploading={uploading}
                    recalling={recalling}
                    deleting={deletingOrder}
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
                    onDeleteOrder={() => void handleDeleteOrder()}
                  />
                </div>
              ) : (
                <p className="funnel-note">回复之后未读会清掉。稿件从这里上传，买家付清尾款才能下载。</p>
              )}
            </>
          ) : (
            <p className="empty">选一条对话后，订单和稿件会出现在这里。</p>
          )}
        </aside>
      </div>
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
