import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'

export type PurchaseResultStatus = 'success' | 'failure'

export interface PurchaseResult {
  status: PurchaseResultStatus
  /** 副文案，如渠道名、错误信息 */
  message?: string
  /** 成功时跳转订单详情；失败时可省略 */
  orderId?: string
}

interface PurchaseResultContextValue {
  showPurchaseResult: (result: PurchaseResult) => void
  closePurchaseResult: () => void
}

const PurchaseResultContext = createContext<PurchaseResultContextValue | null>(null)

function PurchaseResultModal({
  result,
  onClose,
}: {
  result: PurchaseResult
  onClose: () => void
}) {
  const ok = result.status === 'success'
  const orderHref = result.orderId ? `/orders/${result.orderId}` : '/orders'

  return createPortal(
    <div
      className="fixed inset-0 z-[90] flex h-[100dvh] w-screen items-center justify-center bg-[rgba(20,32,28,0.55)] p-5"
      role="dialog"
      aria-modal="true"
      aria-labelledby="purchase-result-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="relative w-[min(400px,100%)] overflow-hidden rounded-[22px] border border-[var(--line)] bg-white shadow-[0_28px_60px_-28px_rgba(20,32,28,.55)]">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 grid h-9 w-9 place-items-center rounded-[10px] border border-[var(--line)] bg-paper text-ink-soft hover:text-ink"
          aria-label="关闭"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M2 2l10 10M12 2L2 12" />
          </svg>
        </button>

        <div className="flex flex-col items-center px-6 pb-2 pt-8 text-center">
          <div
            className={`grid h-14 w-14 place-items-center rounded-full ${
              ok ? 'bg-[rgba(15,110,92,.12)] text-teal' : 'bg-[rgba(180,35,24,.1)] text-danger'
            }`}
            aria-hidden
          >
            {ok ? (
              <svg width="26" height="26" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M4 11.5l4.5 4.5L18 6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : (
              <svg width="22" height="22" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.2">
                <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
              </svg>
            )}
          </div>

          <h2
            id="purchase-result-title"
            className="mt-5 font-[family-name:var(--font-display)] text-[1.35rem] font-extrabold tracking-tight text-ink"
          >
            {ok ? '购买成功' : '购买失败'}
          </h2>
          <p className="mt-2 max-w-[18rem] text-[0.92rem] leading-relaxed text-ink-soft">
            {result.message || (ok ? '订单已生成，商品将自动发货。' : '本次购买未完成，请稍后重试。')}
          </p>
        </div>

        <div className="mt-5 border-t border-[var(--line)] px-5 py-4">
          {ok && result.orderId ? (
            <Link
              to={orderHref}
              onClick={onClose}
              className="flex h-12 w-full items-center justify-center rounded-xl bg-teal text-[0.95rem] font-semibold text-white hover:bg-teal-deep"
            >
              查看订单详情
            </Link>
          ) : (
            <div className="grid gap-2.5">
              <Link
                to="/orders"
                onClick={onClose}
                className="flex h-12 w-full items-center justify-center rounded-xl bg-teal text-[0.95rem] font-semibold text-white hover:bg-teal-deep"
              >
                前往我的订单
              </Link>
              <button
                type="button"
                onClick={onClose}
                className="h-11 w-full rounded-xl border border-[var(--line-strong)] bg-white text-[0.9rem] font-semibold text-ink hover:border-teal hover:text-teal"
              >
                关闭
              </button>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}

export function PurchaseResultProvider({ children }: { children: ReactNode }) {
  const [result, setResult] = useState<PurchaseResult | null>(null)

  const showPurchaseResult = useCallback((next: PurchaseResult) => {
    setResult(next)
  }, [])

  const closePurchaseResult = useCallback(() => {
    setResult(null)
  }, [])

  const value = useMemo(
    () => ({ showPurchaseResult, closePurchaseResult }),
    [showPurchaseResult, closePurchaseResult],
  )

  return (
    <PurchaseResultContext.Provider value={value}>
      {children}
      {result && <PurchaseResultModal result={result} onClose={closePurchaseResult} />}
    </PurchaseResultContext.Provider>
  )
}

export function usePurchaseResult() {
  const ctx = useContext(PurchaseResultContext)
  if (!ctx) throw new Error('usePurchaseResult must be used within PurchaseResultProvider')
  return ctx
}
