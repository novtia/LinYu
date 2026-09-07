import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, ChevronRight, Inbox, Mail, PenLine } from 'lucide-react'
import { ApiError, api } from '../lib/api'
import { getGuestEmail, setGuestEmail } from '../lib/guestEmail'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { orderCompactLabel } from '../lib/orderStatus'
import {
  ORDER_LIST_FILTERS,
  commissionFlowSegs,
  formatMoney,
  fmtListTime,
  isDeadStatus,
  isDoingStatus,
  isCommissionOrder,
  maskEmail,
  matchListFilter,
  orderCovers,
  orderSubtitle,
  orderTitle,
  ticketToneClass,
  type OrderListFilter,
} from '../lib/orderDisplay'
import type { Order } from '../types'

export function OrdersListPage() {
  const { user, loading, openAuth } = useAuth()
  const { showToast } = useToast()
  const [orders, setOrders] = useState<Order[]>([])
  const [busy, setBusy] = useState(true)
  const [email, setEmail] = useState(getGuestEmail())
  const [searched, setSearched] = useState(() => !!getGuestEmail())
  const [filter, setFilter] = useState<OrderListFilter>('all')
  const isGuest = !loading && !user

  useEffect(() => {
    if (loading) return
    if (user) {
      setBusy(true)
      api
        .get<Order[]>('/api/orders/mine')
        .then(setOrders)
        .catch((e) => showToast(e instanceof ApiError ? e.message : '加载失败'))
        .finally(() => setBusy(false))
      return
    }
    const saved = getGuestEmail()
    if (!saved) {
      setOrders([])
      setSearched(false)
      setBusy(false)
      return
    }
    setEmail(saved)
    setBusy(true)
    api
      .post<Order[]>('/api/orders/lookup', { email: saved })
      .then((list) => {
        setOrders(list)
        setSearched(true)
      })
      .catch((e) => {
        setSearched(false)
        showToast(e instanceof ApiError ? e.message : '查询失败')
      })
      .finally(() => setBusy(false))
  }, [user, loading, showToast])

  async function searchByEmail(e: FormEvent) {
    e.preventDefault()
    const value = email.trim()
    if (!value) {
      showToast('请填写购买时使用的邮箱')
      return
    }
    setBusy(true)
    try {
      const list = await api.post<Order[]>('/api/orders/lookup', { email: value })
      setGuestEmail(value)
      setOrders(list)
      setSearched(true)
      setFilter('all')
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : '查询失败')
    } finally {
      setBusy(false)
    }
  }

  const counts = useMemo(
    () => ({
      all: orders.length,
      pending: orders.filter((o) => o.status === 'pending').length,
      doing: orders.filter((o) => isDoingStatus(o.status)).length,
      done: orders.filter((o) => o.status === 'paid' || o.status === 'completed').length,
    }),
    [orders],
  )

  const visible = useMemo(() => orders.filter((o) => matchListFilter(o.status, filter)), [orders, filter])
  const showLookup = isGuest && !searched
  const showList = !isGuest || searched

  if (loading) {
    return (
      <main className="pb-[90px] pt-8 md:pt-10">
        <div className="wrap-orders py-20 text-center text-ink-mute">加载中…</div>
      </main>
    )
  }

  return (
    <main className="pb-[90px] pt-8 md:pt-10">
      <div className="wrap-orders">
        <header className="flex items-end justify-between gap-5 max-[760px]:flex-col max-[760px]:items-start">
          <div>
            <h1 className="mb-2 font-[family-name:var(--font-display)] text-[clamp(2rem,4vw,2.6rem)] font-extrabold leading-[1.05] tracking-[-0.045em]">
              我的订单
            </h1>
            {showLookup ? (
              <p className="m-0 text-[0.88rem] text-ink-mute">输入购买时填写的邮箱即可查找订单</p>
            ) : (
              <p className="m-0 text-[0.88rem] text-ink-mute">
                共 <b className="font-bold text-teal">{counts.all}</b> 笔订单
                {counts.doing ? (
                  <>
                    {' '}
                    · <b className="font-bold text-teal">{counts.doing}</b> 笔进行中
                  </>
                ) : null}
                {counts.pending ? (
                  <>
                    {' '}
                    · <b className="font-bold text-teal">{counts.pending}</b> 笔待支付
                  </>
                ) : null}
              </p>
            )}
          </div>
          <Link
            to="/"
            className="inline-flex h-[38px] shrink-0 items-center gap-1.5 rounded-[10px] border border-[var(--line-strong)] bg-white/60 px-[15px] text-[0.84rem] font-semibold text-ink transition hover:border-ink hover:bg-white"
          >
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.8} />
            返回商城
          </Link>
        </header>

        {showLookup ? (
          <section className="mt-[34px]">
            <div className="mx-auto max-w-[560px] rounded-3xl border border-[var(--line)] bg-white px-6 py-9 text-center sm:px-11 sm:py-[42px]">
              <div className="mx-auto mb-[18px] grid h-[54px] w-[54px] place-items-center rounded-2xl bg-paper text-teal">
                <Mail className="h-6 w-6" strokeWidth={1.8} />
              </div>
              <h2 className="mb-2.5 font-[family-name:var(--font-display)] text-[1.5rem] tracking-[-0.03em]">查找我的订单</h2>
              <p className="m-0 text-[0.86rem] leading-[1.8] text-ink-mute">
                输入购买时填写的邮箱，即可查看订单与发放内容。
                <br />
                支付成功后查询链接也会发送到该邮箱，请留意收件箱。
              </p>
              <form onSubmit={searchByEmail} className="mt-[26px] flex gap-3 text-left max-[640px]:flex-col">
                <label className="flex min-w-0 flex-1 items-center gap-2.5 border-b-[1.5px] border-[var(--line-strong)] pb-2 transition-[border-color] focus-within:border-teal">
                  <Mail className="h-[15px] w-[15px] shrink-0 text-ink-mute" strokeWidth={1.8} />
                  <input
                    type="email"
                    value={email}
                    onChange={(ev) => setEmail(ev.target.value)}
                    placeholder="you@example.com"
                    required
                    className="min-w-0 flex-1 border-0 bg-transparent text-[0.95rem] outline-none"
                  />
                </label>
                <button
                  type="submit"
                  disabled={busy}
                  className="inline-flex h-11 shrink-0 items-center justify-center rounded-xl bg-teal px-[22px] text-[0.9rem] font-bold text-white transition hover:bg-teal-deep disabled:opacity-60"
                >
                  {busy ? '查询中…' : '查询订单'}
                </button>
              </form>
              <div className="mt-5 text-[0.8rem] text-ink-mute">
                已有账号？
                <button
                  type="button"
                  className="font-bold text-teal hover:underline"
                  onClick={() => openAuth('login')}
                >
                  登录后查看全部订单
                </button>
              </div>
            </div>
          </section>
        ) : null}

        {showList ? (
          <>
            <div className="mt-[30px] flex gap-[26px] overflow-x-auto border-b border-[var(--line)]">
              {ORDER_LIST_FILTERS.map((tab) => {
                const n = counts[tab.id]
                const on = filter === tab.id
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setFilter(tab.id)}
                    className={`relative inline-flex h-11 shrink-0 items-center gap-1.5 bg-transparent px-0.5 text-[0.86rem] font-semibold ${
                      on ? 'text-ink after:absolute after:right-0 after:bottom-[-1px] after:left-0 after:h-0.5 after:bg-ink' : 'text-ink-mute hover:text-ink'
                    }`}
                  >
                    {tab.label}
                    <span className="font-[family-name:var(--font-mono)] text-[0.7rem] opacity-55">{n}</span>
                  </button>
                )
              })}
            </div>

            {isGuest && searched ? (
              <div className="mt-5 flex items-baseline justify-between gap-3 text-[0.78rem] text-ink-mute">
                <span>
                  <b className="font-[family-name:var(--font-mono)] font-bold text-ink-soft">{maskEmail(email)}</b> 的订单
                </span>
                <button type="button" className="font-semibold text-teal hover:underline" onClick={() => setSearched(false)}>
                  更换邮箱
                </button>
              </div>
            ) : null}

            {busy ? (
              <div className="py-16 text-center text-ink-mute">加载中…</div>
            ) : !visible.length ? (
              <div className="mt-[26px] rounded-3xl border border-dashed border-[var(--line-strong)] px-5 py-16 text-center text-ink-mute">
                <div className="mx-auto mb-3.5 grid h-[52px] w-[52px] place-items-center rounded-2xl bg-[rgba(232,241,238,.8)] text-ink-mute">
                  <Inbox className="h-6 w-6" strokeWidth={1.8} />
                </div>
                <p className="mb-3.5 text-[0.9rem]">{orders.length ? '该状态下暂无订单' : '暂无订单'}</p>
                <Link to="/#shop" className="font-bold text-teal hover:underline">
                  去商城逛逛
                </Link>
              </div>
            ) : (
              <div className="mt-[26px] grid gap-[18px]">
                {visible.map((o, i) => (
                  <OrderTicket key={o.id} order={o} delay={i * 45} />
                ))}
              </div>
            )}
          </>
        ) : null}
      </div>
    </main>
  )
}

