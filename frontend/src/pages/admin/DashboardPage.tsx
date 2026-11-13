import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight, MessageSquare, Plus, Wallet } from 'lucide-react'
import { ApiError, api } from '../../lib/api'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import {
  bucketOf,
  buyerKey,
  deltaPct,
  firstPaidAt,
  greet,
  inSpan,
  moneyOf,
  periodRange,
  relStamp,
  type PeriodId,
} from '../../lib/desk'
import { shanghaiHour, yuanText } from '../../lib/ledger'
import { orderStatusLabel } from '../../lib/orderStatus'
import type { Analytics, AnalyticsStock, Dashboard, LedgerRow } from '../../types'
import { AreaChart, Spark } from './deskCharts'
import '../../styles/admin.css'

const PERIODS: PeriodId[] = ['today', '7', '30', 'month']

function take(rows: LedgerRow[], from: Date, to: Date) {
  return rows.filter((r) => r.ok && inSpan(r.at, from, to))
}

function sums(rows: LedgerRow[], keys: string[], unit: 'hour' | 'day') {
  const full = new Map(keys.map((k) => [k, 0]))
  const com = new Map(keys.map((k) => [k, 0]))
  const orders = new Map(keys.map((k) => [k, new Set<string>()]))
  for (const row of rows) {
    const key = bucketOf(row.at, unit)
    if (!full.has(key)) continue
    if (row.kind === 'full') full.set(key, (full.get(key) || 0) + row.amount)
    else com.set(key, (com.get(key) || 0) + row.amount)
    orders.get(key)?.add(row.order_id)
  }
  return {
    full: keys.map((k) => full.get(k) || 0),
    com: keys.map((k) => com.get(k) || 0),
    orders: keys.map((k) => orders.get(k)?.size || 0),
  }
}

