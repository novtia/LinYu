import { type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Copy, FileText, Image as ImageIcon, Lock, Mail, MessageSquare, Upload } from 'lucide-react'
import { formatWords } from '../lib/commission'
import { channelLabel, isCommissionOrder, isDoneStatus, itemFiles, orderTitle } from '../lib/orderDisplay'
import { orderCompactLabel, orderDotClass } from '../lib/orderStatus'
import { MarkdownContent } from './MarkdownContent'
import type { Order, OrderItem, OrderPayment, ProductFileItem } from '../types'

const FLOW = ['付定金', '沟通设定', '按章交稿', '付尾款'] as const
const PAY_KIND: Record<string, string> = { deposit: '定金', balance: '尾款', full: '全款' }

function pad(n: number) {
  return String(n).padStart(2, '0')
}

function fmtClock(d: Date) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function yuan(n: number) {
  const v = Math.round(Number(n) * 100) / 100
  const int = Math.trunc(v)
  const frac = Math.round((v - int) * 100)
  const head = int.toLocaleString('zh-CN')
  return frac ? `¥${head}.${String(frac).padStart(2, '0')}` : `¥${head}`
}

export function fmtListTime(iso?: string | null) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const now = new Date()
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (d.toDateString() === now.toDateString()) return fmtClock(d)
  if (d.toDateString() === yesterday.toDateString()) return `昨天 ${fmtClock(d)}`
  return `${d.getMonth() + 1}/${d.getDate()} ${fmtClock(d)}`
}

