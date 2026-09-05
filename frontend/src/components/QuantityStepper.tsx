const MAX_QTY = 99

export function clampCartQty(n: number) {
  const q = Math.floor(Number(n) || 0)
  return Math.min(MAX_QTY, Math.max(1, q))
}

export function QuantityStepper({
  value,
  onChange,
  min = 1,
  max = MAX_QTY,
  size = 'md',
  disabled,
  label = '购买数量',
}: {
  value: number
  onChange: (next: number) => void
  min?: number
  max?: number
  size?: 'sm' | 'md'
  disabled?: boolean
  label?: string
}) {
  const compact = size === 'sm'
  const btn = compact ? 'h-7 w-7 text-[1.05rem]' : 'h-10 w-10 text-[1.2rem]'
  const num = compact ? 'h-7 min-w-8 text-[0.82rem]' : 'h-10 min-w-11 text-[0.95rem]'

  return (
    <div
      className={`inline-flex items-center overflow-hidden rounded-xl border border-[var(--line-strong)] bg-white ${
        disabled ? 'opacity-50' : ''
      }`}
      role="group"
      aria-label={label}
    >
      <button
        type="button"
        className={`${btn} font-semibold text-ink-soft hover:bg-paper hover:text-ink disabled:cursor-not-allowed disabled:opacity-40`}
        disabled={disabled || value <= min}
        aria-label="减少数量"
        onClick={() => onChange(Math.max(min, value - 1))}
      >
        −
      </button>
      <span className={`${num} grid place-items-center border-x border-[var(--line)] font-semibold tabular-nums text-ink`}>
        {value}
      </span>
      <button
        type="button"
        className={`${btn} font-semibold text-ink-soft hover:bg-paper hover:text-ink disabled:cursor-not-allowed disabled:opacity-40`}
        disabled={disabled || value >= max}
        aria-label="增加数量"
        onClick={() => onChange(Math.min(max, value + 1))}
      >
        +
      </button>
    </div>
  )
}
