export function SwitchRow({
  title,
  desc,
  on,
  onToggle,
}: {
  title: string
  desc: string
  on: boolean
  onToggle: () => void
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-[var(--line)] py-3">
      <div className="min-w-0">
        <span className="text-[0.86rem]">{title}</span>
        {desc ? <span className="mt-0.5 block text-[0.75rem] text-ink-mute">{desc}</span> : null}
      </div>
      <button type="button" className={`switch shrink-0 ${on ? 'on' : ''}`} onClick={onToggle} aria-label={title} />
    </div>
  )
}

export function Field({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  hint,
  autoComplete,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  type?: string
  hint?: string
  autoComplete?: string
}) {
  return (
    <label className="grid gap-1.5 content-start">
      <span className="text-[0.76rem] font-bold text-ink-soft">{label}</span>
      <input
        type={type}
        autoComplete={autoComplete}
        className="w-full border-0 border-b border-[var(--line-strong)] bg-transparent py-2 outline-none focus:border-teal"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint ? <span className="text-[0.72rem] leading-relaxed text-ink-mute">{hint}</span> : null}
    </label>
  )
}
