import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ApiError, api } from '../lib/api'
import { getGuestEmail, setGuestEmail } from '../lib/guestEmail'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { orderStatusClass, orderStatusLabel } from '../lib/orderStatus'
import type { Order } from '../types'

function fmtTime(iso: string) {
  const d = new Date(iso)
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function OrdersListPage() {
  const { user, loading } = useAuth()
  const { showToast } = useToast()
  const [orders, setOrders] = useState<Order[]>([])
  const [busy, setBusy] = useState(true)
  const [email, setEmail] = useState(getGuestEmail())
  const [searched, setSearched] = useState(false)
  const navigate = useNavigate()
  const isGuest = !loading && !user

  useEffect(() => {
    if (loading) return
    if (user) {
      setBusy(true)
      api
        .get<Order[]>('/api/orders/mine')
        .then(setOrders)
        .catch((e) => showToast(e instanceof ApiError ? e.message : '加载失败'))
        .finally(() => setBusy(false))
      return
    }
    const saved = getGuestEmail()
    if (!saved) {
      setOrders([])
      setSearched(false)
      setBusy(false)
      return
    }
    setEmail(saved)
    setBusy(true)
    api
      .post<Order[]>('/api/orders/lookup', { email: saved })
      .then((list) => {
        setOrders(list)
        setSearched(true)
      })
      .catch((e) => showToast(e instanceof ApiError ? e.message : '查询失败'))
      .finally(() => setBusy(false))
  }, [user, loading, showToast])

  async function searchByEmail(e: FormEvent) {
    e.preventDefault()
    const value = email.trim()
    if (!value) {
      showToast('请填写购买时使用的邮箱')
      return
    }
    setBusy(true)
    try {
      const list = await api.post<Order[]>('/api/orders/lookup', { email: value })
      setGuestEmail(value)
      setOrders(list)
      setSearched(true)
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : '查询失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="pb-20 pt-8">
      <div className="wrap">
        <div className="mb-6 flex items-center justify-between gap-3">
          <div>
            <h1 className="font-[family-name:var(--font-display)] text-2xl font-extrabold tracking-tight">我的订单</h1>
            <p className="mt-1 text-[0.9rem] text-ink-mute">
              {isGuest ? '输入购买时填写的邮箱即可查找订单' : '查看发放内容与下载文件'}
            </p>
          </div>
          <Link to="/" className="text-[0.9rem] font-semibold text-teal hover:underline">
            返回商城
          </Link>
        </div>

        {isGuest && (
          <form
            onSubmit={searchByEmail}
            className="mb-6 flex flex-col gap-3 rounded-[18px] border border-[var(--line)] bg-white p-4 sm:flex-row sm:items-end"
          >
            <label className="min-w-0 flex-1">
              <span className="mb-1.5 block text-[0.82rem] font-semibold text-ink-soft">购买邮箱</span>
              <input
                className="field-input"
                type="email"
                value={email}
                onChange={(ev) => setEmail(ev.target.value)}
                placeholder="填写下单时使用的邮箱"
                required
              />
            </label>
            <button
              type="submit"
              disabled={busy}
              className="h-11 shrink-0 rounded-xl bg-teal px-5 text-[0.9rem] font-semibold text-white hover:bg-teal-deep disabled:opacity-60"
            >
              {busy ? '查询中…' : '查询订单'}
            </button>
          </form>
        )}

        {busy ? (
          <div className="py-16 text-center text-ink-mute">加载中…</div>
        ) : !orders.length ? (
          <div className="rounded-[22px] border border-[var(--line)] bg-white/80 px-6 py-16 text-center">
            <p className="mb-4 text-ink-mute">
              {isGuest && !searched ? '请先填写购买邮箱查询订单' : '暂无订单'}
            </p>
            <Link to="/#shop" className="font-semibold text-teal hover:underline">
              去选购商品
            </Link>
          </div>
        ) : (
          <div className="grid gap-3">
            {orders.map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => navigate(`/orders/${o.id}`)}
                className="rounded-[18px] border border-[var(--line)] bg-white p-5 text-left transition hover:-translate-y-0.5 hover:border-teal hover:shadow-[0_16px_36px_-28px_rgba(20,32,28,.35)]"
              >
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-[0.82rem] text-ink-mute">
                  <span className="font-[family-name:var(--font-mono)]">{o.id}</span>
                  <span>{fmtTime(o.created_at)}</span>
                </div>
                <div className="mb-2 font-semibold text-ink">
                  {o.sale_mode === 'commission' ? (
                    <span className="mr-2 inline-flex rounded-md bg-[rgba(15,110,92,.1)] px-1.5 py-0.5 text-[0.72rem] font-semibold text-teal">
                      约稿
                    </span>
                  ) : null}
                  {o.items.map((i) => i.name).join('、')}
                </div>
                <div className="flex items-center justify-between">
                  <span className={`inline-flex rounded-md px-2 py-1 text-[0.75rem] font-semibold ${orderStatusClass(o.status)}`}>
                    {orderStatusLabel(o.status)}
                  </span>
                  <strong className="font-[family-name:var(--font-display)] text-lg">¥{o.total}</strong>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
