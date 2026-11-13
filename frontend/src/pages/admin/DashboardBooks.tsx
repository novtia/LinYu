import { Link } from 'react-router-dom'
import { addDays, isoDay, matchRow, shanghaiHour, yuanText, type LedgerFilter } from '../../lib/ledger'
import type { AnalyticsStock, LedgerRow } from '../../types'

export function DashboardBooks({
  rows,
  stock,
  range,
}: {
  rows: LedgerRow[]
  stock: AnalyticsStock
  range: number
}) {
  const to = isoDay(new Date())
  const from = isoDay(addDays(new Date(), -(range - 1)))
  const filter: LedgerFilter = {
    from,
    to,
    min: null,
    max: null,
    q: '',
    kinds: new Set(['full', 'deposit', 'balance']),
    channels: new Set(['支付宝', '易支付', '微信', 'USDT', '其他', '—']),
    states: new Set(['ok']),
  }
  const paid = rows.filter((r) => matchRow(r, filter))
  const rev = paid.reduce((a, r) => a + r.amount, 0)
  const commission = paid.filter((r) => r.kind === 'deposit' || r.kind === 'balance').reduce((a, r) => a + r.amount, 0)
  const share = rev ? Math.round((commission / rev) * 100) : 0

  const channels = ['支付宝', '易支付', '微信', 'USDT', '其他', '—']
    .map((name) => ({ name, money: paid.filter((r) => r.channel === name).reduce((a, r) => a + r.amount, 0) }))
    .filter((c) => c.money > 0)

  const ranks = new Map<string, { name: string; mode: string; n: number; money: number }>()
  for (const row of paid) {
    const key = row.product_id ? `p${row.product_id}` : row.item
    const cur = ranks.get(key) || { name: row.item, mode: row.sale_mode, n: 0, money: 0 }
    cur.n += 1
    cur.money += row.amount
    ranks.set(key, cur)
  }
  const top = [...ranks.values()].sort((a, b) => b.money - a.money).slice(0, 6)

  const hours = Array.from({ length: 24 }, () => 0)
  for (const row of paid) hours[shanghaiHour(row.at)] += row.amount
  const maxHour = Math.max(1, ...hours)

  return (
    <section className="mt-11">
      <div className="flex items-baseline justify-between gap-3 border-b border-[var(--line)] pb-3">
        <h2 className="font-[family-name:var(--font-display)] text-[1.12rem] tracking-[-0.02em]">
          经营
          <small className="ml-2.5 font-[family-name:var(--font-body)] text-[0.76rem] font-medium tracking-normal text-ink-mute">
            近 {range} 日实收 {yuanText(rev)} · 约稿占 {share}%
          </small>
        </h2>
        <Link to="/admin/revenue" className="text-[0.8rem] font-bold text-teal hover:text-teal-deep">
          营收明细
        </Link>
      </div>
      <div className="mt-4 grid gap-8 lg:grid-cols-2">
        <div>
          <h3 className="text-[0.78rem] font-bold tracking-[0.04em] text-ink-soft">约稿管道</h3>
          <ul className="mt-2 text-[0.84rem]">
            <Pipe to="/admin/revenue?status=deposit_paid#orders" label="在制" value={`${stock.writing} 笔`} hint={stock.writing_late ? `${stock.writing_late} 笔超过 7 日` : '没有超期'} />
            <Pipe to="/admin/revenue?status=awaiting_balance#orders" label="待收尾款" value={yuanText(stock.balance_money)} hint={`${stock.balance_count} 笔 · ${stock.balance_late} 笔超过 48 小时`} />
            <Pipe to="/admin/revenue?status=pending#orders" label="待支付" value={`${stock.pending_pay} 笔`} hint="还没入账" />
          </ul>
        </div>
        <div>
          <h3 className="text-[0.78rem] font-bold tracking-[0.04em] text-ink-soft">渠道</h3>
          <ul className="mt-2">
            {channels.length ? (
              channels.map((c) => (
                <li key={c.name} className="flex items-center justify-between border-b border-[var(--line)] py-2 text-[0.84rem]">
                  <span>{c.name}</span>
                  <b className="font-[family-name:var(--font-mono)]">
                    {yuanText(c.money)}
                    <span className="ml-2 font-medium text-ink-mute">{rev ? Math.round((c.money / rev) * 100) : 0}%</span>
                  </b>
                </li>
              ))
            ) : (
              <li className="py-3 text-[0.82rem] text-ink-mute">这段时间没有入账</li>
            )}
          </ul>
        </div>
        <div>
          <h3 className="text-[0.78rem] font-bold tracking-[0.04em] text-ink-soft">商品贡献</h3>
          <ul className="mt-2">
            {top.length ? (
              top.map((r) => (
                <li key={r.name} className="flex items-center justify-between gap-3 border-b border-[var(--line)] py-2 text-[0.84rem]">
                  <span className="min-w-0 truncate">
                    {r.name}
                    <em className="ml-2 text-[0.72rem] font-medium text-ink-mute not-italic">{r.mode === 'commission' ? '约稿' : '成品'} · {r.n} 笔</em>
                  </span>
                  <b className="shrink-0 font-[family-name:var(--font-mono)]">{yuanText(r.money)}</b>
                </li>
              ))
            ) : (
              <li className="py-3 text-[0.82rem] text-ink-mute">这段时间没有入账</li>
            )}
          </ul>
        </div>
        <div>
          <h3 className="text-[0.78rem] font-bold tracking-[0.04em] text-ink-soft">入账时段</h3>
          <div className="mt-3 flex h-[92px] items-end gap-[3px]">
            {hours.map((v, h) => (
              <div key={h} className="group relative flex h-full min-w-0 flex-1 items-end" title={`${h}时 ${yuanText(v)}`}>
                <div className="w-full rounded-t-sm bg-paper group-hover:bg-teal" style={{ height: `${v ? Math.max(6, Math.round((v / maxHour) * 100)) : 2}%` }} />
              </div>
            ))}
          </div>
          <div className="mt-1 flex justify-between font-[family-name:var(--font-mono)] text-[0.64rem] text-ink-mute">
            <span>0</span>
            <span>6</span>
            <span>12</span>
            <span>18</span>
            <span>23</span>
          </div>
        </div>
      </div>
    </section>
  )
}

function Pipe({ to, label, value, hint }: { to: string; label: string; value: string; hint: string }) {
  return (
    <li className="border-b border-[var(--line)]">
      <Link to={to} className="flex items-baseline justify-between gap-3 py-2.5 hover:text-teal">
        <span>
          {label}
          <em className="mt-0.5 block text-[0.72rem] font-medium text-ink-mute not-italic">{hint}</em>
        </span>
        <b className="font-[family-name:var(--font-mono)]">{value}</b>
      </Link>
    </li>
  )
}
