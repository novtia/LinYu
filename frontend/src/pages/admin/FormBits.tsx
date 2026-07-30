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
    <div className="flex items-center justify-between border-b border-[var(--line)] px-[18px] py-3.5">
      <div>
        <strong className="mb-0.5 block text-[0.95rem]">{title}</strong>
        <span className="text-[0.82rem] text-ink-mute">{desc}</span>
      </div>
      <button type="button" className={`switch ${on ? 'on' : ''}`} onClick={onToggle} aria-label={title} />
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
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  type?: string
  hint?: string
}) {
  return (
    <label className="grid gap-1.5">
      <span className="text-[0.82rem] font-semibold text-ink-soft">{label}</span>
      <input
        type={type}
        className="h-11 rounded-xl border border-[var(--line-strong)] bg-white px-3.5"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint ? <span className="text-[0.75rem] text-ink-mute">{hint}</span> : null}
    </label>
  )
}
