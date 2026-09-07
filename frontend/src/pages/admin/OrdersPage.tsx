import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  Copy,
  Download,
  FileText,
  Image as ImageIcon,
  Lock,
  Mail,
  MessageSquare,
  PenLine,
  Search,
  Upload,
} from 'lucide-react'
import { ApiError, api } from '../../lib/api'
import { useToast } from '../../context/ToastContext'
import { formatWords } from '../../lib/commission'
import { orderCompactLabel, orderDotClass } from '../../lib/orderStatus'
import { MarkdownContent } from '../../components/MarkdownContent'
import type { Order, OrderItem, OrderPayment, ProductFileItem } from '../../types'

type Filter = 'all' | 'pending' | 'deposit_paid' | 'awaiting_balance' | 'completed' | 'commission'

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'pending', label: '待支付' },
  { id: 'deposit_paid', label: '已付定金' },
  { id: 'awaiting_balance', label: '待付尾款' },
  { id: 'completed', label: '已完成' },
  { id: 'commission', label: '仅约稿' },
]

const FLOW = ['付定金', '沟通设定', '按章交稿', '付尾款'] as const

const PROVIDER: Record<string, string> = { alipay: '支付宝', ezpay: '易支付' }
const METHOD: Record<string, string> = { alipay: '支付宝', wxpay: '微信', qqpay: 'QQ' }
const PAY_KIND: Record<string, string> = { deposit: '定金', balance: '尾款', full: '全款' }

function pad(n: number) {
  return String(n).padStart(2, '0')
}

function fmtClock(d: Date) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function fmtListTime(iso?: string | null) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const now = new Date()
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (d.toDateString() === now.toDateString()) return fmtClock(d)
  if (d.toDateString() === yesterday.toDateString()) return `昨天 ${fmtClock(d)}`
  return `${d.getMonth() + 1}/${d.getDate()} ${fmtClock(d)}`
}