export function DashboardPage() {
  const { showToast } = useToast()
  const { user } = useAuth()
  const [dash, setDash] = useState<Dashboard | null>(null)
  const [analytics, setAnalytics] = useState<Analytics | null>(null)
  const [period, setPeriod] = useState<PeriodId>('30')

  useEffect(() => {
    api.get<Dashboard>('/api/dashboard').then(setDash).catch((e) => showToast(e instanceof ApiError ? e.message : '概览加载失败'))
    api.get<Analytics>('/api/analytics').then(setAnalytics).catch((e) => showToast(e instanceof ApiError ? e.message : '经营数据加载失败'))
  }, [showToast])

  const rows = analytics?.rows || []
  const stock: AnalyticsStock | undefined = analytics?.stock
  const range = periodRange(period)
  const cur = useMemo(() => take(rows, range.from, range.to), [rows, range.from, range.to])
  const prev = useMemo(() => take(rows, range.prevFrom, range.prevTo), [rows, range.prevFrom, range.prevTo])
  const shaped = useMemo(() => sums(cur, range.keys, range.unit), [cur, range.keys, range.unit])
  const first = useMemo(() => firstPaidAt(rows), [rows])

  if (!analytics || !dash) return <div className="px-1 py-2 text-ink-mute">加载中…</div>

  const rev = moneyOf(cur)
  const prevRev = moneyOf(prev)
  const orderN = new Set(cur.map((r) => r.order_id)).size
  const prevOrderN = new Set(prev.map((r) => r.order_id)).size
  const aov = orderN ? rev / orderN : 0
  const com = cur.filter((r) => r.kind !== 'full').reduce((a, r) => a + r.amount, 0)
  const full = rev - com
  const deposit = cur.filter((r) => r.kind === 'deposit').reduce((a, r) => a + r.amount, 0)
  const balance = cur.filter((r) => r.kind === 'balance').reduce((a, r) => a + r.amount, 0)
  const failed = rows.filter((r) => !r.ok && inSpan(r.at, range.from, range.to))
  const newcomers = [...first.entries()].filter(([, at]) => inSpan(at, range.from, range.to)).map(([k]) => k)
  const buyersNow = new Set(cur.map((r) => buyerKey(r)))
  const repeat = [...buyersNow].filter((k) => {
    const at = first.get(k)
    return at && new Date(at).getTime() < range.from.getTime()
  }).length
  const revSeries = shaped.full.map((v, i) => v + shaped.com[i])
  const peakI = revSeries.reduce((best, v, i) => (v > revSeries[best] ? i : best), 0)
  const buckets = range.unit === 'hour' ? Math.max(1, new Date().getHours() + 1) : range.keys.length
  const share = rev ? Math.round((com / rev) * 100) : 0

  const ranks = [
    ...cur
      .reduce((map, row) => {
        const key = row.product_id ? `p${row.product_id}` : row.item
        const hit = map.get(key) || {
          name: row.item,
          mode: row.sale_mode === 'commission' ? '约稿' : '成品',
          n: new Set<string>(),
          money: 0,
        }
        hit.n.add(row.order_id)
        hit.money += row.amount
        map.set(key, hit)
        return map
      }, new Map<string, { name: string; mode: string; n: Set<string>; money: number }>())
      .values(),
  ]
    .sort((a, b) => b.money - a.money)
    .slice(0, 6)
  const rankSum = ranks.reduce((a, r) => a + r.money, 0) || 1

  const channels = ['支付宝', '易支付', '微信', 'USDT', '其他', '—']
    .map((name) => ({ name, money: cur.filter((r) => r.channel === name).reduce((a, r) => a + r.amount, 0) }))
    .filter((c) => c.money > 0)

  const hours = Array.from({ length: 24 }, () => 0)
  for (const row of take(rows, periodRange('30').from, periodRange('30').to)) hours[shanghaiHour(row.at)] += row.amount
  const maxHour = Math.max(1, ...hours)
  const hotHour = hours.indexOf(Math.max(...hours))

  const month = periodRange('month')
  const monthRows = take(rows, month.from, month.to)
  const prevMonthRows = take(rows, month.prevFrom, month.prevTo)
  const monthRev = moneyOf(monthRows)
  const prevMonthRev = moneyOf(prevMonthRows)
  const monthOrders = new Set(monthRows.map((r) => r.order_id)).size
  const prevMonthOrders = new Set(prevMonthRows.map((r) => r.order_id)).size
  const monthNew = [...first.entries()].filter(([, at]) => inSpan(at, month.from, month.to)).length
  const prevMonthNew = [...first.entries()].filter(([, at]) => inSpan(at, month.prevFrom, month.prevTo)).length

  const parts = [
    ['成品全款', full, 'var(--teal)'],
    ['约稿定金', deposit, 'var(--gold)'],
    ['约稿尾款', balance, '#8a6a2f'],
  ] as const

  const revD = deltaPct(rev, prevRev)
  const ordD = deltaPct(orderN, prevOrderN)
  const writeD = {
    dir: stock?.writing_late ? ('down' as const) : ('flat' as const),
    text: stock?.writing_late ? `${stock.writing_late} 单超 7 日` : '全部正常',
  }
  const balD = {
    dir: stock?.balance_late ? ('down' as const) : ('flat' as const),
    text: `${stock?.balance_late || 0} 笔超 48 小时`,
  }

  const pulseItems = [
    { label: '实收', unit: range.label, val: yuanText(rev), d: revD, spark: revSeries },
    { label: '成单', unit: `客单 ${orderN ? yuanText(aov) : '—'}`, val: `${orderN} 笔`, d: ordD, spark: shaped.orders },
    { label: '在制约稿', unit: '当前在制', val: `${stock?.writing || 0} 单`, d: writeD, spark: undefined },
    { label: '待收尾款', unit: `${stock?.balance_count || 0} 笔待付`, val: yuanText(stock?.balance_money || 0), d: balD, spark: undefined },
  ]

  return (
    <div className="lx-desk -m-4 min-h-full bg-fog px-5 py-6 md:-m-6 md:px-7 md:py-7">
      <div className="desk-inner">
        <section className="dispatch-hero">
          <div>
            <div className="hero-top-meta">
              <span className="hero-badge">STUDIO DISPATCH</span>
              <span>实时经营调度台</span>
            </div>
            <h1>
              {greet()}，{user?.username || '店主'}
            </h1>
            <p className="lead">
              {range.label}实收 <b>{yuanText(rev)}</b>，共 <b>{orderN}</b> 笔成单，客单{' '}
              <b>{orderN ? yuanText(aov) : '—'}</b>。约稿占实收 {share}%。此刻还有{' '}
              <b>{stock?.balance_count || 0}</b> 笔尾款未收，合计 {yuanText(stock?.balance_money || 0)}。
            </p>
            <div className="hero-bar">
              <div className="dark-periods">
                {PERIODS.map((id) => (
                  <button key={id} type="button" className={period === id ? 'on' : ''} onClick={() => setPeriod(id)}>
                    {periodRange(id).label}
                  </button>
                ))}
              </div>
              <div className="quick-links">
                <Link to="/admin/conversations">
                  <MessageSquare className="h-3.5 w-3.5" />
                  回对话
                </Link>
                <Link to="/admin/products/new">
                  <Plus className="h-3.5 w-3.5" />
                  上新商品
                </Link>
                <Link to="/admin/revenue">
                  <Wallet className="h-3.5 w-3.5" />
                  看总账
                </Link>
              </div>
            </div>
          </div>

          <div className="pulse-grid" aria-label="核心经营脉搏">
            {pulseItems.map((it) => (
              <article className="pulse-card" key={it.label}>
                <div className="plbl">
                  <span>{it.label}</span>
                  <span>{it.unit}</span>
                </div>
                <div className="pval">{it.val}</div>
                <div className="psub">
                  <span className={`pdelta ${it.d.dir}`}>{it.d.text}</span>
                  {it.spark ? (
                    <span style={{ color: it.d.dir === 'down' ? '#fca5a5' : 'var(--mint)' }}>
                      <Spark values={it.spark} down={it.d.dir === 'down'} />
                    </span>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        </section>

        <div className="bento-top">
          <section className="lx-card">
            <div className="lx-card-head">
              <h2>
                实收走势
                <small>{range.unit === 'hour' ? '今日按小时 · 未到的钟点先空着' : `${range.label} · 按天`}</small>
              </h2>
              <Link to="/admin/revenue">营收账本</Link>
            </div>
            <div className="legend" style={{ marginTop: 10 }}>
              <span>
                <i className="cat" />
                成品全款
              </span>
              <span>
                <i className="com" />
                约稿收款
              </span>
            </div>
            <AreaChart
              labels={range.labels}
              series={[
                { values: shaped.full, fill: 'rgba(15,110,92,.82)' },
                { values: shaped.com, fill: 'rgba(196,165,116,.9)' },
              ]}
              tip={(i) => (
                <>
                  <b>{range.labels[i]}</b>
                  <div>成品 {yuanText(shaped.full[i] || 0)}</div>
                  <div>约稿 {yuanText(shaped.com[i] || 0)}</div>
                </>
              )}
            />
            <div className="chart-foot">
              <span>
                峰值 <b>{yuanText(revSeries[peakI] || 0)}</b> · {range.labels[peakI]}
              </span>
              <span>
                {range.unit === 'hour' ? '时均' : '日均'} <b>{yuanText(rev / buckets)}</b>
              </span>
              <span>
                约稿占比 <b>{share}%</b>
              </span>
              <span>
                新买家 <b>{newcomers.length}</b> 人
              </span>
            </div>
          </section>

          <section className="lx-card">
            <div className="lx-card-head">
              <h2>
                现在要处理
                <small>按轻重缓急排</small>
              </h2>
              <Link to="/admin/revenue?status=awaiting_balance#orders">尾款台账</Link>
            </div>
            <ul className="todo-stack">
              {dash.todos.map((t) => (
                <li key={t.key} className={`todo-card ${t.urgent && t.count > 0 ? 'hot' : ''}`}>
                  <Link to={t.to}>
                    <span className="tnum">{t.count}</span>
                    <span>
                      <b>{t.label}</b>
                      <small>{t.hint}</small>
                    </span>
                    <ChevronRight className="h-4 w-4 text-ink-mute" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <div className="bento-mid">
          <section className="lx-card">
            <div className="lx-card-head">
              <h2>
                约稿管道
                <small>当前在制不随范围变</small>
              </h2>
              <Link to="/admin/revenue?status=commission#orders">去营收</Link>
            </div>
            <Funnel
              steps={[
                ['本期定金', cur.filter((r) => r.kind === 'deposit').length, false, '已入账'],
                ['创作中', stock?.writing || 0, true, '当前'],
                ['待付尾款', stock?.balance_count || 0, true, '当前'],
                ['本期尾款', cur.filter((r) => r.kind === 'balance').length, false, '已入账'],
              ]}
            />
            <p className="funnel-note">
              管道里压着 <b>{yuanText(stock?.balance_money || 0)}</b> 尾款还没进账。创作中的 {stock?.writing || 0}{' '}
              单已收定金，其中 {stock?.writing_late || 0} 单超过一周。
            </p>
          </section>

          <section className="lx-card">
            <div className="lx-card-head">
              <h2>
                商品贡献
                <small>{range.label}</small>
              </h2>
              <Link to="/admin/products">全部商品</Link>
            </div>
            <ol className="rank-list">
              {ranks.length ? (
                ranks.map((r, i) => (
                  <li key={r.name}>
                    <span className="rk">{i + 1}</span>
                    <div className="nm">
                      <b>{r.name}</b>
                      <span>
                        {r.mode} · {r.n.size} 笔
                      </span>
                      <div className={`share ${r.mode === '约稿' ? 'gold' : ''}`}>
                        <i style={{ width: `${Math.round((r.money / rankSum) * 100)}%` }} />
                      </div>
                    </div>
                    <span className="amt">
                      {yuanText(r.money)}
                      <small>{Math.round((r.money / rankSum) * 100)}%</small>
                    </span>
                  </li>
                ))
              ) : (
                <li className="funnel-note" style={{ display: 'block', border: 0 }}>
                  这段时间没有入账
                </li>
              )}
            </ol>
          </section>

          <section className="lx-card">
            <div className="lx-card-head">
              <h2>结构与复购</h2>
              <Link to="/admin/payment">支付接入</Link>
            </div>
            <div className="mix">
              <div className="stack-title">
                <span>收款结构</span>
                <span style={{ color: 'var(--ink-mute)' }}>渠道 & 未入账</span>
              </div>
              <div className="mix-bar">
                {parts.map(([name, money, color]) => (
                  <i key={name} style={{ width: `${rev ? (money / rev) * 100 : 0}%`, background: color }} />
                ))}
              </div>
              <ul className="mix-key">
                {parts.map(([name, money, color]) => (
                  <li key={name}>
                    <span>
                      <i className="dot" style={{ background: color }} />
                      {name}
                    </span>
                    <b>
                      {yuanText(money)} · {rev ? Math.round((money / rev) * 100) : 0}%
                    </b>
                  </li>
                ))}
                {channels.map((c) => (
                  <li key={c.name}>
                    <span>
                      <i className="dot" style={{ background: '#14201c' }} />
                      {c.name}
                    </span>
                    <b>
                      {yuanText(c.money)} · {rev ? Math.round((c.money / rev) * 100) : 0}%
                    </b>
                  </li>
                ))}
                <li>
                  <span>未入账</span>
                  <b>
                    {failed.length} 笔 · {yuanText(failed.reduce((a, r) => a + r.amount, 0))}
                  </b>
                </li>
              </ul>
            </div>

            <div className="stack-sub">
              <div className="stack-title">
                <span>买家复购</span>
                <Link to="/admin/users" style={{ fontSize: '.72rem', color: 'var(--teal)' }}>
                  用户管理
                </Link>
              </div>
              <div className="mix-bar">
                <i
                  style={{
                    width: `${buyersNow.size ? ((buyersNow.size - repeat) / buyersNow.size) * 100 : 100}%`,
                    background: 'var(--mint)',
                  }}
                />
                <i
                  style={{
                    width: `${buyersNow.size ? (repeat / buyersNow.size) * 100 : 0}%`,
                    background: 'var(--teal)',
                  }}
                />
              </div>
              <ul className="mix-key">
                <li>
                  <span>
                    <i className="dot" style={{ background: 'var(--mint)' }} />
                    本期新买家
                  </span>
                  <b>{newcomers.length} 人</b>
                </li>
                <li>
                  <span>
                    <i className="dot" style={{ background: 'var(--teal)' }} />
                    其中再次下单
                  </span>
                  <b>
                    {repeat} 人{buyersNow.size ? ` · ${Math.round((repeat / buyersNow.size) * 100)}%` : ''}
                  </b>
                </li>
                <li>
                  <span>付费买家累计</span>
                  <b>{stock?.paying_users || 0}</b>
                </li>
                <li>
                  <span>复购买家累计</span>
                  <b>{stock?.repeat_users || 0}</b>
                </li>
              </ul>
            </div>
          </section>
        </div>

        <div className="bento-bot">
          <section className="lx-card">
            <div className="lx-card-head">
              <h2>
                最近订单动态
                <small>点开进营收对应凭单</small>
              </h2>
              <Link to="/admin/revenue#orders">全部订单</Link>
            </div>
            <div className="recent-list">
              {dash.recent_orders.map((o) => (
                <Link key={o.id} to={`/admin/revenue/${encodeURIComponent(o.id)}`}>
                  <span>
                    <b>{o.items.map((i) => i.name).join('、') || '订单'}</b>
                    <small className="mono">
                      {o.username} · {o.id}
                    </small>
                  </span>
                  <span className="text-[0.76rem] font-semibold text-ink-mute">{orderStatusLabel(o.status)}</span>
                  <span className="mono text-right font-bold">
                    {yuanText(o.total)}
                    <small style={{ fontWeight: 500 }}>{relStamp(o.created_at)}</small>
                  </span>
                </Link>
              ))}
            </div>
          </section>

          <section className="lx-card">
            <div className="lx-card-head">
              <h2>
                时段热力 & 月度对照
                <small>近 30 日</small>
              </h2>
            </div>
            <div className="hours" style={{ marginTop: 14 }}>
              {hours.map((v, h) => (
                <i
                  key={h}
                  className={v && v >= hours[hotHour] * 0.72 ? 'on' : ''}
                  style={{ height: `${Math.max(4, Math.round((v / maxHour) * 100))}%` }}
                  title={`${h}时 ${yuanText(v)}`}
                />
              ))}
            </div>
            <div className="hour-axis">
              <span>0</span>
              <span>6</span>
              <span>12</span>
              <span>18</span>
              <span>23</span>
            </div>
            <p className="funnel-note">近 30 日入账最多的钟点是 {hotHour} 时。</p>

            <div className="cmp-mini">
              <Compare label="本月实收" cur={yuanText(monthRev)} prev={yuanText(prevMonthRev)} />
              <Compare label="本月成单" cur={`${monthOrders} 笔`} prev={`${prevMonthOrders} 笔`} />
              <Compare
                label="本月客单"
                cur={monthOrders ? yuanText(monthRev / monthOrders) : '—'}
                prev={prevMonthOrders ? yuanText(prevMonthRev / prevMonthOrders) : '—'}
              />
              <Compare label="本月新买家" cur={`${monthNew} 人`} prev={`${prevMonthNew} 人`} />
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

function Funnel({ steps }: { steps: [string, number, boolean, string][] }) {
  const max = Math.max(1, ...steps.map((s) => s[1]))
  return (
    <ol className="pipe-list">
      {steps.map(([name, num, stock, hint]) => (
        <li key={name}>
          <span className="pname">
            {name}
            <em>{hint}</em>
          </span>
          <span className="pnum">{num}</span>
          <span className={`pipe-track ${stock ? 'gold' : ''}`}>
            <i style={{ width: `${Math.round((num / max) * 100)}%` }} />
          </span>
        </li>
      ))}
    </ol>
  )
}

function Compare({ label, cur, prev }: { label: string; cur: string; prev: string }) {
  return (
    <article className="cmp-cell">
      <div className="cl">{label}</div>
      <div className="cv">{cur}</div>
      <div className="cs">
        上月同期 <b>{prev}</b>
      </div>
    </article>
  )
}
