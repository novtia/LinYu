import type { LedgerRow } from '../types'
import { shanghaiDay, shanghaiHour } from './ledger'

const OFFSET = 8 * 3600 * 1000

export type PeriodId = 'today' | '7' | '30' | 'month'
export type DeltaDir = 'up' | 'down' | 'flat'

export type DeskRange = {
  id: PeriodId
  label: string
  unit: 'hour' | 'day'
  from: Date
  to: Date
  prevFrom: Date
  prevTo: Date
  keys: string[]
  labels: string[]
}

function shParts(d = new Date()) {
  const x = new Date(d.getTime() + OFFSET)
  return {
    y: x.getUTCFullYear(),
    m: x.getUTCMonth(),
    day: x.getUTCDate(),
    h: x.getUTCHours(),
  }
}

function midnight(y: number, m: number, day: number) {
  return new Date(Date.UTC(y, m, day) - OFFSET)
}

function addCal(y: number, m: number, day: number, n: number) {
  const dt = new Date(Date.UTC(y, m, day + n))
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth(), day: dt.getUTCDate() }
}

function iso(y: number, m: number, day: number) {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function lastDay(y: number, m: number) {
  return new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
}

export function periodRange(id: PeriodId, now = new Date()): DeskRange {
  const p = shParts(now)
  const today0 = midnight(p.y, p.m, p.day)
  const elapsed = now.getTime() - today0.getTime()
  if (id === 'today') {
    const yest = addCal(p.y, p.m, p.day, -1)
    const y0 = midnight(yest.y, yest.m, yest.day)
    const keys = Array.from({ length: 24 }, (_, h) => String(h))
    return {
      id,
      label: '今日',
      unit: 'hour',
      from: today0,
      to: now,
      prevFrom: y0,
      prevTo: new Date(y0.getTime() + elapsed),
      keys,
      labels: keys.map((h) => `${h}时`),
    }
  }
  if (id === 'month') {
    const pm = p.m === 0 ? { y: p.y - 1, m: 11 } : { y: p.y, m: p.m - 1 }
    const clamp = Math.min(p.day, lastDay(pm.y, pm.m))
    const keys: string[] = []
    const labels: string[] = []
    for (let d = 1; d <= p.day; d++) {
      keys.push(iso(p.y, p.m, d))
      labels.push(`${p.m + 1}/${d}`)
    }
    return {
      id,
      label: '本月',
      unit: 'day',
      from: midnight(p.y, p.m, 1),
      to: now,
      prevFrom: midnight(pm.y, pm.m, 1),
      prevTo: new Date(midnight(pm.y, pm.m, clamp).getTime() + elapsed),
      keys,
      labels,
    }
  }
  const n = id === '7' ? 7 : 30
  const startP = addCal(p.y, p.m, p.day, -(n - 1))
  const prevEndP = addCal(startP.y, startP.m, startP.day, -1)
  const prevStartP = addCal(prevEndP.y, prevEndP.m, prevEndP.day, -(n - 1))
  const keys: string[] = []
  const labels: string[] = []
  for (let i = 0; i < n; i++) {
    const d = addCal(startP.y, startP.m, startP.day, i)
    keys.push(iso(d.y, d.m, d.day))
    labels.push(`${d.m + 1}/${d.day}`)
  }
  return {
    id,
    label: id === '7' ? '近 7 日' : '近 30 日',
    unit: 'day',
    from: midnight(startP.y, startP.m, startP.day),
    to: now,
    prevFrom: midnight(prevStartP.y, prevStartP.m, prevStartP.day),
    prevTo: new Date(midnight(prevEndP.y, prevEndP.m, prevEndP.day).getTime() + elapsed),
    keys,
    labels,
  }
}

export function inSpan(isoTime: string, from: Date, to: Date) {
  const t = new Date(isoTime).getTime()
  return Number.isFinite(t) && t >= from.getTime() && t <= to.getTime()
}

export function bucketOf(isoTime: string, unit: 'hour' | 'day') {
  return unit === 'hour' ? String(shanghaiHour(isoTime)) : shanghaiDay(isoTime)
}

export function deltaPct(cur: number, prev: number): { dir: DeltaDir; text: string } {
  if (!prev) return { dir: cur ? 'up' : 'flat', text: cur ? '上期为 0' : '与上期持平' }
  const p = Math.round(((cur - prev) / Math.abs(prev)) * 100)
  if (p > 0) return { dir: 'up', text: `+${p}% 较上期` }
  if (p < 0) return { dir: 'down', text: `${p}% 较上期` }
  return { dir: 'flat', text: '与上期持平' }
}

export function buyerKey(row: LedgerRow) {
  return row.user_id || `n:${row.buyer || '匿名'}`
}

export function moneyOf(rows: { amount: number }[]) {
  return rows.reduce((a, r) => a + (Number(r.amount) || 0), 0)
}

export function weekdayMon(day: string) {
  const [y, m, d] = day.split('-').map(Number)
  const wd = new Date(Date.UTC(y, (m || 1) - 1, d || 1)).getUTCDay()
  return (wd + 6) % 7
}

export function greet(now = new Date()) {
  const h = shParts(now).h
  if (h < 5) return '夜深了'
  if (h < 11) return '早上好'
  if (h < 14) return '中午好'
  if (h < 18) return '下午好'
  return '晚上好'
}

export function shanghaiLabel(now = new Date()) {
  const p = shParts(now)
  const wd = new Date(Date.UTC(p.y, p.m, p.day)).getUTCDay()
  return `${p.y}.${String(p.m + 1).padStart(2, '0')}.${String(p.day).padStart(2, '0')} 周${'日一二三四五六'[wd]}`
}

export function relStamp(isoTime?: string | null, now = Date.now()) {
  if (!isoTime) return '—'
  const t = new Date(isoTime).getTime()
  if (!Number.isFinite(t)) return '—'
  const min = Math.max(0, Math.round((now - t) / 60000))
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const h = Math.round(min / 60)
  if (h < 24) return `${h} 小时前`
  const d = Math.round(h / 24)
  return d === 1 ? '昨天' : `${d} 天前`
}

export function shortAgo(isoTime?: string | null, now = Date.now()) {
  if (!isoTime) return '—'
  const t = new Date(isoTime).getTime()
  if (!Number.isFinite(t)) return '—'
  const min = Math.max(0, Math.round((now - t) / 60000))
  if (min < 60) return `${Math.max(1, min)}分`
  const h = Math.round(min / 60)
  if (h < 48) return `${h}时`
  return `${Math.round(h / 24)}天`
}

export function downloadCsv(filename: string, rows: string[][]) {
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
  const body = rows.map((r) => r.map((c) => esc(String(c ?? ''))).join(',')).join('\n')
  const blob = new Blob(['\uFEFF' + body], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export function firstPaidAt(rows: LedgerRow[]) {
  const first = new Map<string, string>()
  const sorted = rows.filter((r) => r.ok).slice().sort((a, b) => +new Date(a.at) - +new Date(b.at))
  for (const row of sorted) {
    const key = buyerKey(row)
    if (!first.has(key)) first.set(key, row.at)
  }
  return first
}
