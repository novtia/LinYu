const TZ = 'Asia/Shanghai'

const formatter = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

type Parts = { year: string; month: string; day: string; hour: string; minute: string }

/** 服务端存的是不带时区的 UTC。没有时区标记时按 UTC 解析，再换算到北京时间。 */
export function parseServerTime(iso?: string | null): Date | null {
  if (!iso) return null
  let raw = iso.trim()
  if (!raw) return null
  if (/^\d{4}-\d{2}-\d{2} \d{2}:/.test(raw)) raw = raw.replace(' ', 'T')
  const hasZone = /(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(raw)
  const d = new Date(hasZone ? raw : `${raw}Z`)
  return Number.isNaN(d.getTime()) ? null : d
}

function partsOf(d: Date): Parts {
  const bag: Record<string, string> = {}
  for (const part of formatter.formatToParts(d)) {
    if (part.type !== 'literal') bag[part.type] = part.value
  }
  return {
    year: bag.year,
    month: bag.month,
    day: bag.day,
    hour: bag.hour === '24' ? '00' : bag.hour,
    minute: bag.minute,
  }
}

function dayKey(d: Date) {
  const p = partsOf(d)
  return `${p.year}-${p.month}-${p.day}`
}

function shiftDayKey(key: string, delta: number) {
  const [y, m, d] = key.split('-').map(Number)
  const next = new Date(Date.UTC(y, m - 1, d + delta))
  const month = String(next.getUTCMonth() + 1).padStart(2, '0')
  const day = String(next.getUTCDate()).padStart(2, '0')
  return `${next.getUTCFullYear()}-${month}-${day}`
}

function relation(d: Date, now = new Date()) {
  const key = dayKey(d)
  const today = dayKey(now)
  if (key === today) return 'today' as const
  if (key === shiftDayKey(today, -1)) return 'yesterday' as const
  return 'other' as const
}

export function beijingHour(date = new Date()) {
  return Number(partsOf(date).hour)
}

export function beijingDateKey(date = new Date()) {
  return dayKey(date)
}

export function isBeijingToday(iso?: string | null) {
  const d = parseServerTime(iso)
  return !!d && relation(d) === 'today'
}

export function isBeijingYesterday(iso?: string | null) {
  const d = parseServerTime(iso)
  return !!d && relation(d) === 'yesterday'
}

/** 2026/10/08 23:23 */
export function fmtBeijingFull(iso?: string | null) {
  const d = parseServerTime(iso)
  if (!d) return '—'
  const p = partsOf(d)
  return `${p.year}/${p.month}/${p.day} ${p.hour}:${p.minute}`
}

/** 10/08 23:23 */
export function fmtBeijingShort(iso?: string | null) {
  const d = parseServerTime(iso)
  if (!d) return '—'
  const p = partsOf(d)
  return `${p.month}/${p.day} ${p.hour}:${p.minute}`
}

/** 今天 23:23，昨天「昨天 23:23」，更早 10/8 23:23 */
export function fmtBeijingRecent(iso?: string | null) {
  const d = parseServerTime(iso)
  if (!d) return '—'
  const p = partsOf(d)
  const clock = `${p.hour}:${p.minute}`
  const when = relation(d)
  if (when === 'today') return clock
  if (when === 'yesterday') return `昨天 ${clock}`
  return `${Number(p.month)}/${Number(p.day)} ${clock}`
}

/** 今天 23:23，昨天「昨天」，更早 10/08 */
export function fmtBeijingConv(iso?: string | null) {
  const d = parseServerTime(iso)
  if (!d) return ''
  const p = partsOf(d)
  const when = relation(d)
  if (when === 'today') return `${p.hour}:${p.minute}`
  if (when === 'yesterday') return '昨天'
  return `${p.month}/${p.day}`
}

/** 今天 23:23，今年 10/08，跨年 26/10/08 */
export function fmtBeijingThread(iso?: string | null) {
  const d = parseServerTime(iso)
  if (!d) return ''
  const p = partsOf(d)
  const now = partsOf(new Date())
  if (dayKey(d) === `${now.year}-${now.month}-${now.day}`) return `${p.hour}:${p.minute}`
  if (p.year === now.year) return `${p.month}/${p.day}`
  return `${p.year.slice(2)}/${p.month}/${p.day}`
}

/** 10/8 23:23 */
export function fmtBeijingMonthDayClock(iso?: string | null) {
  const d = parseServerTime(iso)
  if (!d) return '—'
  const p = partsOf(d)
  return `${Number(p.month)}/${Number(p.day)} ${p.hour}:${p.minute}`
}

export function fmtBeijingClock(iso?: string | null) {
  const d = parseServerTime(iso)
  if (!d) return ''
  const p = partsOf(d)
  return `${p.hour}:${p.minute}`
}

export function fmtBeijingDate(iso?: string | null) {
  const d = parseServerTime(iso)
  if (!d) return ''
  return d.toLocaleDateString('zh-CN', { timeZone: TZ })
}