function fmtFullTime(iso?: string | null) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${fmtClock(d)}`
}

export function allOrderFiles(o: Order): ProductFileItem[] {
  return o.items.flatMap(itemFiles)
}

function flowNow(o: Order) {
  if (isDoneStatus(o.status)) return 4
  if (o.status === 'awaiting_balance') return 3
  if (o.status === 'deposit_paid') return allOrderFiles(o).length ? 2 : 1
  return 0
}

type Props = {
  order: Order
  uploading?: boolean
  recalling?: boolean
  hideChatLink?: boolean
  onCopy: (text: string, ok?: string) => void
  onUploadClick: () => void
  onDownload: (url: string, name: string) => void
  onDelete: (fileId: string) => void
  onRecallDelivery?: () => void
}

export function AdminOrderDetail({
  order,
  uploading,
  recalling,
  hideChatLink,
  onCopy,
  onUploadClick,
  onDownload,
  onDelete,
  onRecallDelivery,
}: Props) {
  const commission = isCommissionOrder(order)
  const files = allOrderFiles(order)
  const locked = isDoneStatus(order.status)
  const canEdit = commission && (order.status === 'deposit_paid' || order.status === 'awaiting_balance')
  const lockedForBuyer = commission && !locked && files.length > 0
  const step = flowNow(order)
  const payments = [...(order.payments || [])]
  const deposit = order.deposit_amount ?? 0
  const balance = order.balance_amount ?? 0
  const depositPaid =
    payments.some((p) => p.kind === 'deposit' && p.status === 'paid') ||
    ['deposit_paid', 'awaiting_balance', 'completed'].includes(order.status)
  const balancePaid = payments.some((p) => p.kind === 'balance' && p.status === 'paid') || order.status === 'completed'
  const chatHref = `/admin/conversations?order=${encodeURIComponent(order.id)}`

  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 font-[family-name:var(--font-mono)] text-[0.78rem] text-ink-mute">
            {order.id}
            <button type="button" title="复制订单号" className="grid p-0.5 text-ink-mute hover:text-teal" onClick={() => onCopy(order.id)}>
              <Copy className="h-3.5 w-3.5" strokeWidth={1.8} />
            </button>
          </div>
          <h2 className="mt-2.5 font-[family-name:var(--font-display)] text-[1.5rem] leading-snug tracking-[-0.03em] break-words">
            {orderTitle(order)}
          </h2>
          <div className="mt-1.5 text-[0.8rem] text-ink-mute">
            {order.username}
            {order.email ? (
              <>
                {' · '}
                <a className="font-semibold text-teal hover:underline" href={`mailto:${order.email}`}>
                  {order.email}
                </a>
              </>
            ) : null}
            {commission && !hideChatLink ? (
              <>
                {' · '}
                <Link to={chatHref} className="font-semibold text-teal hover:underline">
                  打开约稿对话
                </Link>
              </>
            ) : null}
          </div>
        </div>
        <span className={`mt-0.5 inline-flex shrink-0 items-center gap-1.5 text-[0.8rem] font-semibold ${orderDotClass(order.status)}`}>
          <i className="h-1.5 w-1.5 rounded-full" />
          {commission ? `约稿 · ${orderCompactLabel(order.status)}` : orderCompactLabel(order.status)}
        </span>
      </div>

      <div className="mt-[18px]">
        <div className="font-[family-name:var(--font-display)] text-[2.5rem] leading-none font-extrabold tracking-[-0.05em]">
          {yuan(order.total)}
          {commission ? <small className="ml-1 text-[1rem] tracking-normal text-ink-mute">合计</small> : null}
        </div>
        {commission ? (
          <div className="mt-4 grid grid-cols-3 border-y border-[var(--line)]">
            <SplitCell label="字数" value={order.word_count ? formatWords(order.word_count) : '—'} />
            <SplitCell label={`定金 ${depositPaid ? '已收' : '待收'}`} value={yuan(deposit)} tone={depositPaid ? 'ok' : 'wait'} />
            <SplitCell label={`尾款 ${balancePaid ? '已收' : '待收'}`} value={yuan(balance)} tone={balancePaid ? 'ok' : 'wait'} />
          </div>
        ) : null}
      </div>

      {commission ? (
        <ol className="mt-5 m-0 grid list-none grid-cols-4 p-0">
          {FLOW.map((label, i) => {
            const on = i < step || i === step
            const now = i === step && step < 4
            return (
              <li key={label} className={`relative pr-3 text-[0.74rem] ${on ? 'font-bold text-ink' : 'text-ink-mute'}`}>
                <i
                  className={`mb-2 block h-1.5 w-1.5 rounded-full ${
                    on ? 'bg-teal' : 'bg-[var(--line-strong)]'
                  } ${now ? 'shadow-[0_0_0_3px_rgba(15,110,92,.18)]' : ''}`}
                />
                {label}
              </li>
            )
          })}
        </ol>
      ) : null}

      <Section title="买家与支付">
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
          <Dt>买家</Dt>
          <Dd>
            {order.username}
            {order.email ? <span className="font-medium text-ink-mute"> {order.email}</span> : null}
          </Dd>
          <Dt>下单时间</Dt>
          <Dd mono>{fmtFullTime(order.created_at)}</Dd>
          <Dt>支付渠道</Dt>
          <Dd>{channelLabel(order) || '—'}</Dd>
          {order.trade_no ? (
            <>
              <Dt>渠道流水</Dt>
              <Dd mono>
                <span className="inline-flex items-center justify-end gap-1.5">
                  {order.trade_no}
                  <button type="button" className="text-ink-mute hover:text-teal" onClick={() => onCopy(order.trade_no || '')}>
                    <Copy className="h-3 w-3" strokeWidth={1.8} />
                  </button>
                </span>
              </Dd>
            </>
          ) : null}
          {order.paid_at ? (
            <>
              <Dt>支付时间</Dt>
              <Dd mono>{fmtFullTime(order.paid_at)}</Dd>
            </>
          ) : null}
        </dl>
      </Section>

      <Section title="支付明细" extra={`${payments.length} 笔`}>
        {payments.length ? (
          <ul className="m-0 mt-1 list-none p-0">
            {payments.map((p) => (
              <PaymentRow key={p.id} payment={p} />
            ))}
          </ul>
        ) : (
          <p className="mt-3 mb-0 text-[0.8rem] text-ink-mute">暂无支付记录</p>
        )}
      </Section>

      <Section title={commission ? '稿件交付' : '发放内容'} extra={`${files.length} 个文件`}>
        {files.length ? (
          <ul className="m-0 mt-2 list-none p-0">
            {files.map((f) => (
              <li key={f.id} className="flex items-center gap-2.5 border-b border-[var(--line)] py-2.5 last:border-b-0">
                <div className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-sm bg-[rgba(15,110,92,.1)] text-teal">
                  {f.is_image ? <ImageIcon className="h-3.5 w-3.5" strokeWidth={1.8} /> : <FileText className="h-3.5 w-3.5" strokeWidth={1.8} />}
                </div>
                <div className="min-w-0 flex-1">
                  <b className="block truncate text-[0.8rem]">{f.file_name}</b>
                  {lockedForBuyer ? <small className="text-[0.7rem] text-ink-mute">买家付尾款后解锁</small> : locked ? <small className="text-[0.7rem] text-teal">已解锁</small> : null}
                </div>
                <div className="flex shrink-0 gap-2.5">
                  {f.download_url ? (
                    <button
                      type="button"
                      className="border-0 bg-transparent p-0 text-[0.74rem] font-bold text-teal hover:underline"
                      onClick={() => onDownload(f.download_url!, f.file_name)}
                    >
                      下载
                    </button>
                  ) : (
                    <span className="text-[0.74rem] text-ink-mute">预览</span>
                  )}
                  {canEdit ? (
                    <button
                      type="button"
                      className="border-0 bg-transparent p-0 text-[0.74rem] font-semibold text-danger hover:underline"
                      onClick={() => onDelete(f.id)}
                    >
                      删除
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <PayloadFallback items={order.items} commission={commission} />
        )}
        {canEdit ? (
          <button
            type="button"
            disabled={uploading}
            onClick={onUploadClick}
            className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-sm border border-dashed border-[var(--line-strong)] px-3.5 py-3.5 text-[0.78rem] text-ink-mute transition hover:border-teal hover:text-teal disabled:opacity-60"
          >
            <Upload className="h-3.5 w-3.5" strokeWidth={1.8} />
            {uploading ? '上传中…' : '上传稿件（DOCX / TXT / 图片）'}
          </button>
        ) : null}
        {canEdit && files.length > 0 && onRecallDelivery ? (
          <button
            type="button"
            disabled={recalling}
            onClick={onRecallDelivery}
            className="mt-2 flex w-full items-center justify-center rounded-sm border border-[var(--line)] px-3.5 py-2.5 text-[0.78rem] font-semibold text-danger transition hover:border-danger disabled:opacity-60"
          >
            {recalling ? '撤回中…' : '撤回发货'}
          </button>
        ) : null}
        {lockedForBuyer ? (
          <div className="mt-2.5 flex items-start gap-2 bg-paper px-3 py-2.5 text-[0.76rem] text-ink-soft">
            <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
            <span>付尾款前可随时撤回。管理员可下载；买家需付清尾款后才能解锁。</span>
          </div>
        ) : locked && commission ? (
          <div className="mt-2.5 flex items-start gap-2 bg-paper px-3 py-2.5 text-[0.76rem] text-ink-soft">
            <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
            <span>尾款已收，订单已锁定，不能再改稿件或撤回发货。</span>
          </div>
        ) : null}
      </Section>

      <div className="mt-7 flex flex-wrap gap-2">
        {commission && !hideChatLink ? (
          <Link
            to={chatHref}
            className="inline-flex h-[38px] items-center gap-1.5 rounded-[10px] bg-teal px-4 text-[0.84rem] font-bold text-white hover:bg-teal-deep"
          >
            <MessageSquare className="h-3.5 w-3.5" strokeWidth={1.9} />
            打开对话
          </Link>
        ) : null}
        <button
          type="button"
          className="inline-flex h-[38px] items-center gap-1.5 rounded-[10px] border border-[var(--line-strong)] px-3.5 text-[0.82rem] font-semibold hover:border-ink"
          onClick={() => onCopy(order.id, '已复制订单号')}
        >
          <Copy className="h-3.5 w-3.5" strokeWidth={1.8} />
          复制单号
        </button>
        {order.email ? (
          <a
            href={`mailto:${order.email}`}
            className="inline-flex h-[38px] items-center gap-1.5 rounded-[10px] border border-[var(--line-strong)] px-3.5 text-[0.82rem] font-semibold hover:border-ink"
          >
            <Mail className="h-3.5 w-3.5" strokeWidth={1.8} />
            发邮件
          </a>
        ) : null}
      </div>
    </div>
  )
}

function Section({ title, extra, children }: { title: string; extra?: string; children: ReactNode }) {
  return (
    <section className="mt-7">
      <h3 className="m-0 flex items-baseline justify-between gap-2 border-b border-[var(--line)] pb-2.5 text-[0.76rem] font-bold tracking-[0.08em] text-ink-soft">
        {title}
        {extra ? <small className="font-medium tracking-normal text-ink-mute">{extra}</small> : null}
      </h3>
      {children}
    </section>
  )
}

function SplitCell({ label, value, tone }: { label: string; value: string; tone?: 'ok' | 'wait' }) {
  return (
    <div className="border-[var(--line)] py-3 first:pl-0 [&:not(:first-child)]:border-l [&:not(:first-child)]:pl-4">
      <small className="mb-1 block text-[0.7rem] tracking-[0.05em] text-ink-mute">{label}</small>
      <b
        className={`font-[family-name:var(--font-mono)] text-[0.92rem] font-bold tracking-[-0.01em] ${
          tone === 'ok' ? 'text-teal' : tone === 'wait' ? 'text-[#8a6a2f]' : ''
        }`}
      >
        {value}
      </b>
    </div>
  )
}

function Dt({ children }: { children: ReactNode }) {
  return <dt className="whitespace-nowrap text-[0.8rem] text-ink-mute">{children}</dt>
}

function Dd({ children, mono }: { children: ReactNode; mono?: boolean }) {
  return (
    <dd className={`m-0 text-right text-[0.84rem] font-semibold break-all ${mono ? 'font-[family-name:var(--font-mono)] text-[0.78rem] tracking-[-0.01em]' : ''}`}>
      {children}
    </dd>
  )
}

function PaymentRow({ payment }: { payment: OrderPayment }) {
  const paid = payment.status === 'paid'
  return (
    <li className="border-b border-[var(--line)] py-3 last:border-b-0">
      <div className="flex items-baseline justify-between gap-2.5">
        <b className="text-[0.88rem]">{PAY_KIND[payment.kind] || payment.kind}</b>
        <span className="font-[family-name:var(--font-mono)] text-[0.84rem] font-bold whitespace-nowrap">{yuan(payment.amount)}</span>
      </div>
      <div className="mt-1 flex justify-between text-[0.74rem] text-ink-mute">
        <span className={`inline-flex items-center gap-1.5 text-[0.72rem] font-semibold ${paid ? 'text-teal [&_i]:bg-teal' : 'text-[#8a6a2f] [&_i]:bg-[#c4a574]'}`}>
          <i className="h-1.5 w-1.5 rounded-full" />
          {paid ? '已到账' : '待支付'}
        </span>
        <span className="font-[family-name:var(--font-mono)]">{paid ? fmtListTime(payment.paid_at) : '—'}</span>
      </div>
    </li>
  )
}

function PayloadFallback({ items, commission }: { items: OrderItem[]; commission: boolean }) {
  const payloads = items.filter((it) => it.payload)
  if (payloads.length) {
    return (
      <div className="mt-3 space-y-3">
        {payloads.map((it, i) => (
          <div key={`${it.product_id}-${i}`} className="min-w-0 text-[0.84rem]">
            {items.length > 1 ? <div className="mb-1 text-[0.76rem] font-semibold text-ink-soft">{it.name}</div> : null}
            <MarkdownContent content={it.payload || ''} />
          </div>
        ))}
      </div>
    )
  }
  return <p className="mt-3 mb-0 text-[0.8rem] text-ink-mute">{commission ? '还未上传稿件' : '未发放'}</p>
}
