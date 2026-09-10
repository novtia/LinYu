import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Download, PenLine, Search } from 'lucide-react'
import { ApiError, api } from '../../lib/api'
import { useToast } from '../../context/ToastContext'
import { formatWords } from '../../lib/commission'
import { fmtFullTime, isCommissionOrder, isDoneStatus, orderTitle } from '../../lib/orderDisplay'
import { orderCompactLabel, orderDotClass } from '../../lib/orderStatus'
import { AdminOrderDetail, fmtListTime, yuan } from '../../components/AdminOrderDetail'
import type { Order } from '../../types'

type Filter = 'all' | 'pending' | 'deposit_paid' | 'awaiting_balance' | 'completed' | 'commission'

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'pending', label: '待支付' },
  { id: 'deposit_paid', label: '已付定金' },
  { id: 'awaiting_balance', label: '待付尾款' },
  { id: 'completed', label: '已完成' },
  { id: 'commission', label: '仅约稿' },
]

function isFollowUp(o: Order) {
  return o.status === 'pending' || o.status === 'deposit_paid' || o.status === 'awaiting_balance'
}

function matchFilter(o: Order, filter: Filter) {
  if (filter === 'all') return true
  if (filter === 'commission') return isCommissionOrder(o)
  if (filter === 'completed') return isDoneStatus(o.status)
  return o.status === filter
}

function matchQuery(o: Order, q: string) {
  if (!q) return true
  const hay = [o.id, o.username, o.email, orderTitle(o)].join(' ').toLowerCase()
  return hay.includes(q)
}

function parseFilter(raw: string | null): Filter {
  return FILTERS.some((f) => f.id === raw) ? (raw as Filter) : 'all'
}

