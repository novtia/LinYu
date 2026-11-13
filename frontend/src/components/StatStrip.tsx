import { Link } from 'react-router-dom'

export function StatStrip({
  items,
}: {
  items: { label: string; value: string; hint?: string; to?: string }[]
}) {
  return (
    <dl className="mb-4 grid grid-cols-2 border-y border-[var(--line)] md:grid-cols-4">
      {items.map((it) => {
        const body = (
          <>
            <dt className="text-[0.72rem] text-ink-mute">{it.label}</dt>
            <dd className="mt-1 font-[family-name:var(--font-display)] text-[1.35rem] leading-none font-extrabold tracking-[-0.04em]">{it.value}</dd>
            {it.hint ? <p className="mt-1 text-[0.72rem] text-ink-mute">{it.hint}</p> : null}
          </>
        )
        return (
          <div key={it.label} className="px-3 py-3 md:px-4">
            {it.to ? (
              <Link to={it.to} className="block hover:text-teal">
                {body}
              </Link>
            ) : (
              body
            )}
          </div>
        )
      })}
    </dl>
  )
}
