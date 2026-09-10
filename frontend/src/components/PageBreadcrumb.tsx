import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'

export type BreadcrumbItem = {
  label: string
  to?: string
}

export function PageBreadcrumb({ items, className = 'mb-5' }: { items: BreadcrumbItem[]; className?: string }) {
  return (
    <nav aria-label="面包屑" className={className}>
      <ol className="flex flex-wrap items-center gap-2 text-[0.8rem] text-ink-mute">
        {items.map((item, i) => {
          const last = i === items.length - 1
          return (
            <li key={`${item.label}-${i}`} className="flex min-w-0 items-center gap-2">
              {i > 0 && <ChevronRight className="h-3 w-3 shrink-0 opacity-50" strokeWidth={1.8} aria-hidden />}
              {last || !item.to ? (
                <span className={`truncate ${last ? 'font-semibold text-ink' : ''}`}>{item.label}</span>
              ) : (
                <Link to={item.to} className="truncate transition hover:text-teal">
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