function csvEscape(v: string) {
  if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`
  return v
}

function exportCsv(rows: Order[]) {
  const head = ['订单号', '买家', '邮箱', '商品', '金额', '状态', '模式', '下单时间']
  const body = rows.map((o) =>
    [
      o.id,
      o.username,
      o.email || '',
      orderTitle(o),
      String(o.total),
      orderCompactLabel(o.status),
      isCommissionOrder(o) ? '约稿' : '普通',
      fmtFullTime(o.created_at),
    ]
      .map(csvEscape)
      .join(','),
  )
  const blob = new Blob(['\uFEFF' + [head.join(','), ...body].join('\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `orders-${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export function OrdersPage() {
  const { showToast } = useToast()
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const filter = parseFilter(searchParams.get('status'))
  const [orders, setOrders] = useState<Order[]>([])
  const [query, setQuery] = useState('')
  const [detail, setDetail] = useState<Order | null>(null)
  const [busy, setBusy] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [recalling, setRecalling] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return orders.filter((o) => matchFilter(o, filter) && matchQuery(o, q))
  }, [orders, filter, query])

  const followN = useMemo(() => orders.filter(isFollowUp).length, [orders])

  useEffect(() => {
    api
      .get<Order[]>('/api/orders')
      .then(setOrders)
      .catch((e) => {
        setOrders([])
        showToast(e instanceof ApiError ? e.message : '订单加载失败')
      })
      .finally(() => setBusy(false))
  }, [showToast])

  useEffect(() => {
    if (id || busy || !orders.length) return
    const pick = orders.find((o) => matchFilter(o, filter)) || orders[0]
    if (!pick) return
    const qs = searchParams.toString()
    navigate(`/admin/orders/${encodeURIComponent(pick.id)}${qs ? `?${qs}` : ''}`, { replace: true })
  }, [id, busy, orders, filter, navigate, searchParams])

  useEffect(() => {
    if (!id) {
      setDetail(null)
      return
    }
    const hit = orders.find((o) => o.id === id)
    if (hit) setDetail(hit)
    let alive = true
    api
      .get<Order>(`/api/orders/${encodeURIComponent(id)}`)
      .then((o) => {
        if (!alive) return
        setDetail(o)
        setOrders((prev) => {
          const i = prev.findIndex((x) => x.id === o.id)
          if (i < 0) return [o, ...prev]
          const next = prev.slice()
          next[i] = o
          return next
        })
      })
      .catch((e) => {
        if (alive) showToast(e instanceof ApiError ? e.message : '订单详情加载失败')
      })
    return () => {
      alive = false
    }
    // 列表刷新不应反复打详情接口
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  function setFilter(next: Filter) {
    const sp = new URLSearchParams(searchParams)
    if (next === 'all') sp.delete('status')
    else sp.set('status', next)
    setSearchParams(sp, { replace: true })
  }

  function openOrder(orderId: string) {
    const qs = searchParams.toString()
    navigate(`/admin/orders/${encodeURIComponent(orderId)}${qs ? `?${qs}` : ''}`)
  }

  async function copyText(text: string, ok = '已复制') {
    try {
      await navigator.clipboard.writeText(text)
      showToast(ok)
    } catch {
      showToast('复制失败')
    }
  }

  async function reloadDetail() {
    if (!id) return
    const o = await api.get<Order>(`/api/orders/${encodeURIComponent(id)}`)
    setDetail(o)
    setOrders((prev) => prev.map((x) => (x.id === o.id ? o : x)))
    return o
  }

  async function handleUpload(file: File) {
    if (!id) return
    setUploading(true)
    try {
      await api.upload(`/api/orders/${id}/files`, file)
      await reloadDetail()
      showToast('稿件已上传')
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : '上传失败')
    } finally {
      setUploading(false)
    }
  }

  async function handleDelete(fileId: string) {
    if (!id) return
    try {
      await api.delete(`/api/orders/${id}/files/${fileId}`)
      await reloadDetail()
      showToast('已删除稿件')
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : '删除失败')
    }
  }

  async function handleRecallDelivery() {
    if (!id) return
    if (!window.confirm('撤回发货后，对话里的发货通知会一并撤回，订单回到待交稿。确定撤回？')) return
    setRecalling(true)
    try {
      const o = await api.post<Order>(`/api/orders/${encodeURIComponent(id)}/recall-delivery`)
      setDetail(o)
      setOrders((prev) => prev.map((x) => (x.id === o.id ? o : x)))
      showToast('已撤回发货')
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : '撤回失败')
    } finally {
      setRecalling(false)
    }
  }

  const active = detail && detail.id === id ? detail : orders.find((o) => o.id === id) || null

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-white">
      <header className="shrink-0 px-5 pt-6 md:px-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="font-[family-name:var(--font-display)] text-[clamp(1.7rem,2.6vw,2.1rem)] leading-[1.1] font-extrabold tracking-[-0.04em]">
              订单管理
            </h1>
            <p className="mt-1 text-[0.86rem] text-ink-mute">
              {busy ? (
                '加载中…'
              ) : (
                <>
                  当前筛选 <b className="font-bold text-teal">{filtered.length}</b> 笔，
                  <b className="font-bold text-teal">{followN}</b> 笔待跟进。
                </>
              )}
            </p>
          </div>
          <button
            type="button"
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[10px] border border-[var(--line-strong)] px-3.5 text-[0.82rem] font-semibold text-ink transition hover:border-ink"
            onClick={() => {
              exportCsv(filtered)
              showToast(filtered.length ? `已导出 ${filtered.length} 笔` : '没有可导出的订单')
            }}
          >
            <Download className="h-3.5 w-3.5" strokeWidth={1.9} />
            导出 CSV
          </button>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-3">
          <label className="flex min-w-[220px] max-w-[380px] flex-1 items-center gap-2 border-b border-[var(--line-strong)] pb-1.5 focus-within:border-teal">
            <Search className="h-3.5 w-3.5 shrink-0 text-ink-mute" strokeWidth={1.9} />
            <input
              className="min-w-0 flex-1 border-0 bg-transparent text-[0.88rem] outline-none placeholder:text-ink-mute"
              placeholder="搜索订单号、买家、邮箱或商品"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <div className="flex flex-wrap gap-1">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFilter(f.id)}
                className={`inline-flex h-[30px] items-center rounded-lg px-3 text-[0.8rem] font-semibold ${
                  filter === f.id
                    ? 'border border-[var(--line-strong)] bg-white text-ink'
                    : 'border border-transparent bg-transparent text-ink-mute hover:bg-paper hover:text-ink'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(0,1fr)_minmax(0,1.15fr)] border-t border-[var(--line)] xl:grid-cols-[minmax(0,1fr)_400px] xl:grid-rows-[minmax(0,1fr)]">
        <section className="min-h-0 overflow-y-auto overscroll-contain px-2 pb-8 md:px-4">
          {busy ? (
            <p className="px-4 py-12 text-[0.86rem] text-ink-mute">加载中…</p>
          ) : filtered.length ? (
            filtered.map((o) => {
              const on = o.id === id
              return (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => openOrder(o.id)}
                  className={`relative grid w-full grid-cols-[minmax(0,1fr)_auto_auto] gap-x-[18px] gap-y-1 border-b border-[var(--line)] py-4 pr-3 pl-4 text-left transition hover:bg-[rgba(232,241,238,.45)] ${
                    on ? 'bg-paper before:bg-teal' : 'before:bg-transparent'
                  } before:absolute before:top-0 before:bottom-0 before:left-0 before:w-0.5`}
                >
                  <div className="min-w-0">
                    <div className="flex items-baseline gap-2.5">
                      <span className="font-[family-name:var(--font-mono)] text-[0.74rem] tracking-[-0.01em] text-ink-mute">
                        {o.id}
                      </span>
                      {isCommissionOrder(o) ? (
                        <span className="inline-flex shrink-0 items-center gap-0.5 text-[0.68rem] font-bold text-teal">
                          <PenLine className="h-3 w-3" strokeWidth={2} />
                          约稿{o.word_count ? ` · ${formatWords(o.word_count)}` : ''}
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-1 truncate text-[0.92rem] font-bold">{orderTitle(o)}</div>
                    <div className="mt-0.5 flex flex-wrap gap-2.5 text-[0.76rem] text-ink-mute">
                      <span>{o.username}</span>
                      {o.email ? <span>{o.email}</span> : null}
                    </div>
                  </div>
                  <span
                    className={`inline-flex items-center gap-1.5 self-center text-[0.76rem] font-semibold whitespace-nowrap ${orderDotClass(o.status)}`}
                  >
                    <i className="h-1.5 w-1.5 rounded-full" />
                    {orderCompactLabel(o.status)}
                  </span>
                  <div className="flex flex-col items-end justify-center gap-1 self-center">
                    <span className="font-[family-name:var(--font-mono)] text-[0.95rem] font-bold tracking-[-0.02em]">
                      {yuan(o.total)}
                    </span>
                    <span className="font-[family-name:var(--font-mono)] text-[0.68rem] text-ink-mute">
                      {fmtListTime(o.created_at)}
                    </span>
                  </div>
                </button>
              )
            })
          ) : (
            <p className="px-4 py-16 text-center text-[0.86rem] text-ink-mute">没有匹配的订单</p>
          )}
        </section>

        <aside className="hover-scroll min-h-0 overflow-y-auto overscroll-contain border-t border-[var(--line)] px-5 py-6 md:px-8 xl:border-t-0 xl:border-l xl:px-7">
          {active ? (
            <AdminOrderDetail
              order={active}
              uploading={uploading}
              recalling={recalling}
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
          ) : (
            <div className="px-2 py-16 text-center text-[0.86rem] text-ink-mute">选择左侧订单查看详情</div>
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
