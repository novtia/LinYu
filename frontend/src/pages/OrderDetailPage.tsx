import { useEffect, useRef, useState } from 'react'
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ApiError, api } from '../lib/api'
import { orderStatusClass, orderStatusLabel } from '../lib/orderStatus'
import { useAuth } from '../context/AuthContext'
import { usePurchaseResult } from '../context/PurchaseResultContext'
import { useToast } from '../context/ToastContext'
import type { Order } from '../types'

function fmtTime(iso: string) {
  const d = new Date(iso)
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function OrderDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const fromPay = searchParams.get('pay') === '1'
  const { user, loading, openAuth } = useAuth()
  const { showToast } = useToast()
  const { showPurchaseResult } = usePurchaseResult()
  const [order, setOrder] = useState<Order | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(true)
  const navigate = useNavigate()
  const resultShown = useRef(false)

  useEffect(() => {
    if (loading) return
    if (!user) {
      openAuth('login')
      setBusy(false)
      return
    }
    if (!id) return
    let alive = true
    api
      .get<Order>(`/api/orders/${id}`)
      .then((o) => {
        if (alive) setOrder(o)
      })
      .catch((e) => {
        if (alive) setError(e instanceof ApiError ? e.message : '加载失败')
      })
      .finally(() => {
        if (alive) setBusy(false)
      })
    return () => {
      alive = false
    }
  }, [id, user, loading, openAuth])

  // 支付回跳：轮询直到完成或超时
  useEffect(() => {
    if (!fromPay || !id || !user || !order) return
    if (order.status === 'completed' || order.status === 'paid') {
      if (!resultShown.current) {
        resultShown.current = true
        showPurchaseResult({
          status: 'success',
          orderId: order.id,
          message: '支付成功，商品已自动发货，可在下方查看发放内容。',
        })
        setSearchParams({}, { replace: true })
      }
      return
    }
    if (order.status === 'failed' || order.status === 'cancelled') {
      if (!resultShown.current) {
        resultShown.current = true
        showPurchaseResult({
          status: 'failure',
          orderId: order.id,
          message: '支付未完成，请重新下单或联系客服。',
        })
        setSearchParams({}, { replace: true })
      }
      return
    }

    let tries = 0
    const timer = window.setInterval(async () => {
      tries += 1
      try {
        const next = await api.get<Order>(`/api/orders/${id}`)
        setOrder(next)
        if (next.status === 'completed' || next.status === 'paid') {
          window.clearInterval(timer)
          if (!resultShown.current) {
            resultShown.current = true
            showPurchaseResult({
              status: 'success',
              orderId: next.id,
              message: '支付成功，商品已自动发货，可在下方查看发放内容。',
            })
            setSearchParams({}, { replace: true })
          }
        } else if (tries >= 20) {
          window.clearInterval(timer)
          if (!resultShown.current) {
            resultShown.current = true
            showPurchaseResult({
              status: 'failure',
              orderId: next.id,
              message: '暂未确认支付结果，请稍后刷新订单页，或确认是否已完成付款。',
            })
            setSearchParams({}, { replace: true })
          }
        }
      } catch {
        /* ignore transient errors while polling */
      }
    }, 2000)

    return () => window.clearInterval(timer)
  }, [fromPay, id, user, order, showPurchaseResult, setSearchParams])

  if (!loading && !user) return <Navigate to="/" replace />

  if (busy) return <div className="wrap py-20 text-center text-ink-mute">加载中…</div>

  if (error || !order) {
    return (
      <div className="wrap py-20 text-center">
        <p className="mb-4 text-ink-mute">{error || '订单不存在'}</p>
        <Link to="/orders" className="font-semibold text-teal hover:underline">
          返回订单列表
        </Link>
      </div>
    )
  }

  const delivered = order.status === 'completed' || order.status === 'paid'
  const waitingPay = order.status === 'pending'

  return (
    <main className="pb-20 pt-8">
      <div className="wrap max-w-3xl">
        <button type="button" onClick={() => navigate('/orders')} className="mb-6 text-[0.9rem] text-ink-soft hover:text-teal">
          ← 我的订单
        </button>

        <div className="mb-6 rounded-[22px] border border-[var(--line)] bg-white p-6">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="font-[family-name:var(--font-display)] text-2xl font-extrabold tracking-tight">订单详情</h1>
              <p className="mt-1 font-[family-name:var(--font-mono)] text-[0.85rem] text-ink-mute">{order.id}</p>
            </div>
            <span className={`inline-flex rounded-md px-2.5 py-1 text-[0.78rem] font-semibold ${orderStatusClass(order.status)}`}>
              {orderStatusLabel(order.status)}
            </span>
          </div>
          <div className="grid gap-3 text-[0.92rem] sm:grid-cols-3">
            <Meta label="下单时间" value={fmtTime(order.created_at)} />
            <Meta label="买家" value={order.username} />
            <Meta label="合计" value={`¥${order.total}`} />
          </div>
          {waitingPay && (
            <p className="mt-4 rounded-xl bg-[rgba(196,165,116,.16)] px-3.5 py-3 text-[0.86rem] text-[#8a6a2f]">
              订单待支付。若你已完成付款，请稍候刷新本页；支付结果确认后将自动发货。
            </p>
          )}
        </div>

        <div className="overflow-hidden rounded-[22px] border border-[var(--line)] bg-white">
          <div className="border-b border-[var(--line)] px-5 py-4">
            <h2 className="font-[family-name:var(--font-display)] text-lg font-bold">发放内容</h2>
          </div>
          <div className="divide-y divide-[var(--line)]">
            {order.items.map((it, i) => (
              <div key={i} className="px-5 py-4">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <strong className="text-[0.98rem]">{it.name}</strong>
                  <span className="font-semibold text-teal">¥{it.price}</span>
                </div>
                {!delivered ? (
                  <div className="rounded-xl bg-paper px-3.5 py-3 text-[0.86rem] text-ink-mute">
                    {waitingPay ? '支付成功后自动发放' : '尚未发放'}
                  </div>
                ) : (
                  <div className="flex items-center gap-3 rounded-xl bg-paper px-3.5 py-3">
                    <div
                      className={`min-w-0 flex-1 font-[family-name:var(--font-mono)] text-[0.82rem] text-ink ${
                        it.download_url ? 'truncate' : 'break-all'
                      }`}
                    >
                      {it.download_url ? it.file_name || it.payload || '已购文件' : it.payload || '未发放'}
                    </div>
                    {it.download_url ? (
                      <button
                        type="button"
                        className="shrink-0 text-[0.82rem] font-semibold text-teal hover:underline"
                        onClick={async () => {
                          try {
                            await api.download(it.download_url!, it.file_name || it.payload || undefined)
                          } catch (e) {
                            showToast(e instanceof ApiError ? e.message : '下载失败')
                          }
                        }}
                      >
                        下载文件
                      </button>
                    ) : it.payload ? (
                      <button
                        type="button"
                        className="shrink-0 text-[0.82rem] font-semibold text-teal hover:underline"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(it.payload || '')
                            showToast('已复制到剪贴板')
                          } catch {
                            showToast('复制失败')
                          }
                        }}
                      >
                        复制
                      </button>
                    ) : null}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  )
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-paper px-3.5 py-3">
      <div className="mb-1 text-[0.75rem] text-ink-mute">{label}</div>
      <div className="font-semibold">{value}</div>
    </div>
  )
}
