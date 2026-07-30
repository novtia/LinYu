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
    <label className="grid grid-rows-[auto_auto_1.1em] gap-1.5 content-start">
      <span className="text-[0.82rem] font-semibold text-ink-soft">{label}</span>
      <input
        type={type}
        autoComplete={autoComplete}
        className="box-border h-11 w-full rounded-xl border border-[var(--line-strong)] bg-white px-3.5 outline-none focus:border-teal"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      <span className="text-[0.75rem] leading-[1.1em] text-ink-mute">{hint || '\u00a0'}</span>
    </label>
  )
}
