import { Link } from 'react-router-dom'

export type BreadcrumbItem = {
  label: string
  to?: string
}

export function PageBreadcrumb({ items }: { items: BreadcrumbItem[] }) {
  return (
    <nav aria-label="面包屑" className="mb-6">
      <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[0.88rem]">
        {items.map((item, i) => {
          const last = i === items.length - 1
          return (
            <li key={`${item.label}-${i}`} className="flex min-w-0 items-center gap-1.5">
              {i > 0 && (
                <span className="text-ink-mute/45 select-none" aria-hidden>
                  /
                </span>
              )}
              {last || !item.to ? (
                <span className={`truncate ${last ? 'font-semibold text-ink' : 'text-ink-mute'}`}>
                  {item.label}
                </span>
              ) : (
                <Link to={item.to} className="truncate text-ink-mute transition hover:text-teal">
                  {item.label}
                </Link>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
