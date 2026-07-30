import { useState } from 'react'
import { ApiError, api } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { useCart } from '../context/CartContext'
import { useToast } from '../context/ToastContext'
import type { Delivery, Order } from '../types'

export function CartDrawer() {
  const { items, open, closeCart, removeAt, replaceWithDelivered } = useCart()
  const { user, openAuth, publicSettings } = useAuth()
  const { showToast } = useToast()
  const [loading, setLoading] = useState(false)

  const total = items.reduce((s, it) => s + it.price, 0)
  const allDelivered = items.length > 0 && items.every((it) => it.delivered)
  const pending = items.filter((it) => !it.delivered)

  async function checkout() {
    if (!pending.length) return
    if (!user) {
      closeCart()
      openAuth('login')
      showToast('请先登录后再结算')
      return
    }
    if (publicSettings?.maintain) {
      showToast('站点维护中，暂停下单')
      return
    }
    setLoading(true)
    try {
      const res = await api.post<{ order: Order; deliveries: Delivery[] }>('/api/orders/checkout', {
        items: pending.map((it) => ({ id: it.id, name: it.name, price: it.price })),
      })
      const payloadQueue = [...res.deliveries]
      const next = items.map((it) => {
        if (it.delivered) return it
        const idx = payloadQueue.findIndex((d) => d.product_id === it.id)
        if (idx < 0) return it
        const [hit] = payloadQueue.splice(idx, 1)
        return {
          ...it,
          delivered: true,
          payload: hit.payload,
          file_name: hit.file_name,
          download_url: hit.download_url,
        }
      })
      replaceWithDelivered(next)
      showToast('支付成功 · 卡密 / 下载链接已写入领取匣')
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : '结算失败')
    } finally {
      setLoading(false)
    }
  }

  async function onDownload(url: string, filename?: string | null) {
    try {
      await api.download(url, filename || undefined)
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : '下载失败')
    }
  }

  return (
    <>
      <div
        className={`fixed inset-0 z-50 bg-[rgba(20,32,28,0.35)] transition-opacity ${
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
        onClick={closeCart}
      />
      <aside
        className={`fixed top-0 right-0 z-50 flex h-full w-[min(400px,100%)] flex-col border-l border-[var(--line)] bg-fog shadow-[-20px_0_50px_-30px_rgba(20,32,28,.4)] transition-transform duration-300 ${
          open ? 'translate-x-0' : 'pointer-events-none translate-x-full'
        }`}
        aria-hidden={!open}
        aria-label="购物车"
      >
        <div className="flex items-center justify-between border-b border-[var(--line)] px-5 py-4">
          <h3 className="font-[family-name:var(--font-display)] text-lg font-bold">你的领取匣</h3>
          <button
            type="button"
            onClick={closeCart}
            className="grid h-9 w-9 place-items-center rounded-[10px] border border-[var(--line)] bg-white text-ink-soft hover:border-teal hover:text-teal"
            aria-label="关闭"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M2 2l10 10M12 2L2 12" />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {!items.length ? (
            <div className="px-2 py-16 text-center text-ink-mute leading-relaxed">
              领取匣还是空的。
              <br />
              去选一件虚拟商品吧。
            </div>
          ) : (
            <div className="grid gap-3">
              {items.map((item, i) => (
                <div key={`${item.id}-${i}`} className="rounded-[14px] border border-[var(--line)] bg-white p-3.5">
                  <div className="flex items-start justify-between gap-2">
                    <strong className="text-[0.95rem]">{item.name}</strong>
                    <div className="font-semibold text-teal">¥{item.price}</div>
                  </div>
                  <div className="mt-1.5 break-all font-[family-name:var(--font-mono)] text-[0.78rem] text-ink-mute">
                    {item.delivered ? item.payload : '待支付后自动发货'}
                  </div>
                  <div className="mt-2 flex gap-3">
                    {item.delivered && item.download_url && (
                      <button
                        type="button"
                        className="text-[0.82rem] font-semibold text-teal hover:underline"
                        onClick={() => onDownload(item.download_url!, item.file_name || item.payload)}
                      >
                        下载文件
                      </button>
                    )}
                    {!item.delivered && (
                      <button type="button" className="text-[0.82rem] text-danger hover:underline" onClick={() => removeAt(i)}>
                        移除
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="border-t border-[var(--line)] bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-ink-soft">合计</span>
            <strong className="font-[family-name:var(--font-display)] text-xl">¥{total}</strong>
          </div>
          <button
            type="button"
            disabled={!items.length || allDelivered || loading}
            onClick={checkout}
            className="h-12 w-full rounded-xl bg-teal text-[0.95rem] font-semibold text-white transition hover:bg-teal-deep disabled:cursor-not-allowed disabled:opacity-60"
          >
            {allDelivered ? '已全部发货' : loading ? '处理中…' : '模拟支付并自动发货'}
          </button>
        </div>
      </aside>
    </>
  )
}
