import { Link } from 'react-router-dom'

export type DeliveryUnlock = {
  unlocked: boolean
  orderId?: string | null
}

type ProductDeliveryPanelProps = {
  unlock: DeliveryUnlock
  className?: string
}

export function ProductDeliveryPanel({ unlock, className = '' }: ProductDeliveryPanelProps) {
  if (unlock.unlocked) {
    const href = unlock.orderId ? `/orders/${unlock.orderId}` : '/orders'

    return (
      <div className={`rounded-2xl border border-teal/25 bg-[rgba(15,110,92,.05)] p-4 ${className}`}>
        <div className="mb-3 flex items-center justify-between gap-2">
          <div>
            <div className="text-[0.78rem] font-semibold tracking-wide text-teal">已解锁</div>
            <strong className="text-[0.95rem]">发货内容</strong>
          </div>
          <span className="grid h-9 w-9 place-items-center rounded-full bg-teal text-white" aria-hidden>
            <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current stroke-[2]">
              <rect x="5" y="11" width="14" height="10" rx="2" />
              <path d="M8 11V8a4 4 0 0 1 8 0" />
            </svg>
          </span>
        </div>

        <p className="mb-3 text-[0.84rem] leading-relaxed text-ink-soft">
          发货内容已写入订单，可前往订单详情查看与复制。
        </p>
        <Link
          to={href}
          className="grid h-11 w-full place-items-center rounded-xl bg-teal text-[0.9rem] font-semibold text-white hover:bg-teal-deep"
        >
          查看订单详情
        </Link>
      </div>
    )
  }

  return (
    <div className={`rounded-2xl border border-[var(--line)] bg-fog/80 p-4 ${className}`}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <div className="text-[0.78rem] font-semibold tracking-wide text-ink-mute">未解锁</div>
          <strong className="text-[0.95rem]">发货内容</strong>
        </div>
        <span
          className="grid h-9 w-9 place-items-center rounded-full border border-[var(--line-strong)] bg-white text-ink-mute"
          aria-hidden
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current stroke-[2]">
            <rect x="5" y="11" width="14" height="10" rx="2" />
            <path d="M8 11V7a4 4 0 0 1 8 0v4" />
          </svg>
        </span>
      </div>

      <div className="relative overflow-hidden rounded-xl border border-[var(--line)] bg-white px-3 py-3">
        <div className="select-none blur-[5px] font-[family-name:var(--font-mono)] text-[0.84rem] text-ink-mute">
          购买后即可查看完整发货内容
        </div>
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-white/55 text-[0.82rem] font-semibold text-ink-soft">
          购买后解锁
        </div>
      </div>

      <button
        type="button"
        disabled
        className="mt-3 h-11 w-full cursor-not-allowed rounded-xl border border-[var(--line-strong)] bg-paper text-[0.9rem] font-semibold text-ink-mute"
      >
        查看内容
      </button>
    </div>
  )
}
