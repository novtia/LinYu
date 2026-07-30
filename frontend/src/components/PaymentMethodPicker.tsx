import { useEffect, useState } from 'react'
import { fetchPublicPaymentMethods } from '../lib/payment'
import type { PublicPaymentMethod } from '../types'

type PaymentMethodPickerProps = {
  value: string | null
  onChange: (method: PublicPaymentMethod | null) => void
  /** 是否存在可选购买渠道（加载完成后回调） */
  onAvailabilityChange?: (available: boolean) => void
  className?: string
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
        setError('支付渠道加载失败')
        onAvailabilityChange?.(false)
        onChange(null)
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (loading) {
    return (
      <div className={`rounded-2xl border border-[var(--line)] bg-paper/60 px-4 py-4 text-[0.86rem] text-ink-mute ${className}`}>
        正在加载购买渠道…
      </div>
    )
  }

  if (error) {
    return (
      <div
        className={`rounded-2xl border border-[rgba(180,35,24,.18)] bg-[rgba(180,35,24,.05)] px-4 py-4 text-[0.86rem] text-danger ${className}`}
      >
        {error}
      </div>
    )
  }

  if (!methods.length) {
    return (
      <div
        className={`rounded-2xl border border-dashed border-[var(--line-strong)] bg-white/70 px-4 py-4 text-[0.86rem] text-ink-mute ${className}`}
      >
        暂无可用购买渠道。请先在控制台启用并配置支付接入。
      </div>
    )
  }

  return (
    <fieldset className={className}>
      <legend className="mb-2.5 text-[0.82rem] font-semibold tracking-wide text-ink-soft">选择购买渠道</legend>
      <div className="grid gap-2" role="radiogroup" aria-label="购买渠道">
        {methods.map((m) => {
          const active = value === m.id
          return (
            <label
              key={m.id}
              className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3.5 py-3 transition ${
                active
                  ? 'border-teal bg-[rgba(15,110,92,.06)] shadow-[0_10px_24px_-20px_rgba(15,110,92,.7)]'
                  : 'border-[var(--line)] bg-white hover:border-[var(--line-strong)]'
              }`}
            >
              <input
                type="radio"
                name="payment-method"
                className="mt-1 accent-teal"
                checked={active}
                onChange={() => onChange(m)}
              />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <strong className="text-[0.92rem] text-ink">{m.label}</strong>
                  <span className="rounded-md bg-paper px-1.5 py-0.5 text-[0.7rem] font-semibold text-ink-mute">
                    {m.provider_name}
                  </span>
                </span>
                <span className="mt-0.5 block truncate text-[0.78rem] text-ink-mute">{m.channel_name}</span>
              </span>
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}
