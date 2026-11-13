import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Download, Search, SlidersHorizontal, Trash2, X } from 'lucide-react'
import { ApiError, api } from '../../lib/api'
import { useToast } from '../../context/ToastContext'
import { isCommissionOrder, itemFiles, orderTitle } from '../../lib/orderDisplay'
import { shanghaiDay } from '../../lib/ledger'
import { beijingDateKey } from '../../lib/time'
import { orderCompactLabel, orderDotClass } from '../../lib/orderStatus'
import { AdminOrderDetail, fmtListTime, yuan } from '../../components/AdminOrderDetail'
import type { Order } from '../../types'

const STATUS_OPTS = [
  ['pending', '待支付'],
  ['deposit_paid', '已付定金'],
  ['awaiting_balance', '待付尾款'],
  ['paid', '已支付'],
  ['completed', '已完成'],
  ['failed', '支付失败'],
  ['cancelled', '已取消'],
] as const

const SHIP_OPTS = [
  ['none', '未发放'],
  ['text', '文本'],
  ['file', '成品文件'],
  ['commission', '约稿稿件'],
] as const

type ShipKind = (typeof SHIP_OPTS)[number][0]

type Applied = {
  q: string
  statuses: Set<string>
  ships: Set<string>
  modes: Set<string>
}

const ALL_STATUS = new Set(STATUS_OPTS.map((s) => s[0]))
const ALL_SHIP = new Set(SHIP_OPTS.map((s) => s[0]))
const ALL_MODE = new Set(['normal', 'commission'])

function shipTags(o: Order): ShipKind[] {
  const files = o.items.flatMap(itemFiles)
  const text = o.items.some((it) => (it.payload || '').trim())
  const tags: ShipKind[] = []
  if (text) tags.push('text')
  if (files.length && isCommissionOrder(o)) tags.push('commission')
  else if (files.length) tags.push('file')
  if (!tags.length) tags.push('none')
  return tags
}

function shipLabel(o: Order) {
  const tags = shipTags(o)
  if (tags.includes('none')) return <span className="rounded bg-[rgba(20,32,28,.06)] px-1.5 py-0.5 text-[0.68rem] font-bold text-ink-mute">未发放</span>
  return (
    <span className="inline-flex flex-wrap gap-1">
      {tags.map((k) =>
        k === 'text' ? (
          <span key={k} className="rounded bg-[rgba(15,110,92,.1)] px-1.5 py-0.5 text-[0.68rem] font-bold text-teal">
            文本
          </span>
        ) : k === 'commission' ? (
          <span key={k} className="rounded bg-[rgba(196,165,116,.22)] px-1.5 py-0.5 text-[0.68rem] font-bold text-[#8a6a2f]">
            约稿
          </span>
        ) : (
          <span key={k} className="rounded bg-[rgba(15,110,92,.1)] px-1.5 py-0.5 text-[0.68rem] font-bold text-teal">
            文件 {o.items.flatMap(itemFiles).length}
          </span>
        ),
      )}
    </span>
  )
}

function channelBucket(o: Order) {
  const method = o.payment_method || ''
  const provider = o.payment_provider || ''
  if (provider === 'usdt' || method.startsWith('usdt')) return 'USDT'
  if (method === 'wxpay') return '微信'
  if (provider === 'alipay' || method === 'alipay') return '支付宝'
  if (provider === 'ezpay') return '易支付'
  if (provider || method) return '其他'
  return '—'
}

function touchesDay(o: Order, day: string) {
  if (shanghaiDay(o.created_at) === day) return true
  if (o.paid_at && shanghaiDay(o.paid_at) === day) return true
  return (o.payments || []).some((p) => p.paid_at && shanghaiDay(p.paid_at) === day)
}

function isFollowUp(o: Order) {
  return o.status === 'pending' || o.status === 'deposit_paid' || o.status === 'awaiting_balance'
}

function paidSum(list: Order[]) {
  return list.reduce((sum, o) => {
    const paid = (o.payments || []).filter((p) => p.status === 'paid').reduce((a, p) => a + p.amount, 0)
    if (paid) return sum + paid
    if (o.status === 'paid' || o.status === 'completed') return sum + o.total
    if (o.status === 'deposit_paid' || o.status === 'awaiting_balance') return sum + (o.deposit_amount || o.total / 2)
    return sum
  }, 0)
}

