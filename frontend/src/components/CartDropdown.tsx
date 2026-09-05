import { useNavigate } from 'react-router-dom'
import { ApiError, api } from '../lib/api'
import { cartLineQty, cartLineTotal, useCart } from '../context/CartContext'
import { useToast } from '../context/ToastContext'
import { QuantityStepper } from './QuantityStepper'

/** 购物车下拉：扁平列表，结算跳转独立页面 */
export function CartDropdown() {
  const { items, count, open, closeCart, removeAt, setQuantity } = useCart()
  const { showToast } = useToast()
  const navigate = useNavigate()

  const pending = items.filter((it) => !it.delivered)
  const total = pending.reduce((s, it) => s + cartLineTotal(it), 0)

  if (!open) return null

  function goCheckout() {
    if (!pending.length) {
      showToast('购物车暂无待结算商品')
      return
    }
    closeCart()
    navigate('/checkout')
  }

  async function onDownload(url: string, filename?: string | null) {
    try {
      await api.download(url, filename || undefined)
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : '下载失败')
    }
  }

  return (
    <div
      role="dialog"
      aria-label="购物车"
      onClick={(e) => e.stopPropagation()}
      className="absolute top-[calc(100%+10px)] left-1/2 z-50 w-[min(360px,calc(100vw-32px))] -translate-x-1/2 rounded-[16px] border border-[var(--line)] bg-white p-4 shadow-[0_22px_48px_-28px_rgba(20,32,28,.45)]"
    >
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="font-[family-name:var(--font-display)] text-[1.05rem] font-bold tracking-tight">
          购物车
          <span className="ml-2 text-[0.78rem] font-medium text-ink-mute">{count}</span>
        </h3>
        <button type="button" onClick={closeCart} className="text-[0.82rem] font-semibold text-ink-mute hover:text-ink">
          关闭
        </button>
      </div>

      {!items.length ? (
        <p className="py-6 text-[0.88rem] leading-relaxed text-ink-mute">购物车还是空的，去选一件虚拟商品吧。</p>
      ) : (
        <ul className="max-h-[min(46vh,360px)] space-y-0 overflow-y-auto">
          {items.map((item, i) => (
            <li key={`${item.id}-${i}`} className="flex items-start justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[0.9rem] font-medium text-ink">{item.name}</div>
                <div className="mt-0.5 text-[0.75rem] text-ink-mute">
                  {item.delivered ? '已发货' : item.payment ? `${item.payment.label}` : '待结算'}
                  {!item.delivered && cartLineQty(item) > 1 ? ` · ¥${item.price} / 件` : ''}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2.5">
                  {item.delivered && item.download_url && (
                    <button
                      type="button"
                      className="text-[0.75rem] font-semibold text-teal hover:underline"
                      onClick={() => onDownload(item.download_url!, item.file_name || item.payload)}
                    >
                      下载
                    </button>
                  )}
                  {!item.delivered && (
                    <>
                      <QuantityStepper size="sm" value={cartLineQty(item)} onChange={(qty) => setQuantity(i, qty)} />
                      <button type="button" className="text-[0.75rem] text-danger hover:underline" onClick={() => removeAt(i)}>
                        移除
                      </button>
                    </>
                  )}
                </div>
              </div>
              <div className="shrink-0 pt-0.5 text-[0.9rem] font-semibold text-ink">¥{cartLineTotal(item)}</div>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[0.72rem] text-ink-mute">待结算</div>
          <div className="font-[family-name:var(--font-display)] text-[1.15rem] font-bold tracking-tight">¥{total}</div>
        </div>
        <button
          type="button"
          disabled={!pending.length}
          onClick={goCheckout}
          className="h-10 shrink-0 rounded-xl bg-teal px-4 text-[0.88rem] font-semibold text-white hover:bg-teal-deep disabled:cursor-not-allowed disabled:opacity-50"
        >
          去结算
        </button>
      </div>
    </div>
  )
}
