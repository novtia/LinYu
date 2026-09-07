import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  ChevronRight,
  ClipboardList,
  FolderTree,
  Globe,
  Plus,
  Send,
  UserPlus,
} from 'lucide-react'
import { ApiError, api } from '../../lib/api'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { orderStatusLabel, orderStatusTone } from '../../lib/orderStatus'
import type { Dashboard, DashboardConv, Order } from '../../types'

type Range = 7 | 14 | 30

function greet(name: string) {
  const h = new Date().getHours()
  const hi = h < 5 ? '夜深了' : h < 11 ? '早上好' : h < 14 ? '中午好' : h < 18 ? '下午好' : '晚上好'
  return `${hi}，${name}`
}

function pad(n: number) {
  return String(n).padStart(2, '0')
}

function fmtClock(d: Date) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function fmtOrderTime(iso: string) {
  const d = new Date(iso)
  const now = new Date()
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (d.toDateString() === now.toDateString()) return fmtClock(d)
  if (d.toDateString() === yesterday.toDateString()) return `昨天 ${fmtClock(d)}`
  return `${d.getMonth() + 1}/${d.getDate()} ${fmtClock(d)}`
}

function fmtConvTime(iso?: string | null) {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (d.toDateString() === now.toDateString()) return fmtClock(d)
  if (d.toDateString() === yesterday.toDateString()) return '昨天'
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}`
}

function fmtBarLabel(date: string) {
  const [, m, d] = date.split('-')
  return `${m}/${d}`
}

function yuan(n: number) {
  const v = Math.round(Number(n) * 100) / 100
  const int = Math.trunc(v)
  const frac = Math.round((v - int) * 100)
  return {
    int: int.toLocaleString('zh-CN'),
    frac: String(frac).padStart(2, '0'),
  }
}

function compactStatus(status: string) {
  if (status === 'deposit_paid') return '已付定金'
  return orderStatusLabel(status)
}

function dashTone(status: string): 'teal' | 'warn' | 'danger' | 'mute' {
  if (status === 'deposit_paid' || status === 'paid' || status === 'completed') return 'teal'
  return orderStatusTone(status)
}

function orderTitle(o: Order) {
  const name = o.items.map((i) => i.name).join('、') || '订单'
  if (o.sale_mode === 'commission' && o.word_count) {
    return `${name} · ${o.word_count.toLocaleString('zh-CN')}字`
  }
  return name
}

function convHref(c: DashboardConv) {
  if (c.order_id) return `/admin/conversations?order=${encodeURIComponent(c.order_id)}`
  return `/admin/conversations?user=${encodeURIComponent(c.user_id)}&product=${c.product_id}`
}

const TONE_CLASS = {
  teal: 'text-teal [&_i]:bg-teal',
  warn: 'text-[#8a6a2f] [&_i]:bg-[#c4a574]',
  danger: 'text-danger [&_i]:bg-danger',
  mute: 'text-ink-mute [&_i]:bg-[var(--line-strong)]',
}

export function DashboardPage() {
  const { showToast } = useToast()
  const { user } = useAuth()
  const [data, setData] = useState<Dashboard | null>(null)
  const [range, setRange] = useState<Range>(14)

  useEffect(() => {
    api
      .get<Dashboard>('/api/dashboard')
      .then(setData)
      .catch((e) => {
        setData(null)
        showToast(e instanceof ApiError ? e.message : '概览数据加载失败')
      })
    // 进入概览时拉一次即可
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const trend = useMemo(() => {
    const all = data?.trend || []
    return all.slice(-range)
  }, [data, range])

  const trendMeta = useMemo(() => {
    if (!trend.length) return { total: 0, avg: '0', peak: '—', rev: '¥0' }
    const total = trend.reduce((a, p) => a + p.orders, 0)
    const rev = trend.reduce((a, p) => a + p.revenue, 0)
    const peak = trend.reduce((a, p) => (p.orders > a.orders ? p : a))
    const money = yuan(rev)
    return {
      total,
      avg: (total / trend.length).toFixed(1),
      peak: peak.orders ? `${peak.orders} 笔 · ${fmtBarLabel(peak.date)}` : '—',
      rev: `¥${money.int}${Number(money.frac) ? `.${money.frac}` : ''}`,
    }
  }, [trend])

  if (!data) return <div className="px-1 py-2 text-ink-mute">加载中…</div>

  const name = user?.username || '店主'
  const orderDelta = data.today_orders - data.yesterday_orders
  const revDelta =
    data.yesterday_revenue > 0
      ? Math.round(((data.today_revenue - data.yesterday_revenue) / data.yesterday_revenue) * 100)
      : data.today_revenue > 0
        ? null
        : 0
  const todayMoney = yuan(data.today_revenue)
  const maxBar = Math.max(1, ...trend.map((p) => p.orders))
  const depositCount = data.todos.find((t) => t.key === 'deposit')?.count || 0

  const leadParts: string[] = []
  if (data.today_orders > 0) leadParts.push(`今日已有 ${data.today_orders} 笔订单`)
  else leadParts.push('今天还没有新订单')
  if (data.unread_threads > 0) leadParts.push(`${data.unread_threads} 条约稿对话等待回复`)
  if (depositCount > 0) leadParts.push(`${depositCount} 笔已付定金待交稿`)

  return (
    <div className="-m-4 min-h-full bg-white px-5 py-8 md:-m-6 md:px-9 md:py-9">
      <div className="mx-auto w-full max-w-[1160px]">
        <header className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="font-[family-name:var(--font-display)] text-[clamp(1.9rem,3vw,2.4rem)] leading-[1.1] font-extrabold tracking-[-0.04em]">
              {greet(name)}
            </h1>
            <p className="mt-1.5 text-[0.88rem] text-ink-mute">
              {leadParts.map((part, i) => (
                <span key={part}>
                  {i > 0 ? '，' : ''}
                  <LeadBit text={part} />
                </span>
              ))}
              。
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Link
              to="/admin/orders"
              className="inline-flex h-[38px] items-center gap-1.5 rounded-[10px] border border-[var(--line-strong)] px-3.5 text-[0.84rem] font-semibold text-ink transition hover:border-ink"
            >
              <ClipboardList className="h-3.5 w-3.5" strokeWidth={1.9} />
              查看订单
            </Link>
            <Link
              to="/admin/products/new"
              className="inline-flex h-[38px] items-center gap-1.5 rounded-[10px] bg-teal px-4 text-[0.84rem] font-bold text-white transition hover:bg-teal-deep"
            >
              <Plus className="h-3.5 w-3.5" strokeWidth={2.2} />
              新增商品
            </Link>
          </div>
        </header>

        <dl className="mt-[30px] grid grid-cols-2 border-y border-[var(--line)] md:grid-cols-4">
          <StatLink
            to="/admin/orders"
            label="今日订单"
            value={String(data.today_orders)}
            delta={
              orderDelta > 0 ? (
                <Delta up>{`+${orderDelta} 较昨日`}</Delta>
              ) : orderDelta < 0 ? (
                <Delta down>{`${orderDelta} 较昨日`}</Delta>
              ) : (
                <Delta>与昨日持平</Delta>
              )
            }
          />
          <StatLink
            to="/admin/orders"
            label="今日营收"
            value={
              <>
                ¥{todayMoney.int}
                <small className="ml-0.5 text-[0.95rem] font-bold tracking-normal text-ink-mute">.{todayMoney.frac}</small>
              </>
            }
            delta={
              revDelta === null ? (
                <Delta up>今日入账</Delta>
              ) : revDelta > 0 ? (
                <Delta up>{`+${revDelta}%`}</Delta>
              ) : revDelta < 0 ? (
                <Delta down>{`${revDelta}%`}</Delta>
              ) : (
                <Delta>与昨日持平</Delta>
              )
            }
          />
          <StatLink
            to="/admin/orders"
            label="待处理"
            value={String(data.pending)}
            delta={
              data.pending_overdue > 0 ? (
                <Delta down>{`${data.pending_overdue} 笔超 24h`}</Delta>
              ) : (
                <Delta>待跟进</Delta>
              )
            }
          />
          <StatLink
            to="/admin/conversations"
            label="未读对话"
            value={String(data.unread_threads)}
            delta={
              data.unread_threads > 0 ? (
                <Delta>{`来自 ${data.unread_users} 位买家`}</Delta>
              ) : (
                <Delta>全部已读</Delta>
              )
            }
          />
        </dl>

        <section className="mt-11">
          <div className="flex items-baseline justify-between gap-4 border-b border-[var(--line)]">
            <h2 className="pb-3 font-[family-name:var(--font-display)] text-[1.12rem] tracking-[-0.02em]">
              订单趋势
              <small className="ml-2.5 font-[family-name:var(--font-body)] text-[0.76rem] font-medium tracking-normal text-ink-mute">
                近 {range} 日共 {trendMeta.total} 笔
              </small>
            </h2>
            <div className="flex gap-[22px]">
              {([7, 14, 30] as const).map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setRange(n)}
                  className={`relative h-[42px] bg-transparent px-0 text-[0.8rem] font-semibold ${
                    range === n ? 'text-ink after:absolute after:right-0 after:bottom-[-1px] after:left-0 after:h-0.5 after:bg-ink' : 'text-ink-mute hover:text-ink'
                  }`}
                >
                  近 {n} 日
                </button>
              ))}
            </div>
          </div>
          <div className="flex h-[148px] items-end gap-1.5 pt-7">
            {trend.map((p, i) => {
              const today = i === trend.length - 1
              const showLabel = range <= 14 || i % 3 === 0 || today
              const h = p.orders ? Math.max(8, Math.round((p.orders / maxBar) * 100)) : 3
              return (
                <div key={p.date} className="group flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-2">
                  <div
                    className={`relative w-full max-w-[30px] cursor-pointer rounded-t-sm ${
                      today ? 'bg-teal group-hover:bg-teal-deep' : 'bg-paper group-hover:bg-mint'
                    }`}
                    style={{ height: `${h}%` }}
                  >
                    <span className="pointer-events-none absolute bottom-[calc(100%+7px)] left-1/2 z-10 -translate-x-1/2 rounded-md bg-ink px-2 py-1 text-[0.68rem] font-semibold whitespace-nowrap text-white opacity-0 transition group-hover:opacity-100">
                      {fmtBarLabel(p.date)} · {p.orders} 笔
                    </span>
                  </div>
                  <span className={`font-[family-name:var(--font-mono)] text-[0.64rem] ${today ? 'font-bold text-teal' : 'text-ink-mute'}`}>
                    {showLabel ? p.date.slice(8) : ''}
                  </span>
                </div>
              )
            })}
          </div>
          <div className="mt-3 flex flex-wrap justify-between gap-2 text-[0.74rem] text-ink-mute">
            <span>
              峰值 <b className="font-[family-name:var(--font-mono)] font-bold text-ink">{trendMeta.peak}</b>
            </span>
            <span>
              日均 <b className="font-[family-name:var(--font-mono)] font-bold text-ink">{trendMeta.avg} 笔</b>
            </span>
            <span>
              营收合计 <b className="font-[family-name:var(--font-mono)] font-bold text-ink">{trendMeta.rev}</b>
            </span>
          </div>
        </section>

        <div className="mt-11 grid grid-cols-1 gap-12 xl:grid-cols-[minmax(0,1fr)_320px]">
          <section>
            <div className="flex items-baseline justify-between border-b border-[var(--line)]">
              <h2 className="pb-3 font-[family-name:var(--font-display)] text-[1.12rem] tracking-[-0.02em]">最近订单</h2>
              <Link to="/admin/orders" className="pb-3 text-[0.8rem] font-bold text-teal hover:text-teal-deep">
                查看全部
              </Link>
            </div>
            {data.recent_orders.length ? (
              <ul className="m-0 list-none p-0">
                {data.recent_orders.map((o) => {
                  const tone = dashTone(o.status)
                  return (
                    <li key={o.id}>
                      <Link
                        to={`/admin/orders/${encodeURIComponent(o.id)}`}
                        className="grid grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_auto] items-center gap-x-5 gap-y-2 border-b border-[var(--line)] px-1 py-[15px] transition hover:bg-[rgba(232,241,238,.45)]"
                      >
                        <div className="min-w-0">
                          <span className="font-[family-name:var(--font-mono)] text-[0.76rem] tracking-[-0.01em] text-ink-mute">
                            {o.id}
                          </span>
                          <div className="mt-1.5 flex min-w-0 items-center gap-2.5">
                            <div className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-full bg-paper text-[0.72rem] font-bold text-ink-soft">
                              {(o.username || '?').slice(0, 1)}
                            </div>
                            <div className="min-w-0">
                              <b className="block truncate text-[0.9rem] font-bold">{orderTitle(o)}</b>
                              <span className="mt-0.5 block text-[0.74rem] text-ink-mute">{o.username}</span>
                            </div>
                          </div>
                        </div>
                        <span className={`inline-flex items-center gap-1.5 text-[0.76rem] font-semibold whitespace-nowrap ${TONE_CLASS[tone]}`}>
                          <i className="h-1.5 w-1.5 rounded-full" />
                          {compactStatus(o.status)}
                        </span>
                        <div className="text-right">
                          <span className="font-[family-name:var(--font-mono)] text-[0.92rem] font-bold tracking-[-0.02em]">
                            ¥{Number(o.total).toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}
                          </span>
                          <span className="mt-0.5 block font-[family-name:var(--font-mono)] text-[0.7rem] text-ink-mute">
                            {fmtOrderTime(o.created_at)}
                          </span>
                        </div>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            ) : (
              <p className="px-1 py-8 text-center text-[0.86rem] text-ink-mute">暂无订单</p>
            )}
          </section>

          <div className="flex min-w-0 flex-col gap-10">
            <section>
              <h3 className="mb-1 flex items-baseline justify-between border-b border-[var(--line)] pb-2.5 text-[0.8rem] font-bold tracking-[0.06em] text-ink-soft">
                待办
                <small className="font-medium tracking-normal text-ink-mute">按紧急度排序</small>
              </h3>
              <ul className="m-0 list-none p-0">
                {data.todos.map((t) => (
                  <li key={t.key}>
                    <Link
                      to={t.to}
                      className="flex items-center gap-3 border-b border-[var(--line)] px-1 py-3 transition hover:bg-[rgba(232,241,238,.45)]"
                    >
                      <span
                        className={`w-[34px] shrink-0 text-right font-[family-name:var(--font-display)] text-[1.3rem] font-extrabold tracking-[-0.03em] ${
                          t.urgent && t.count > 0 ? 'text-danger' : ''
                        }`}
                      >
                        {t.count}
                      </span>
                      <div className="min-w-0 flex-1">
                        <b className="block text-[0.84rem] font-semibold">{t.label}</b>
                        <small className="mt-px block text-[0.72rem] text-ink-mute">{t.hint}</small>
                      </div>
                      <ChevronRight className="h-4 w-4 shrink-0 text-ink-mute" strokeWidth={1.8} />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>

            <section>
              <h3 className="mb-3 border-b border-[var(--line)] pb-2.5 text-[0.8rem] font-bold tracking-[0.06em] text-ink-soft">
                快捷操作
              </h3>
              <div className="grid grid-cols-2 gap-2">
                <Quick to="/admin/deliveries" icon={<Send className="h-[15px] w-[15px] text-teal" strokeWidth={1.8} />} label="手动发放" />
                <Quick to="/admin/users" icon={<UserPlus className="h-[15px] w-[15px] text-teal" strokeWidth={1.8} />} label="添加用户" />
                <Quick to="/admin/categories" icon={<FolderTree className="h-[15px] w-[15px] text-teal" strokeWidth={1.8} />} label="调整分类" />
                <Quick to="/admin/website" icon={<Globe className="h-[15px] w-[15px] text-teal" strokeWidth={1.8} />} label="站点公告" />
              </div>
            </section>

            <section>
              <h3 className="mb-1 flex items-baseline justify-between border-b border-[var(--line)] pb-2.5 text-[0.8rem] font-bold tracking-[0.06em] text-ink-soft">
                约稿对话
                <small className="font-medium tracking-normal text-ink-mute">最近活跃</small>
              </h3>
              {data.conversations.length ? (
                <ul className="m-0 list-none p-0">
                  {data.conversations.map((c) => (
                    <li key={c.id}>
                      <Link
                        to={convHref(c)}
                        className="flex items-start gap-2.5 border-b border-[var(--line)] px-1 py-3 transition hover:bg-[rgba(232,241,238,.45)]"
                      >
                        <div className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-full bg-paper text-[0.72rem] font-bold text-ink-soft">
                          {c.username.slice(0, 1)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline justify-between gap-2">
                            <b className="text-[0.84rem]">{c.username}</b>
                            <time className="shrink-0 font-[family-name:var(--font-mono)] text-[0.68rem] text-ink-mute">
                              {fmtConvTime(c.last_at)}
                            </time>
                          </div>
                          <p className="mt-0.5 truncate text-[0.76rem] leading-relaxed text-ink-mute">{c.preview}</p>
                        </div>
                        {c.unread > 0 ? (
                          <span className="mt-0.5 grid h-4 min-w-4 shrink-0 place-items-center rounded-full bg-danger px-1 text-[0.64rem] font-extrabold text-white">
                            {c.unread}
                          </span>
                        ) : null}
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="px-1 py-5 text-[0.78rem] text-ink-mute">暂无约稿对话</p>
              )}
            </section>

            <section>
              <h3 className="mb-1 border-b border-[var(--line)] pb-2.5 text-[0.8rem] font-bold tracking-[0.06em] text-ink-soft">
                系统状态
              </h3>
              <ul className="m-0 list-none p-0 text-[0.78rem]">
                <li className="flex items-center justify-between border-b border-[var(--line)] px-1 py-2.5">
                  <span>支付渠道</span>
                  {data.system.payments === '未启用' ? (
                    <span className="text-ink-mute">{data.system.payments}</span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-[0.74rem] font-semibold text-teal">
                      <i className="h-1.5 w-1.5 rounded-full bg-[#1a9a7c]" />
                      {data.system.payments}
                    </span>
                  )}
                </li>
                <li className="flex items-center justify-between border-b border-[var(--line)] px-1 py-2.5">
                  <span>邮件服务</span>
                  {data.system.mail_ok ? (
                    <span className="inline-flex items-center gap-1.5 text-[0.74rem] font-semibold text-teal">
                      <i className="h-1.5 w-1.5 rounded-full bg-[#1a9a7c]" />
                      {data.system.mail_label}
                    </span>
                  ) : (
                    <span className="text-ink-mute">{data.system.mail_label}</span>
                  )}
                </li>
                <li className="flex items-center justify-between border-b border-[var(--line)] px-1 py-2.5">
                  <span>数据库</span>
                  <span className="font-[family-name:var(--font-mono)] text-[0.72rem] text-ink-mute">
                    {data.system.db_name} · {data.system.db_size}
                  </span>
                </li>
                <li className="flex items-center justify-between px-1 py-2.5">
                  <span>在售 / 用户</span>
                  <span className="font-[family-name:var(--font-mono)] text-[0.72rem] text-ink-mute">
                    {data.system.products_on} 件 · {data.system.users} 人
                  </span>
                </li>
              </ul>
            </section>
          </div>
        </div>
      </div>
    </div>
  )
}

function LeadBit({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\d+)/).map((bit, i) =>
        /^\d+$/.test(bit) ? (
          <b key={i} className="font-bold text-teal">
            {bit}
          </b>
        ) : (
          <span key={i}>{bit}</span>
        ),
      )}
    </>
  )
}

function StatLink({
  to,
  label,
  value,
  delta,
}: {
  to: string
  label: string
  value: ReactNode
  delta: ReactNode
}) {
  return (
    <Link
      to={to}
      className="group block py-5 pr-4 max-md:even:border-l max-md:even:border-[var(--line)] max-md:even:pl-5 max-md:[&:nth-child(n+3)]:border-t max-md:[&:nth-child(n+3)]:border-[var(--line)] md:[&:not(:first-child)]:border-l md:[&:not(:first-child)]:border-[var(--line)] md:[&:not(:first-child)]:pl-6"
    >
      <dt className="mb-2.5 flex items-center justify-between text-[0.74rem] tracking-[0.05em] text-ink-mute">
        {label}
        <ArrowRight className="h-3.5 w-3.5 text-teal opacity-0 transition group-hover:opacity-100" strokeWidth={1.9} />
      </dt>
      <dd className="m-0 flex items-baseline gap-2.5">
        <b className="font-[family-name:var(--font-display)] text-[2.35rem] leading-none font-extrabold tracking-[-0.045em]">{value}</b>
        {delta}
      </dd>
    </Link>
  )
}

function Delta({ children, up, down }: { children: ReactNode; up?: boolean; down?: boolean }) {
  const Icon = up ? ArrowUpRight : down ? ArrowDownRight : null
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-[0.72rem] font-bold ${
        up ? 'text-teal' : down ? 'text-danger' : 'font-semibold text-ink-mute'
      }`}
    >
      {Icon ? <Icon className="h-3 w-3" strokeWidth={2.2} /> : null}
      {children}
    </span>
  )
}

function Quick({ to, icon, label }: { to: string; icon: ReactNode; label: string }) {
  return (
    <Link
      to={to}
      className="flex flex-col items-start gap-2.5 rounded-sm border border-[var(--line)] bg-white p-3.5 text-left text-[0.8rem] font-semibold text-ink transition hover:border-teal hover:text-teal"
    >
      {icon}
      {label}
    </Link>
  )
}