function parseApplied(sp: URLSearchParams): Applied {
  const base = (): Applied => ({
    q: sp.get('q') || '',
    statuses: new Set(ALL_STATUS),
    ships: new Set(ALL_SHIP),
    modes: new Set(ALL_MODE),
  })
  const out = base()
  const status = sp.get('status')
  if (status === 'commission') out.modes = new Set(['commission'])
  else if (status) {
    const parts = status.split(',').filter(Boolean)
    const known = parts.filter((p) => ALL_STATUS.has(p as (typeof STATUS_OPTS)[number][0]))
    if (known.length) out.statuses = new Set(known)
  }
  const ship = sp.get('ship')
  if (ship) {
    const parts = ship.split(',').filter((p) => ALL_SHIP.has(p as ShipKind))
    if (parts.length) out.ships = new Set(parts)
  }
  const mode = sp.get('mode')
  if (mode && status !== 'commission') {
    const parts = mode.split(',').filter((p) => p === 'normal' || p === 'commission')
    if (parts.length) out.modes = new Set(parts)
  }
  return out
}

function match(o: Order, f: Applied) {
  if (f.q) {
    const hay = [o.id, o.username, o.email, orderTitle(o), ...o.items.map((it) => it.payload || '')].join(' ').toLowerCase()
    if (!hay.includes(f.q)) return false
  }
  if (f.statuses.size < ALL_STATUS.size && !f.statuses.has(o.status)) return false
  if (f.modes.size < ALL_MODE.size && !f.modes.has(isCommissionOrder(o) ? 'commission' : 'normal')) return false
  if (f.ships.size < ALL_SHIP.size && !shipTags(o).some((t) => f.ships.has(t))) return false
  return true
}

