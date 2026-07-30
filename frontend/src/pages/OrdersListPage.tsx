import { useEffect, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { ApiError, api } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import type { Order } from '../types'

function fmtTime(iso: string) {
  const d = new Date(iso)
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function OrdersListPage() {
  const { user, loading, openAuth } = useAuth()
  const { showToast } = useToast()
  const [orders, setOrders] = useState<Order[]>([])
  const [busy, setBusy] = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    if (loading) return
    if (!user) {
      openAuth('login')
      setBusy(false)
      return
    }
    api
      .get<Order[]>('/api/orders/mine')
      .then(setOrders)
      .catch((e) => showToast(e instanceof ApiError ? e.message : '加载失败'))
      .finally(() => setBusy(false))
  }, [user, loading, openAuth, showToast])

  if (!loading && !user) {
    return <Navigate to="/" replace />
  }

  return (
    <main className="pb-20 pt-8">
      <div className="wrap">
        <div className="mb-6 flex items-center justify-between gap-3">
          <div>
            <h1 className="font-[family-name:var(--font-display)] text-2xl font-extrabold tracking-tight">我的订单</h1>
            <p className="mt-1 text-[0.9rem] text-ink-mute">查看发放内容与下载文件</p>
          </div>
          <Link to="/" className="text-[0.9rem] font-semibold text-teal hover:underline">
            返回商城
          </Link>
        </div>

        {busy ? (
          <div className="py-16 text-center text-ink-mute">加载中…</div>
        ) : !orders.length ? (
          <div className="rounded-[22px] border border-[var(--line)] bg-white/80 px-6 py-16 text-center">
            <p className="mb-4 text-ink-mute">暂无订单</p>
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
                <div className="mb-2 font-semibold text-ink">{o.items.map((i) => i.name).join('、')}</div>
                <div className="flex items-center justify-between">
                  <span className="inline-flex rounded-md bg-[rgba(15,110,92,.12)] px-2 py-1 text-[0.75rem] font-semibold text-teal">
                    已完成
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