function OrderTicket({ order, delay }: { order: Order; delay: number }) {
  const dead = isDeadStatus(order.status)
  const commission = isCommissionOrder(order)
  const covers = orderCovers(order)
  const flow = commission ? commissionFlowSegs(order.status) : null

  return (
    <Link
      to={`/orders/${order.id}`}
      className={`group block rounded-[20px] border border-[var(--line)] bg-white transition duration-300 [animation:riseIn_.5s_var(--ease)_both] hover:-translate-y-[3px] hover:border-[rgba(15,110,92,.45)] hover:shadow-[0_20px_42px_-32px_rgba(20,32,28,.4)] ${
        dead ? 'opacity-[.72]' : ''
      }`}
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex items-center justify-between gap-3 px-[22px] pt-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="font-[family-name:var(--font-mono)] text-[0.78rem] tracking-[-0.01em] text-ink-mute">{order.id}</span>
          {commission ? (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[rgba(15,110,92,.1)] px-2 py-0.5 text-[0.68rem] font-bold text-teal">
              <PenLine className="h-[11px] w-[11px]" strokeWidth={2} />
              约稿
            </span>
          ) : null}
        </div>
        <span className="shrink-0 font-[family-name:var(--font-mono)] text-[0.72rem] text-ink-mute">{fmtListTime(order.created_at)}</span>
      </div>

      <div className="flex min-w-0 items-center gap-4 px-[22px] pt-3.5 pb-[17px] max-[760px]:pb-3.5">
        <div className="flex shrink-0">
          {covers.map((c) => (
            <i key={`${c.tone}-${c.glyph}`} className={`order-cover ${c.tone}`}>
              <s>{c.glyph}</s>
            </i>
          ))}
        </div>
        <div className="min-w-0">
          <b className="block truncate text-[0.98rem] tracking-[-0.01em] font-bold max-[760px]:whitespace-normal">{orderTitle(order)}</b>
          <span className="mt-1 block text-[0.76rem] text-ink-mute">{orderSubtitle(order)}</span>
        </div>
      </div>

      <div className="order-ticket-tear" />

      <div className="flex items-center justify-between gap-3.5 px-[22px] pt-3.5 pb-[15px]">
        <div className="flex min-w-0 items-center gap-3.5">
          <span className={`inline-flex items-center gap-1.5 whitespace-nowrap text-[0.8rem] font-semibold ${ticketToneClass(order.status)}`}>
            <i className="h-[7px] w-[7px] shrink-0 rounded-full" />
            {orderCompactLabel(order.status)}
          </span>
          {flow ? (
            <span className="order-mini-flow" title="定金 · 交稿 · 尾款 · 完成">
              {flow.map((seg, i) => (
                <i key={i} className={seg} />
              ))}
            </span>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <b className="font-[family-name:var(--font-display)] text-[1.28rem] font-extrabold tracking-[-0.035em]">{formatMoney(order.total)}</b>
          <ChevronRight className="h-[17px] w-[17px] text-ink-mute transition group-hover:translate-x-[3px] group-hover:text-teal" strokeWidth={1.8} />
        </div>
      </div>
    </Link>
  )
}