function fmtFullTime(iso?: string | null) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${fmtClock(d)}`
}

function yuan(n: number) {
  const v = Math.round(Number(n) * 100) / 100
  const int = Math.trunc(v)
  const frac = Math.round((v - int) * 100)
  const head = int.toLocaleString('zh-CN')
  return frac ? `¥${head}.${String(frac).padStart(2, '0')}` : `¥${head}`
}

function orderTitle(o: Order) {
  return o.items.map((i) => i.name).join('、') || '订单'
}

function isCommission(o: Order) {
  return o.sale_mode === 'commission'
}

function isDone(o: Order) {
  return o.status === 'completed' || o.status === 'paid'
}

function isFollowUp(o: Order) {
  return o.status === 'pending' || o.status === 'deposit_paid' || o.status === 'awaiting_balance'
}

function itemFiles(it: OrderItem): ProductFileItem[] {
  if (it.files && it.files.length) return it.files
  if (it.download_url || it.file_name) {
    return [
      {
        id: it.download_url || it.file_name || 'file',
        file_name: it.file_name || '已购文件',
        is_image: /\.(png|jpe?g|gif|webp|bmp)$/i.test(it.file_name || ''),
        download_url: it.download_url,
      },
    ]
  }
  return []
}

function allFiles(o: Order): ProductFileItem[] {
  return o.items.flatMap(itemFiles)
}

function matchFilter(o: Order, filter: Filter) {
  if (filter === 'all') return true
  if (filter === 'commission') return isCommission(o)
  if (filter === 'completed') return isDone(o)
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

function flowNow(o: Order) {
  if (isDone(o)) return 4
  if (o.status === 'awaiting_balance') return 3
  if (o.status === 'deposit_paid') return allFiles(o).length ? 2 : 1
  return 0
}

function payKindLabel(kind: string) {
  return PAY_KIND[kind] || kind
}

function channelLabel(o: Order) {
  const p = PROVIDER[o.payment_provider || ''] || o.payment_provider || '—'
  const m = METHOD[o.payment_method || '']
  if (p === '—' && !m) return '—'
  return m && m !== p ? `${p}（${m}）` : p
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
      isCommission(o) ? '约稿' : '普通',
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
                      {isCommission(o) ? (
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
            <OrderDetail
              order={active}
              uploading={uploading}
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

function OrderDetail({
  order,
  uploading,
  onCopy,
  onUploadClick,
  onDownload,
  onDelete,
}: {
  order: Order
  uploading: boolean
  onCopy: (text: string, ok?: string) => void
  onUploadClick: () => void
  onDownload: (url: string, name: string) => void
  onDelete: (fileId: string) => void
}) {
  const commission = isCommission(order)
  const files = allFiles(order)
  const canUpload = commission && (order.status === 'deposit_paid' || order.status === 'awaiting_balance')
  const lockedForBuyer = commission && !isDone(order) && files.length > 0
  const step = flowNow(order)
  const payments = [...(order.payments || [])]
  const deposit = order.deposit_amount ?? 0
  const balance = order.balance_amount ?? 0
  const depositPaid = payments.some((p) => p.kind === 'deposit' && p.status === 'paid') || ['deposit_paid', 'awaiting_balance', 'completed'].includes(order.status)
  const balancePaid = payments.some((p) => p.kind === 'balance' && p.status === 'paid') || order.status === 'completed'

  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 font-[family-name:var(--font-mono)] text-[0.78rem] text-ink-mute">
            {order.id}
            <button
              type="button"
              title="复制订单号"
              className="grid p-0.5 text-ink-mute hover:text-teal"
              onClick={() => onCopy(order.id)}
            >
              <Copy className="h-3.5 w-3.5" strokeWidth={1.8} />
            </button>
          </div>
          <h2 className="mt-2.5 font-[family-name:var(--font-display)] text-[1.5rem] leading-snug tracking-[-0.03em] break-words">
            {orderTitle(order)}
          </h2>
          <div className="mt-1.5 text-[0.8rem] text-ink-mute">
            {order.username}
            {order.email ? (
              <>
                {' · '}
                <a className="font-semibold text-teal hover:underline" href={`mailto:${order.email}`}>
                  {order.email}
                </a>
              </>
            ) : null}
            {commission ? (
              <>
                {' · '}
                <Link
                  to={`/admin/conversations?order=${encodeURIComponent(order.id)}`}
                  className="font-semibold text-teal hover:underline"
                >
                  打开约稿对话
                </Link>
              </>
            ) : null}
          </div>
        </div>
        <span className={`mt-0.5 inline-flex shrink-0 items-center gap-1.5 text-[0.8rem] font-semibold ${orderDotClass(order.status)}`}>
          <i className="h-1.5 w-1.5 rounded-full" />
          {commission ? `约稿 · ${orderCompactLabel(order.status)}` : orderCompactLabel(order.status)}
        </span>
      </div>

      <div className="mt-[18px]">
        <div className="font-[family-name:var(--font-display)] text-[2.5rem] leading-none font-extrabold tracking-[-0.05em]">
          {yuan(order.total)}
          {commission ? <small className="ml-1 text-[1rem] tracking-normal text-ink-mute">合计</small> : null}
        </div>
        {commission ? (
          <div className="mt-4 grid grid-cols-3 border-y border-[var(--line)]">
            <SplitCell label="字数" value={order.word_count ? formatWords(order.word_count) : '—'} />
            <SplitCell
              label={`定金 ${depositPaid ? '已收' : '待收'}`}
              value={yuan(deposit)}
              tone={depositPaid ? 'ok' : 'wait'}
            />
            <SplitCell
              label={`尾款 ${balancePaid ? '已收' : '待收'}`}
              value={yuan(balance)}
              tone={balancePaid ? 'ok' : 'wait'}
            />
          </div>
        ) : null}
      </div>

      {commission ? (
        <ol className="mt-5 m-0 grid list-none grid-cols-4 p-0">
          {FLOW.map((label, i) => {
            const on = i < step || i === step
            const now = i === step && step < 4
            return (
              <li key={label} className={`relative pr-3 text-[0.74rem] ${on ? 'font-bold text-ink' : 'text-ink-mute'}`}>
                <i
                  className={`mb-2 block h-1.5 w-1.5 rounded-full ${
                    on ? 'bg-teal' : 'bg-[var(--line-strong)]'
                  } ${now ? 'shadow-[0_0_0_3px_rgba(15,110,92,.18)]' : ''}`}
                />
                {label}
              </li>
            )
          })}
        </ol>
      ) : null}

      <Section title="买家与支付">
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
          <Dt>买家</Dt>
          <Dd>
            {order.username}
            {order.email ? <span className="font-medium text-ink-mute"> {order.email}</span> : null}
          </Dd>
          <Dt>下单时间</Dt>
          <Dd mono>{fmtFullTime(order.created_at)}</Dd>
          <Dt>支付渠道</Dt>
          <Dd>{channelLabel(order)}</Dd>
          {order.trade_no ? (
            <>
              <Dt>渠道流水</Dt>
              <Dd mono>
                <span className="inline-flex items-center justify-end gap-1.5">
                  {order.trade_no}
                  <button type="button" className="text-ink-mute hover:text-teal" onClick={() => onCopy(order.trade_no || '')}>
                    <Copy className="h-3 w-3" strokeWidth={1.8} />
                  </button>
                </span>
              </Dd>
            </>
          ) : null}
          {order.paid_at ? (
            <>
              <Dt>支付时间</Dt>
              <Dd mono>{fmtFullTime(order.paid_at)}</Dd>
            </>
          ) : null}
        </dl>
      </Section>

      <Section title="支付明细" extra={`${payments.length} 笔`}>
        {payments.length ? (
          <ul className="m-0 mt-1 list-none p-0">
            {payments.map((p) => (
              <PaymentRow key={p.id} payment={p} />
            ))}
          </ul>
        ) : (
          <p className="mt-3 mb-0 text-[0.8rem] text-ink-mute">暂无支付记录</p>
        )}
      </Section>

      <Section title={commission ? '稿件交付' : '发放内容'} extra={`${files.length} 个文件`}>
        {files.length ? (
          <ul className="m-0 mt-2 list-none p-0">
            {files.map((f) => (
              <li key={f.id} className="flex items-center gap-2.5 border-b border-[var(--line)] py-2.5 last:border-b-0">
                <div className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-sm bg-[rgba(15,110,92,.1)] text-teal">
                  {f.is_image ? <ImageIcon className="h-3.5 w-3.5" strokeWidth={1.8} /> : <FileText className="h-3.5 w-3.5" strokeWidth={1.8} />}
                </div>
                <div className="min-w-0 flex-1">
                  <b className="block truncate text-[0.8rem]">{f.file_name}</b>
                  {lockedForBuyer ? <small className="text-[0.7rem] text-ink-mute">买家付尾款后解锁</small> : null}
                </div>
                <div className="flex shrink-0 gap-2.5">
                  {f.download_url ? (
                    <button
                      type="button"
                      className="border-0 bg-transparent p-0 text-[0.74rem] font-bold text-teal hover:underline"
                      onClick={() => onDownload(f.download_url!, f.file_name)}
                    >
                      下载
                    </button>
                  ) : (
                    <span className="text-[0.74rem] text-ink-mute">预览</span>
                  )}
                  {canUpload ? (
                    <button
                      type="button"
                      className="border-0 bg-transparent p-0 text-[0.74rem] font-semibold text-danger hover:underline"
                      onClick={() => onDelete(f.id)}
                    >
                      删除
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <PayloadFallback items={order.items} commission={commission} />
        )}
        {canUpload ? (
          <button
            type="button"
            disabled={uploading}
            onClick={onUploadClick}
            className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-sm border border-dashed border-[var(--line-strong)] px-3.5 py-3.5 text-[0.78rem] text-ink-mute transition hover:border-teal hover:text-teal disabled:opacity-60"
          >
            <Upload className="h-3.5 w-3.5" strokeWidth={1.8} />
            {uploading ? '上传中…' : '上传稿件（DOCX / TXT / 图片）'}
          </button>
        ) : null}
        {lockedForBuyer ? (
          <div className="mt-2.5 flex items-start gap-2 bg-paper px-3 py-2.5 text-[0.76rem] text-ink-soft">
            <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
            <span>管理员可随时下载。买家需付清尾款后才能解锁文件。</span>
          </div>
        ) : null}
      </Section>

      <div className="mt-7 flex flex-wrap gap-2">
        {commission ? (
          <Link
            to={`/admin/conversations?order=${encodeURIComponent(order.id)}`}
            className="inline-flex h-[38px] items-center gap-1.5 rounded-[10px] bg-teal px-4 text-[0.84rem] font-bold text-white hover:bg-teal-deep"
          >
            <MessageSquare className="h-3.5 w-3.5" strokeWidth={1.9} />
            打开对话
          </Link>
        ) : null}
        <button
          type="button"
          className="inline-flex h-[38px] items-center gap-1.5 rounded-[10px] border border-[var(--line-strong)] px-3.5 text-[0.82rem] font-semibold hover:border-ink"
          onClick={() => onCopy(order.id, '已复制订单号')}
        >
          <Copy className="h-3.5 w-3.5" strokeWidth={1.8} />
          复制单号
        </button>
        {order.email ? (
          <a
            href={`mailto:${order.email}`}
            className="inline-flex h-[38px] items-center gap-1.5 rounded-[10px] border border-[var(--line-strong)] px-3.5 text-[0.82rem] font-semibold hover:border-ink"
          >
            <Mail className="h-3.5 w-3.5" strokeWidth={1.8} />
            发邮件
          </a>
        ) : null}
      </div>
    </div>
  )
}

function Section({ title, extra, children }: { title: string; extra?: string; children: ReactNode }) {
  return (
    <section className="mt-7">
      <h3 className="m-0 flex items-baseline justify-between gap-2 border-b border-[var(--line)] pb-2.5 text-[0.76rem] font-bold tracking-[0.08em] text-ink-soft">
        {title}
        {extra ? <small className="font-medium tracking-normal text-ink-mute">{extra}</small> : null}
      </h3>
      {children}
    </section>
  )
}

function SplitCell({ label, value, tone }: { label: string; value: string; tone?: 'ok' | 'wait' }) {
  return (
    <div className="border-[var(--line)] py-3 first:pl-0 [&:not(:first-child)]:border-l [&:not(:first-child)]:pl-4">
      <small className="mb-1 block text-[0.7rem] tracking-[0.05em] text-ink-mute">{label}</small>
      <b
        className={`font-[family-name:var(--font-mono)] text-[0.92rem] font-bold tracking-[-0.01em] ${
          tone === 'ok' ? 'text-teal' : tone === 'wait' ? 'text-[#8a6a2f]' : ''
        }`}
      >
        {value}
      </b>
    </div>
  )
}

function Dt({ children }: { children: ReactNode }) {
  return <dt className="whitespace-nowrap text-[0.8rem] text-ink-mute">{children}</dt>
}

function Dd({ children, mono }: { children: ReactNode; mono?: boolean }) {
  return (
    <dd className={`m-0 text-right text-[0.84rem] font-semibold break-all ${mono ? 'font-[family-name:var(--font-mono)] text-[0.78rem] tracking-[-0.01em]' : ''}`}>
      {children}
    </dd>
  )
}

function PaymentRow({ payment }: { payment: OrderPayment }) {
  const paid = payment.status === 'paid'
  return (
    <li className="border-b border-[var(--line)] py-3 last:border-b-0">
      <div className="flex items-baseline justify-between gap-2.5">
        <b className="text-[0.88rem]">{payKindLabel(payment.kind)}</b>
        <span className="font-[family-name:var(--font-mono)] text-[0.84rem] font-bold whitespace-nowrap">{yuan(payment.amount)}</span>
      </div>
      <div className="mt-1 flex justify-between text-[0.74rem] text-ink-mute">
        <span className={`inline-flex items-center gap-1.5 text-[0.72rem] font-semibold ${paid ? 'text-teal [&_i]:bg-teal' : 'text-[#8a6a2f] [&_i]:bg-[#c4a574]'}`}>
          <i className="h-1.5 w-1.5 rounded-full" />
          {paid ? '已到账' : '待支付'}
        </span>
        <span className="font-[family-name:var(--font-mono)]">{paid ? fmtListTime(payment.paid_at) : '—'}</span>
      </div>
    </li>
  )
}

function PayloadFallback({ items, commission }: { items: OrderItem[]; commission: boolean }) {
  const payloads = items.filter((it) => it.payload)
  if (payloads.length) {
    return (
      <div className="mt-3 space-y-3">
        {payloads.map((it, i) => (
          <div key={`${it.product_id}-${i}`} className="min-w-0 text-[0.84rem]">
            {items.length > 1 ? <div className="mb-1 text-[0.76rem] font-semibold text-ink-soft">{it.name}</div> : null}
            <MarkdownContent content={it.payload || ''} />
          </div>
        ))}
      </div>
    )
  }
  return (
    <p className="mt-3 mb-0 text-[0.8rem] text-ink-mute">{commission ? '还未上传稿件' : '未发放'}</p>
  )
}