function csvEscape(v: string) {
  if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`
  return v
}

function exportCsv(rows: Order[]) {
  const head = ['订单号', '买家', '邮箱', '商品', '金额', '状态', '发放', '下单时间']
  const body = rows.map((o) =>
    [o.id, o.username, o.email || '', orderTitle(o), String(o.total), orderCompactLabel(o.status), shipTags(o).join('/'), o.created_at]
      .map(csvEscape)
      .join(','),
  )
  const blob = new Blob(['\uFEFF' + [head.join(','), ...body].join('\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `orders-${beijingDateKey()}.csv`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export function OrdersPage({
  bridgeDay = '',
  bridgeChannel = '',
  onClearDay,
  onClearChannel,
  onOrdersChanged,
}: {
  bridgeDay?: string
  bridgeChannel?: string
  onClearDay?: () => void
  onClearChannel?: () => void
  onOrdersChanged?: () => void
} = {}) {
  const { showToast } = useToast()
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const applied = useMemo(() => parseApplied(searchParams), [searchParams])
  const [orders, setOrders] = useState<Order[]>([])
  const [detail, setDetail] = useState<Order | null>(null)
  const [busy, setBusy] = useState(true)
  const [filterOpen, setFilterOpen] = useState(false)
  const [draft, setDraft] = useState<Applied>(applied)
  const [uploading, setUploading] = useState(false)
  const [recalling, setRecalling] = useState(false)
  const [replenishing, setReplenishing] = useState(false)
  const [deletingId, setDeletingId] = useState('')
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [batchDeleting, setBatchDeleting] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const filtered = useMemo(
    () =>
      orders.filter((o) => {
        if (!match(o, applied)) return false
        if (bridgeDay && !touchesDay(o, bridgeDay)) return false
        if (bridgeChannel && channelBucket(o) !== bridgeChannel) return false
        return true
      }),
    [orders, applied, bridgeDay, bridgeChannel],
  )
  const followN = useMemo(() => orders.filter(isFollowUp).length, [orders])
  const sentN = useMemo(() => orders.filter((o) => !shipTags(o).includes('none')).length, [orders])

  const loadOrders = useCallback(() => {
    return api
      .get<Order[]>('/api/orders')
      .then(setOrders)
      .catch((e) => {
        setOrders([])
        showToast(e instanceof ApiError ? e.message : '订单加载失败')
      })
      .finally(() => setBusy(false))
  }, [showToast])

  useEffect(() => {
    void loadOrders()
  }, [loadOrders])

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  useEffect(() => {
    if (window.location.hash !== '#orders' && !searchParams.get('status') && !searchParams.get('q') && !searchParams.get('ship')) return
    document.getElementById('orders')?.scrollIntoView({ block: 'start' })
  }, [searchParams])

  useEffect(() => {
    if (!filterOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFilterOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [filterOpen])

  function writeParams(f: Applied) {
    const sp = new URLSearchParams(searchParams)
    const all =
      f.statuses.size === ALL_STATUS.size &&
      f.ships.size === ALL_SHIP.size &&
      f.modes.size === ALL_MODE.size &&
      !f.q
    if (all) {
      sp.delete('status')
      sp.delete('ship')
      sp.delete('mode')
      sp.delete('q')
    } else if (f.modes.size === 1 && f.modes.has('commission') && f.statuses.size === ALL_STATUS.size && f.ships.size === ALL_SHIP.size && !f.q) {
      sp.set('status', 'commission')
      sp.delete('ship')
      sp.delete('mode')
      sp.delete('q')
    } else {
      sp.set('status', [...f.statuses].join(','))
      sp.set('ship', [...f.ships].join(','))
      sp.set('mode', [...f.modes].join(','))
      if (f.q) sp.set('q', f.q)
      else sp.delete('q')
    }
    setSearchParams(sp, { replace: true })
  }

  function openOrder(orderId: string) {
    const qs = searchParams.toString()
    navigate(`/admin/revenue/${encodeURIComponent(orderId)}${qs ? `?${qs}` : ''}`)
  }

  function closeOrder() {
    const sp = new URLSearchParams(searchParams)
    const qs = sp.toString()
    navigate(`/admin/revenue${qs ? `?${qs}` : ''}`)
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

  async function handleReplenish() {
    if (!id) return
    if (!window.confirm('将把商品里当前已上传的文件补发到这个订单，买家刷新后即可下载。确定补货？')) return
    setReplenishing(true)
    try {
      const o = await api.post<Order>(`/api/orders/${encodeURIComponent(id)}/replenish`)
      setDetail(o)
      setOrders((prev) => prev.map((x) => (x.id === o.id ? o : x)))
      showToast('已补货，买家现在可以下载')
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : '补货失败')
    } finally {
      setReplenishing(false)
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

  async function handleDeleteOrder(targetId: string) {
    if (!window.confirm(`确定删除订单「${targetId}」？此操作会同步清理支付流水、发放记录与关联约稿对话，且不可恢复。`)) return
    setDeletingId(targetId)
    try {
      await api.delete(`/api/orders/${encodeURIComponent(targetId)}`)
      setOrders((prev) => prev.filter((o) => o.id !== targetId))
      setSelected((prev) => {
        const next = new Set(prev)
        next.delete(targetId)
        return next
      })
      if (id === targetId) {
        setDetail(null)
        closeOrder()
      }
      onOrdersChanged?.()
      showToast('订单已删除')
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : '删除订单失败')
    } finally {
      setDeletingId('')
    }
  }

  async function handleBatchDelete() {
    const ids = filtered.map((o) => o.id).filter((oid) => selected.has(oid))
    if (!ids.length) return
    if (!window.confirm(`确定删除选中的 ${ids.length} 笔订单？关联的支付记录、发放记录与约稿对话将一并清除且不可恢复。`)) return
    setBatchDeleting(true)
    try {
      await api.post('/api/orders/batch-delete', { ids })
      const delSet = new Set(ids)
      setOrders((prev) => prev.filter((o) => !delSet.has(o.id)))
      setSelected((prev) => {
        const next = new Set(prev)
        ids.forEach((oid) => next.delete(oid))
        return next
      })
      if (id && delSet.has(id)) {
        setDetail(null)
        closeOrder()
      }
      onOrdersChanged?.()
      showToast(`已删除 ${ids.length} 笔订单`)
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : '批量删除失败')
    } finally {
      setBatchDeleting(false)
    }
  }

  function toggleOne(orderId: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(orderId)) next.delete(orderId)
      else next.add(orderId)
      return next
    })
  }

  const allVisibleSelected = filtered.length > 0 && filtered.every((o) => selected.has(o.id))
  const selectedVisibleCount = filtered.filter((o) => selected.has(o.id)).length

  function toggleAllVisible() {
    setSelected((prev) => {
      const next = new Set(prev)
      if (allVisibleSelected) {
        filtered.forEach((o) => next.delete(o.id))
      } else {
        filtered.forEach((o) => next.add(o.id))
      }
      return next
    })
  }

  function toggleDraft(key: 'statuses' | 'ships' | 'modes', value: string) {
    setDraft((prev) => {
      const next = new Set(prev[key])
      if (next.has(value)) next.delete(value)
      else next.add(value)
      return { ...prev, [key]: next }
    })
  }

  const active = detail && detail.id === id ? detail : orders.find((o) => o.id === id) || null

  const quickTabs = [
    { key: 'all', label: '全部', count: orders.length },
    { key: 'follow', label: '待跟进', count: orders.filter(isFollowUp).length },
    { key: 'awaiting_balance', label: '待付尾款', count: orders.filter((o) => o.status === 'awaiting_balance').length },
    { key: 'deposit_paid', label: '已付定金', count: orders.filter((o) => o.status === 'deposit_paid').length },
    { key: 'completed', label: '已完成', count: orders.filter((o) => o.status === 'completed' || o.status === 'paid').length },
    { key: 'failed', label: '未入账/取消', count: orders.filter((o) => o.status === 'failed' || o.status === 'cancelled').length },
  ]
  const activeTabKey = (() => {
    const s = applied.statuses
    if (s.size === ALL_STATUS.size) return 'all'
    if (s.size === 3 && s.has('pending') && s.has('deposit_paid') && s.has('awaiting_balance')) return 'follow'
    if (s.size === 1 && s.has('awaiting_balance')) return 'awaiting_balance'
    if (s.size === 1 && s.has('deposit_paid')) return 'deposit_paid'
    if (s.size === 2 && s.has('completed') && s.has('paid')) return 'completed'
    if (s.size === 2 && s.has('failed') && s.has('cancelled')) return 'failed'
    return ''
  })()

  function pickTab(key: string) {
    let nextStatuses: Set<string> = new Set(ALL_STATUS)
    if (key === 'follow') nextStatuses = new Set(['pending', 'deposit_paid', 'awaiting_balance'])
    else if (key === 'completed') nextStatuses = new Set(['completed', 'paid'])
    else if (key === 'failed') nextStatuses = new Set(['failed', 'cancelled'])
    else if (key !== 'all') nextStatuses = new Set([key])
    writeParams({ ...applied, statuses: nextStatuses })
  }

  return (
    <section id="orders" className="rev-chapter" style={{ borderTop: '2px solid var(--ink)' }}>
      <header className="rev-head">
        <div>
          <h2>订单与交付台账</h2>
          <p className="sum">
            {busy ? (
              '加载中…'
            ) : (
              <>
                显示 <b className="font-bold text-teal">{filtered.length}</b> / {orders.length} 笔 · 待跟进{' '}
                <b className="font-bold text-teal">{followN}</b> · 已到账 {yuan(paidSum(orders))} · 已发放 {sentN}
              </>
            )}
          </p>
        </div>
        <div className="head-actions">
          {selectedVisibleCount > 0 ? (
            <button
              type="button"
              disabled={batchDeleting}
              onClick={() => void handleBatchDelete()}
              className="line-btn danger"
            >
              <Trash2 className="h-3.5 w-3.5" strokeWidth={1.8} />
              {batchDeleting ? '删除中…' : `删除所选 (${selectedVisibleCount})`}
            </button>
          ) : null}
          <button
            type="button"
            className="ghost-btn"
            onClick={() => {
              setDraft({
                q: applied.q,
                statuses: new Set(applied.statuses),
                ships: new Set(applied.ships),
                modes: new Set(applied.modes),
              })
              setFilterOpen(true)
            }}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" strokeWidth={1.8} />
            组合筛选
          </button>
          <button
            type="button"
            className="ghost-btn"
            onClick={() => {
              exportCsv(filtered)
              showToast(filtered.length ? `已导出 ${filtered.length} 笔` : '没有可导出的订单')
            }}
          >
            <Download className="h-3.5 w-3.5" strokeWidth={1.9} />
            导出
          </button>
        </div>
      </header>

      <div className="order-toolbar">
        <div className="status-tabs">
          {quickTabs.map((t) => (
            <button key={t.key} type="button" className={activeTabKey === t.key ? 'on' : ''} onClick={() => pickTab(t.key)}>
              {t.label}
              <span className="cnt">{t.count}</span>
            </button>
          ))}
        </div>
        <label className="quick-search">
          <Search className="h-3.5 w-3.5 text-ink-mute" />
          <input
            value={applied.q}
            placeholder="搜索买家、订单号、商品名…"
            onChange={(e) => writeParams({ ...applied, q: e.target.value.trim().toLowerCase() })}
          />
        </label>
      </div>

      {bridgeDay || bridgeChannel ? (
        <div className="bridge">
          {bridgeDay ? (
            <button type="button" onClick={onClearDay}>
              日账 · {bridgeDay.slice(5)} ×
            </button>
          ) : null}
          {bridgeChannel ? (
            <button type="button" onClick={onClearChannel}>
              渠道 · {bridgeChannel} ×
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="table-wrap" style={{ background: '#fff', border: '1px solid var(--line)', marginTop: 12 }}>
        <table>
          <thead>
            <tr className="text-left text-[0.69rem] font-bold tracking-[0.06em] text-ink-mute">
              <th className="sticky top-0 z-[1] w-9 border-b border-[var(--line-strong)] bg-[#f8fbfa] px-3 py-2.5">
                <input
                  type="checkbox"
                  aria-label="全选当前列表订单"
                  className="accent-teal"
                  checked={allVisibleSelected}
                  onChange={toggleAllVisible}
                />
              </th>
              {['时间', '订单号', '买家', '商品', '金额', '状态', '发放', ''].map((h) => (
                <th key={h || 'ops'} className="sticky top-0 z-[1] border-b border-[var(--line-strong)] bg-[#f8fbfa] px-3 py-2.5 font-bold">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {busy ? (
              <tr>
                <td colSpan={9} className="px-3 py-10 text-[0.86rem] text-ink-mute">
                  加载中…
                </td>
              </tr>
            ) : filtered.length ? (
              filtered.map((o) => (
                <tr
                  key={o.id}
                  onClick={() => (o.id === id ? closeOrder() : openOrder(o.id))}
                  className={o.id === id ? 'on' : ''}
                >
                  <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      aria-label={`选择订单 ${o.id}`}
                      className="accent-teal"
                      checked={selected.has(o.id)}
                      onChange={() => toggleOne(o.id)}
                    />
                  </td>
                  <td className="px-2.5 py-2 font-[family-name:var(--font-mono)] whitespace-nowrap text-ink-mute">
                    {fmtListTime(o.created_at)}
                  </td>
                  <td className="px-2.5 py-2 font-[family-name:var(--font-mono)] whitespace-nowrap">{o.id}</td>
                  <td className="px-2.5 py-2 whitespace-nowrap">
                    {o.username}
                    {o.email ? <span className="mt-px block text-[0.72rem] text-ink-mute">{o.email}</span> : null}
                  </td>
                  <td className="max-w-[280px] px-2.5 py-2">
                    <span className="block truncate font-semibold">{orderTitle(o)}</span>
                  </td>
                  <td className="px-2.5 py-2 font-[family-name:var(--font-mono)] whitespace-nowrap">{yuan(o.total)}</td>
                  <td className="px-2.5 py-2 whitespace-nowrap">
                    <span className={`inline-flex items-center gap-1.5 text-[0.76rem] font-semibold ${orderDotClass(o.status)}`}>
                      <i className="h-1.5 w-1.5 rounded-full" />
                      {orderCompactLabel(o.status)}
                    </span>
                  </td>
                  <td className="px-2.5 py-2 whitespace-nowrap">{shipLabel(o)}</td>
                  <td className="px-2.5 py-2 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      disabled={deletingId === o.id}
                      onClick={() => void handleDeleteOrder(o.id)}
                      className="text-[0.75rem] font-bold text-danger hover:underline disabled:opacity-50"
                    >
                      {deletingId === o.id ? '删除中' : '删除'}
                    </button>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={9} className="px-3 py-10 text-[0.86rem] text-ink-mute">
                  没有符合条件的订单
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {id && active ? (
        <>
          <button type="button" aria-label="关闭详情" className="fixed inset-0 z-[70] bg-[rgba(20,32,28,.2)]" onClick={closeOrder} />
          <aside className="hover-scroll fixed inset-y-0 right-0 z-[71] w-[min(480px,100%)] overflow-y-auto border-l border-[var(--line-strong)] bg-[#f7fbf9] px-4 py-4">
            <AdminOrderDetail
              order={active}
              uploading={uploading}
              recalling={recalling}
              replenishing={replenishing}
              deleting={deletingId === active.id}
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
              onReplenish={handleReplenish}
              onDeleteOrder={() => void handleDeleteOrder(active.id)}
            />
          </aside>
        </>
      ) : null}

      {filterOpen ? (
        <div className="fixed inset-0 z-[80] grid place-items-center bg-[rgba(20,32,28,.46)] p-6" onClick={() => setFilterOpen(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="order-filter-title"
            className="w-[min(720px,100%)] border border-[var(--line-strong)] bg-[#f7fbf9] p-5 shadow-[0_24px_64px_rgba(20,32,28,.22)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[var(--line)] pb-3">
              <h2 id="order-filter-title" className="font-[family-name:var(--font-display)] text-[1.2rem] font-bold tracking-[-0.03em]">
                筛选订单
              </h2>
              <button type="button" aria-label="关闭" className="grid h-8 w-8 place-items-center text-ink-mute" onClick={() => setFilterOpen(false)}>
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-4 grid gap-4">
              <label className="grid gap-1.5">
                <span className="text-[0.76rem] font-bold text-ink-soft">买家、订单号或商品</span>
                <input
                  className="border-b border-[var(--line-strong)] bg-transparent py-2 outline-none focus:border-teal"
                  value={draft.q}
                  onChange={(e) => setDraft((d) => ({ ...d, q: e.target.value }))}
                  placeholder="留空表示全部"
                />
              </label>
              <FilterChecks title="订单状态" options={STATUS_OPTS} selected={draft.statuses} onToggle={(v) => toggleDraft('statuses', v)} />
              <FilterChecks title="发放" options={SHIP_OPTS} selected={draft.ships} onToggle={(v) => toggleDraft('ships', v)} />
              <FilterChecks
                title="类型"
                options={[
                  ['normal', '成品'],
                  ['commission', '约稿'],
                ]}
                selected={draft.modes}
                onToggle={(v) => toggleDraft('modes', v)}
              />
            </div>
            <div className="mt-4 flex justify-end gap-2 border-t border-[var(--line)] pt-3">
              <button
                type="button"
                className="h-[34px] rounded-[10px] border border-[var(--line-strong)] px-3 text-[0.82rem] font-semibold"
                onClick={() =>
                  setDraft({ q: '', statuses: new Set(ALL_STATUS), ships: new Set(ALL_SHIP), modes: new Set(ALL_MODE) })
                }
              >
                恢复默认
              </button>
              <button type="button" className="h-[34px] rounded-[10px] border border-[var(--line-strong)] px-3 text-[0.82rem] font-semibold" onClick={() => setFilterOpen(false)}>
                取消
              </button>
              <button
                type="button"
                className="h-[34px] rounded-[10px] bg-teal px-3 text-[0.82rem] font-bold text-white"
                onClick={() => {
                  if (!draft.statuses.size || !draft.ships.size || !draft.modes.size) {
                    showToast('状态、发放、类型都至少留一项')
                    return
                  }
                  writeParams(draft)
                  setFilterOpen(false)
                }}
              >
                应用
              </button>
            </div>
          </div>
        </div>
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
    </section>
  )
}

function FilterChecks({
  title,
  options,
  selected,
  onToggle,
}: {
  title: string
  options: readonly (readonly [string, string])[]
  selected: Set<string>
  onToggle: (value: string) => void
}) {
  return (
    <div>
      <div className="text-[0.76rem] font-bold text-ink-soft">{title}</div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
        {options.map(([value, label]) => (
          <label key={value} className="inline-flex items-center gap-1.5 text-[0.84rem] font-semibold">
            <input type="checkbox" className="accent-teal" checked={selected.has(value)} onChange={() => onToggle(value)} />
            {label}
          </label>
        ))}
      </div>
    </div>
  )
}
