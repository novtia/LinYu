import { useEffect, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { ApiError, api } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import type { Order } from '../types'

function fmtTime(iso: string) {
  const d = new Date(iso)
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function OrderDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { user, loading, openAuth } = useAuth()
  const { showToast } = useToast()
  const [order, setOrder] = useState<Order | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    if (loading) return
    if (!user) {
      openAuth('login')
      setBusy(false)
      return
    }
    if (!id) return
    api
      .get<Order>(`/api/orders/${id}`)
      .then(setOrder)
      .catch((e) => setError(e instanceof ApiError ? e.message : '加载失败'))
      .finally(() => setBusy(false))
  }, [id, user, loading, openAuth])

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
            <span className="inline-flex rounded-md bg-[rgba(15,110,92,.12)] px-2.5 py-1 text-[0.78rem] font-semibold text-teal">
              已完成
            </span>
          </div>
          <div className="grid gap-3 text-[0.92rem] sm:grid-cols-3">
            <Meta label="下单时间" value={fmtTime(order.created_at)} />
            <Meta label="买家" value={order.username} />
            <Meta label="合计" value={`¥${order.total}`} />
          </div>
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
                <div className="break-all rounded-xl bg-paper px-3.5 py-3 font-[family-name:var(--font-mono)] text-[0.82rem] text-ink">
                  {it.payload || '未发放'}
                </div>
                <div className="mt-3 flex flex-wrap gap-3">
                  {it.payload && !it.download_url && (
                    <button
                      type="button"
                      className="text-[0.82rem] font-semibold text-teal hover:underline"
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
                  )}
                  {it.download_url && (
                    <button
                      type="button"
                      className="text-[0.82rem] font-semibold text-teal hover:underline"
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
                  )}
                </div>
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
