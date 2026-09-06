import { useEffect, useState } from 'react'
import { fetchPublicPaymentMethods } from '../lib/payment'
import type { PublicPaymentMethod } from '../types'

type PaymentMethodPickerProps = {
  value: string | null
  onChange: (method: PublicPaymentMethod | null) => void
  onAvailabilityChange?: (available: boolean) => void
  className?: string
}

function MethodMark({ method }: { method: string }) {
  if (method === 'alipay') {
    return (
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-[6px] bg-[#1677FF] text-[0.72rem] font-extrabold leading-none text-white">
        支
      </span>
    )
  }
  if (method === 'wxpay') {
    return (
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-[6px] bg-[#07C160] text-white">
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor" aria-hidden>
          <path d="M9.5 8.2c.4-3.1 3.6-5.4 7.3-5.2 3.9.2 6.8 2.9 6.7 6.2 0 2.3-1.5 4.3-3.7 5.3l.6 2.2-2.5-1.3c-.7.1-1.4.2-2.1.2-3.6 0-6.5-2.3-6.6-5.2.1-.7.2-1.4.3-2.2zm-7.1 8c0-2.7 2.5-5 5.8-5.2.3 1.8 1.4 3.3 3 4.3-.3 2.6-3.1 4.6-6.4 4.6-.6 0-1.2 0-1.8-.1L1 21.1l.6-2.1C1.4 18 1.4 16.8 2.4 16.2z" />
        </svg>
      </span>
    )
  }
  if (method === 'qqpay') {
    return (
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-[6px] bg-[#12B7F5] text-[0.7rem] font-extrabold text-white">
        Q
      </span>
    )
  }
  return (
    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-[6px] bg-teal text-[0.7rem] font-extrabold text-white">
      付
    </span>
  )
}

function methodTone(method: string) {
  if (method === 'alipay') return 'border-[#1677FF] bg-[rgba(22,119,255,.08)] text-[#0B4FBF]'
  if (method === 'wxpay') return 'border-[#07C160] bg-[rgba(7,193,96,.08)] text-[#057A3D]'
  if (method === 'qqpay') return 'border-[#12B7F5] bg-[rgba(18,183,245,.1)] text-[#0A7EAB]'
  return 'border-teal bg-[rgba(15,110,92,.08)] text-teal-deep'
}

export function PaymentMethodPicker({
  value,
  onChange,
  onAvailabilityChange,
  className = '',
}: PaymentMethodPickerProps) {
  const [methods, setMethods] = useState<PublicPaymentMethod[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    setLoading(true)
    fetchPublicPaymentMethods()
      .then((res) => {
        if (!alive) return
        const list = res.methods || []
        setMethods(list)
        setError('')
        onAvailabilityChange?.(list.length > 0)
        if (!list.length) {
          onChange(null)
          return
        }
        const current = list.find((m) => m.id === value) || list[0]
        onChange(current)
      })
      .catch(() => {
        if (!alive) return
        setMethods([])
        setError('支付方式加载失败')
        onAvailabilityChange?.(false)
        onChange(null)
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (loading) {
    return <p className={`text-[0.82rem] text-ink-mute ${className}`}>正在加载支付方式…</p>
  }

  if (error) {
    return <p className={`text-[0.82rem] text-danger ${className}`}>{error}</p>
  }

  if (!methods.length) {
    return <p className={`text-[0.82rem] text-ink-mute ${className}`}>暂无可用支付方式</p>
  }

  const showChannel = methods.length > 1 && new Set(methods.map((m) => m.method)).size < methods.length

  return (
    <div className={className}>
      <div className="mb-2 text-[0.72rem] tracking-[0.06em] text-ink-mute">支付方式</div>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="支付方式">
        {methods.map((m) => {
          const active = value === m.id
          return (
            <button
              key={m.id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(m)}
              className={`inline-flex h-11 min-w-[7.5rem] items-center gap-2 rounded-xl border px-3 text-left transition ${
                active
                  ? methodTone(m.method)
                  : 'border-[var(--line)] bg-white text-ink hover:border-[var(--line-strong)]'
              }`}
            >
              <MethodMark method={m.method} />
              <span className="min-w-0">
                <span className="block text-[0.88rem] font-bold leading-none">{m.label}</span>
                {showChannel ? (
                  <span className={`mt-1 block truncate text-[0.68rem] ${active ? 'opacity-80' : 'text-ink-mute'}`}>
                    {m.channel_name}
                  </span>
                ) : null}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
