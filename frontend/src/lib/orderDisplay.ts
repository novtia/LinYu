import { formatWords } from './commission'
import { orderCompactLabel, orderDotTone } from './orderStatus'
import type { Order, OrderItem, OrderPayment, ProductFileItem } from '../types'

const COVER_TONES = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'] as const

export type OrderListFilter = 'all' | 'pending' | 'doing' | 'done'
export type FlowSeg = 'on' | 'now' | ''
export type StepKind = 'done' | 'now' | 'todo'

export const ORDER_LIST_FILTERS: { id: OrderListFilter; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'pending', label: '待支付' },
  { id: 'doing', label: '进行中' },
  { id: 'done', label: '已完成' },
]

const PROVIDER: Record<string, string> = { alipay: '支付宝', ezpay: '易支付', free: '免费', manual: '人工' }
const METHOD: Record<string, string> = { alipay: '支付宝', wxpay: '微信', qqpay: 'QQ', free: '免费', manual: '人工' }

function pad(n: number) {
  return String(n).padStart(2, '0')
}

export function fmtListTime(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function fmtFullTime(iso?: string | null) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function fmtStepTime(iso?: string | null) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function formatMoney(n: number) {
  const v = Math.round(Number(n) * 100) / 100
  const int = Math.trunc(v)
  const frac = Math.round((v - int) * 100)
  return `¥${int.toLocaleString('zh-CN')}.${String(frac).padStart(2, '0')}`
}

export function splitMoney(n: number) {
  const v = Math.round(Number(n) * 100) / 100
  const int = Math.trunc(v)
  const frac = Math.round((v - int) * 100)
  return { head: int.toLocaleString('zh-CN'), frac: `.${String(frac).padStart(2, '0')}` }
}

export function orderTitle(o: Order) {
  return o.items.map((i) => i.name).join('、') || '订单'
}

export function isCommissionOrder(o: Pick<Order, 'sale_mode'>) {
  return o.sale_mode === 'commission'
}

export function isDoingStatus(status: string) {
  return status === 'deposit_paid' || status === 'awaiting_balance'
}

export function isDoneStatus(status: string) {
  return status === 'paid' || status === 'completed'
}

export function isDeadStatus(status: string) {
  return status === 'failed' || status === 'cancelled'
}

export function matchListFilter(status: string, filter: OrderListFilter) {
  if (filter === 'all') return true
  if (filter === 'pending') return status === 'pending'
  if (filter === 'doing') return isDoingStatus(status)
  return isDoneStatus(status)
}

export function ticketTone(status: string): 'teal' | 'warn' | 'danger' | 'mute' {
  if (status === 'cancelled') return 'mute'
  return orderDotTone(status)
}

export function ticketToneClass(status: string) {
  const tone = ticketTone(status)
  if (tone === 'teal') return 'text-teal [&_i]:bg-teal'
  if (tone === 'warn') return 'text-[#8a6a2f] [&_i]:bg-[#c4a574]'
  if (tone === 'danger') return 'text-danger [&_i]:bg-danger'
  return 'text-ink-mute [&_i]:bg-[var(--line-strong)]'
}

export function coverGlyph(name: string) {
  const s = name.replace(/[《》「」『』【】\[\]\s]/g, '')
  return s.slice(0, 1) || '匣'
}

export function coverTone(seed: number) {
  return COVER_TONES[Math.abs(seed) % COVER_TONES.length]
}

export function orderCovers(o: Order) {
  const seen = new Set<number>()
  const out: { tone: string; glyph: string }[] = []
  for (const it of o.items) {
    if (seen.has(it.product_id)) continue
    seen.add(it.product_id)
    out.push({ tone: coverTone(it.product_id), glyph: coverGlyph(it.name) })
    if (out.length >= 3) break
  }
  if (!out.length) out.push({ tone: 'p1', glyph: '匣' })
  return out
}

export function orderSubtitle(o: Order) {
  if (isCommissionOrder(o)) {
    const words = o.word_count ? formatWords(o.word_count) : '定制约稿'
    if (o.status === 'pending') return `${words} · 待付定金`
    if (o.status === 'deposit_paid') return `${words} · 等待交稿`
    if (o.status === 'awaiting_balance') return `${words} · 作者已交稿`
    if (isDoneStatus(o.status)) return `${words} · 已交付`
    return words
  }
  return `共 ${o.items.length} 件`
}

export function commissionFlowSegs(status: string): FlowSeg[] {
  if (status === 'pending') return ['now', '', '', '']
  if (status === 'deposit_paid') return ['on', 'now', '', '']
  if (status === 'awaiting_balance') return ['on', 'on', 'now', '']
  if (status === 'completed') return ['on', 'on', 'on', 'on']
  return ['', '', '', '']
}

export function orderHeroTitle(o: Order) {
  if (isCommissionOrder(o)) {
    if (o.status === 'pending') return '待付定金'
    if (o.status === 'deposit_paid') return '创作进行中'
    if (o.status === 'awaiting_balance') return '稿件已就绪'
    if (o.status === 'completed') return '交付完成'
  } else {
    if (o.status === 'pending') return '等待支付'
    if (isDoneStatus(o.status)) return '已完成'
  }
  return orderCompactLabel(o.status)
}

export function orderHeroHint(o: Order) {
  const deposit = formatMoney(o.deposit_amount ?? 0)
  const balance = formatMoney(o.balance_amount ?? 0)
  if (isCommissionOrder(o)) {
    if (o.status === 'pending') return `订单已创建，请尽快支付定金 ${deposit}。若你已完成付款，请稍候刷新本页。`
    if (o.status === 'deposit_paid') return '定金已到账，作者正在创作。交稿后系统会第一时间邮件通知你。'
    if (o.status === 'awaiting_balance') return `作者已交稿，支付尾款 ${balance} 后即可解锁下载全文文件。`
    if (o.status === 'completed') return '感谢惠顾！成稿文件已解锁，可永久保存与下载。'
  } else {
    if (o.status === 'pending') return '请尽快完成支付；支付成功后系统自动发货，无需等待。若你已完成付款，请稍候刷新本页。'
    if (isDoneStatus(o.status)) return '商品已自动发货，可在下方查看发放内容与下载文件。'
  }
  if (o.status === 'failed' || o.status === 'cancelled') return '支付未完成，请重新下单或联系客服。'
  return '可在本页查看订单进度与发放内容。'
}

export function heroDotClass(status: string) {
  const tone = ticketTone(status)
  if (tone === 'teal') return 'bg-teal shadow-[0_0_0_4px_rgba(15,110,92,.14)]'
  if (tone === 'warn') return 'bg-[#c4a574] shadow-[0_0_0_4px_rgba(196,165,116,.2)]'
  if (tone === 'danger') return 'bg-danger shadow-[0_0_0_4px_rgba(180,35,24,.12)]'
  return 'bg-[var(--line-strong)]'
}

export function itemFiles(it: OrderItem): ProductFileItem[] {
  if (it.files && it.files.length) return it.files
  if (it.download_url || it.file_name) {
    return [
      {
        id: it.download_url || it.file_name || 'file',
        file_name: it.file_name || '已购文件',
        is_image: /\.(png|jpe?g|gif|webp|bmp)$/i.test(it.file_name || ''),
        download_url: it.download_url,
      },
    ]
  }
  return []
}

export function paymentOf(o: Order, kind: string): OrderPayment | undefined {
  return (o.payments || []).find((p) => p.kind === kind && p.status === 'paid')
}

export function channelLabel(o: Order) {
  const p = PROVIDER[o.payment_provider || ''] || o.payment_provider || ''
  const m = METHOD[o.payment_method || ''] || ''
  if (!p && !m) return ''
  if (p && m && m !== p) return `${p} · ${m}`
  return p || m
}

export function maskEmail(email: string) {
  const value = email.trim()
  const at = value.indexOf('@')
  if (at < 1) return value
  const user = value.slice(0, at)
  const domain = value.slice(at + 1)
  const head = user.slice(0, Math.min(3, user.length))
  return `${head}***@${domain}`
}

export type OrderStep = { label: string; kind: StepKind; time?: string }

export function orderSteps(o: Order): OrderStep[] {
  if (isCommissionOrder(o)) {
    const depositAt = paymentOf(o, 'deposit')?.paid_at
    const balanceAt = paymentOf(o, 'balance')?.paid_at
    if (o.status === 'pending') {
      return [
        { label: '支付定金', kind: 'now' },
        { label: '创作交稿', kind: 'todo' },
        { label: '支付尾款', kind: 'todo' },
        { label: '交付完成', kind: 'todo' },
      ]
    }
    if (o.status === 'deposit_paid') {
      return [
        { label: '支付定金', kind: 'done', time: fmtStepTime(depositAt || o.paid_at) },
        { label: '创作交稿', kind: 'now' },
        { label: '支付尾款', kind: 'todo' },
        { label: '交付完成', kind: 'todo' },
      ]
    }
    if (o.status === 'awaiting_balance') {
      return [
        { label: '支付定金', kind: 'done', time: fmtStepTime(depositAt || o.paid_at || o.created_at) },
        { label: '创作交稿', kind: 'done' },
        { label: '支付尾款', kind: 'now' },
        { label: '交付完成', kind: 'todo' },
      ]
    }
    if (o.status === 'completed') {
      const doneAt = balanceAt || o.paid_at
      return [
        { label: '支付定金', kind: 'done', time: fmtStepTime(depositAt) },
        { label: '创作交稿', kind: 'done' },
        { label: '支付尾款', kind: 'done', time: fmtStepTime(doneAt) },
        { label: '交付完成', kind: 'done', time: fmtStepTime(doneAt) },
      ]
    }
    return [
      { label: '支付定金', kind: o.status === 'failed' || o.status === 'cancelled' ? 'todo' : 'now' },
      { label: '创作交稿', kind: 'todo' },
      { label: '支付尾款', kind: 'todo' },
      { label: '交付完成', kind: 'todo' },
    ]
  }
  if (o.status === 'pending') {
    return [
      { label: '提交订单', kind: 'done', time: fmtStepTime(o.created_at) },
      { label: '完成支付', kind: 'now' },
      { label: '自动发货', kind: 'todo' },
      { label: '完成', kind: 'todo' },
    ]
  }
  if (isDoneStatus(o.status)) {
    const paid = fmtStepTime(o.paid_at)
    return [
      { label: '提交订单', kind: 'done', time: fmtStepTime(o.created_at) },
      { label: '完成支付', kind: 'done', time: paid },
      { label: '自动发货', kind: 'done', time: paid },
      { label: '完成', kind: 'done', time: paid },
    ]
  }
  return [
    { label: '提交订单', kind: 'done', time: fmtStepTime(o.created_at) },
    { label: '完成支付', kind: o.status === 'failed' || o.status === 'cancelled' ? 'todo' : 'now' },
    { label: '自动发货', kind: 'todo' },
    { label: '完成', kind: 'todo' },
  ]
}
