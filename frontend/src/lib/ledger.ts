import type { Analytics, LedgerRow } from '../types'

export function yuanText(n: number) {
  const v = Math.round(Number(n) * 100) / 100
  const int = Math.trunc(v)
  const frac = Math.round((v - int) * 100)
  return frac ? `¥${int.toLocaleString('zh-CN')}.${String(frac).padStart(2, '0')}` : `¥${int.toLocaleString('zh-CN')}`
}

export function shanghaiDay(iso: string) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso))
}

export function shanghaiHour(iso: string) {
  const h = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', hour: '2-digit', hourCycle: 'h23' }).format(new Date(iso))
  const n = Number(String(h).replace(/\D/g, ''))
  return Number.isFinite(n) ? Math.min(23, Math.max(0, n)) : 0
}

export function parseDay(key: string) {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1)
}

export function addDays(d: Date, n: number) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  x.setDate(x.getDate() + n)
  return x
}

export function isoDay(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export type LedgerFilter = {
  from: string
  to: string
  min: number | null
  max: number | null
  q: string
  kinds: Set<string>
  channels: Set<string>
  states: Set<string>
}

export function matchRow(row: LedgerRow, f: LedgerFilter) {
  const day = shanghaiDay(row.at)
  if (day < f.from || day > f.to) return false
  if (f.min != null && row.amount < f.min) return false
  if (f.max != null && row.amount > f.max) return false
  if (!f.kinds.has(row.kind)) return false
  if (f.channels.size && !f.channels.has(row.channel)) return false
  if (row.ok && !f.states.has('ok')) return false
  if (!row.ok && !f.states.has('fail')) return false
  if (f.q) {
    const hay = [row.buyer, row.item, row.order_id, row.channel].join(' ').toLowerCase()
    if (!hay.includes(f.q)) return false
  }
  return true
}

export function daysBetween(from: string, to: string) {
  const a = parseDay(from).getTime()
  const b = parseDay(to).getTime()
  return Math.round((b - a) / 86400000) + 1
}

export function eachDay(from: string, to: string) {
  const out: string[] = []
  let d = parseDay(from)
  const end = parseDay(to)
  while (d <= end) {
    out.push(isoDay(d))
    d = addDays(d, 1)
  }
  return out
}

export function emptyAnalytics(): Analytics {
  return {
    rows: [],
    stock: {
      writing: 0,
      writing_late: 0,
      balance_count: 0,
      balance_money: 0,
      balance_late: 0,
      pending_pay: 0,
      users: 0,
      paying_users: 0,
      repeat_users: 0,
      products_on: 0,
      products_off: 0,
      commission_on: 0,
    },
  }
}
