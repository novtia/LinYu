import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { SlidersHorizontal, X } from 'lucide-react'
import { ApiError, api } from '../../lib/api'
import { useToast } from '../../context/ToastContext'
import { daysBetween, eachDay, isoDay, matchRow, shanghaiDay, shanghaiHour, yuanText, type LedgerFilter } from '../../lib/ledger'
import { StackedBarChart } from './deskCharts'
import { OrdersPage } from './OrdersPage'
import type { Analytics } from '../../types'

const KINDS = [
  ['full', '成品全款'],
  ['deposit', '约稿定金'],
  ['balance', '约稿尾款'],
] as const
const CHANNELS = ['支付宝', '易支付', '微信', 'USDT', '其他', '—']

function defaultFilter(days = 30): LedgerFilter {
  const to = new Date()
  const from = days === 0 ? new Date(to.getFullYear(), to.getMonth(), 1) : new Date(to.getFullYear(), to.getMonth(), to.getDate() - (days - 1))
  return {
    from: isoDay(from),
    to: isoDay(to),
    min: null,
    max: null,
    q: '',
    kinds: new Set(KINDS.map((k) => k[0])),
    channels: new Set(CHANNELS),
    states: new Set(['ok', 'fail']),
  }
}

export function RevenuePage() {
  const { showToast } = useToast()
  const { id: openId = '' } = useParams()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [data, setData] = useState<Analytics | null>(null)
  const [applied, setApplied] = useState<LedgerFilter>(() => defaultFilter(30))
  const [draft, setDraft] = useState<LedgerFilter>(() => defaultFilter(30))
  const [quickRange, setQuickRange] = useState<'7' | '30' | 'month' | '90' | ''>('30')
  const [open, setOpen] = useState(false)
  const [bridgeDay, setBridgeDay] = useState('')
  const [bridgeChannel, setBridgeChannel] = useState('')

  useEffect(() => {
    const orderQ = searchParams.get('order')
    if (!orderQ || orderQ === openId) return
    const next = new URLSearchParams(searchParams)
    next.delete('order')
    const qs = next.toString()
    navigate(`/admin/revenue/${encodeURIComponent(orderQ)}${qs ? `?${qs}` : ''}`, { replace: true })
  }, [searchParams, openId, navigate])

  const loadAnalytics = useCallback(() => {
    api
      .get<Analytics>('/api/analytics')
      .then(setData)
      .catch((e) => showToast(e instanceof ApiError ? e.message : '营收数据加载失败'))
  }, [showToast])

  useEffect(() => {
    loadAnalytics()
  }, [loadAnalytics])

  const rows = data?.rows || []
  const matched = useMemo(() => rows.filter((r) => matchRow(r, applied)), [rows, applied])
  const days = useMemo(() => eachDay(applied.from, applied.to), [applied.from, applied.to])
  const paid = matched.filter((r) => r.ok)
  const failed = matched.filter((r) => !r.ok)
  const rev = paid.reduce((a, r) => a + r.amount, 0)
  const failSum = failed.reduce((a, r) => a + r.amount, 0)
  const fullSum = paid.filter((r) => r.kind === 'full').reduce((a, r) => a + r.amount, 0)
  const depSum = paid.filter((r) => r.kind === 'deposit').reduce((a, r) => a + r.amount, 0)
  const balSum = paid.filter((r) => r.kind === 'balance').reduce((a, r) => a + r.amount, 0)
  const comSum = depSum + balSum

  const byDay = useMemo(() => {
    const map = new Map<string, { full: number; deposit: number; balance: number; fail: number; n: number }>()
    for (const day of days) map.set(day, { full: 0, deposit: 0, balance: 0, fail: 0, n: 0 })
    for (const row of matched) {
      const b = map.get(shanghaiDay(row.at))
      if (!b) continue
      if (!row.ok) b.fail += row.amount
      else {
        b.n += 1
        if (row.kind === 'deposit') b.deposit += row.amount
        else if (row.kind === 'balance') b.balance += row.amount
        else b.full += row.amount
      }
    }
    return map
  }, [matched, days])

  const channels = useMemo(() => {
    return [...applied.channels]
      .map((name) => {
        const list = matched.filter((r) => r.channel === name)
        const got = list.filter((r) => r.ok)
        const bad = list.filter((r) => !r.ok)
        const money = got.reduce((a, r) => a + r.amount, 0)
        return {
          name,
          money,
          got: got.length,
          bad: bad.reduce((a, r) => a + r.amount, 0),
          rate: list.length ? Math.round((got.length / list.length) * 1000) / 10 : 0,
        }
      })
      .sort((a, b) => b.money - a.money)
  }, [matched, applied.channels])

  function switchRange(mode: '7' | '30' | 'month' | '90') {
    const to = new Date()
    const from =
      mode === 'month'
        ? new Date(to.getFullYear(), to.getMonth(), 1)
        : new Date(to.getFullYear(), to.getMonth(), to.getDate() - (Number(mode) - 1))
    setApplied((prev) => ({ ...prev, from: isoDay(from), to: isoDay(to) }))
    setQuickRange(mode)
  }

  function applyDraft() {
    if (!draft.kinds.size || !draft.channels.size || !draft.states.size) {
      showToast('款项、渠道、入账状态都至少留一项')
      return
    }
    if (draft.from > draft.to) {
      showToast('开始日期不能晚于结束日期')
      return
    }
    if (daysBetween(draft.from, draft.to) > 800) {
      showToast('一次最多筛选 800 天')
      return
    }
    if (draft.min != null && draft.max != null && draft.min > draft.max) {
      showToast('最小金额不能大于最大金额')
      return
    }
    setApplied({
      ...draft,
      kinds: new Set(draft.kinds),
      channels: new Set(draft.channels),
      states: new Set(draft.states),
    })
    setQuickRange('')
    setOpen(false)
  }

  const hours = useMemo(() => {
    const bins = Array.from({ length: 24 }, () => ({ full: 0, com: 0 }))
    for (const row of matched) {
      if (!row.ok) continue
      const h = shanghaiHour(row.at)
      if (row.kind === 'full') bins[h].full += row.amount
      else bins[h].com += row.amount
    }
    return bins
  }, [matched])
  const hourMax = Math.max(1, ...hours.map((h) => h.full + h.com))
  const hotHour = hours.reduce((best, h, i) => (h.full + h.com > hours[best].full + hours[best].com ? i : best), 0)

  function focusOrders(day: string, channel: string) {
    if (day) setBridgeDay((cur) => (cur === day ? '' : day))
    if (channel) setBridgeChannel((cur) => (cur === channel ? '' : channel))
    window.setTimeout(() => document.getElementById('orders')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0)
  }

  const chartDays = days.length > 48 ? days.filter((_, i) => i % Math.ceil(days.length / 36) === 0 || i === days.length - 1) : days
  const chartFull = chartDays.map((d) => byDay.get(d)?.full || 0)
  const chartDep = chartDays.map((d) => byDay.get(d)?.deposit || 0)
  const chartBal = chartDays.map((d) => byDay.get(d)?.balance || 0)

  let peakDay = days[0] || ''
  let peakVal = 0
  for (const d of days) {
    const b = byDay.get(d)
    const s = (b?.full || 0) + (b?.deposit || 0) + (b?.balance || 0)
    if (s > peakVal) {
      peakVal = s
      peakDay = d
    }
  }

  const v = Math.round(rev * 100) / 100
  const intPart = Math.trunc(v).toLocaleString('zh-CN')
  const fracPart = Math.round((v - Math.trunc(v)) * 100)
  const fullPct = rev ? Math.round((fullSum / rev) * 100) : 0
  const comPct = rev ? Math.round((comSum / rev) * 100) : 0
  const failBase = rev + failSum
  const failPct = failBase ? Math.round((failSum / failBase) * 100) : 0
  const showFail = applied.states.has('fail')
  const st = data?.stock

  const crossCells = [
    {
      lbl: '成品全款',
      color: 'var(--teal)',
      val: yuanText(fullSum),
      left: `${paid.filter((r) => r.kind === 'full').length} 笔`,
      right: `占实收 ${fullPct}%`,
      pct: fullPct,
    },
    {
      lbl: '约稿收款',
      color: 'var(--gold)',
      val: yuanText(comSum),
      left: `定 ${yuanText(depSum)}`,
      right: `尾 ${yuanText(balSum)}`,
      pct: comPct,
    },
    {
      lbl: '待收尾款 · 挂账',
      color: 'var(--warn)',
      val: yuanText(st?.balance_money || 0),
      left: `${st?.balance_count || 0} 笔待付`,
      right: `${st?.balance_late || 0} 笔超48h`,
      pct: Math.min(100, (st?.balance_count || 0) * 14),
    },
    {
      lbl: '未入账 · 损耗',
      color: 'var(--danger)',
      val: showFail ? yuanText(failSum) : '—',
      left: `${failed.length} 笔失败`,
      right: showFail ? `损耗率 ${failPct}%` : '已隐藏',
      pct: showFail ? failPct : 0,
    },
  ]

  return (
    <div className="lx-desk -m-4 min-h-full bg-fog px-5 py-6 md:-m-6 md:px-7 md:py-7">
      <div className="desk-inner">
        <section className="folio-head" id="books">
          <div>
            <div className="folio-kicker">
              <span className="pill">REVENUE FOLIO</span>
              <span>
                {applied.from} ~ {applied.to} · {matched.length} 条流水
              </span>
            </div>
            <div className="folio-title-row">
              <h1>实收总账</h1>
            </div>
            <div className="hero-money">
              ¥{intPart}
              {fracPart ? <span className="frac">.{String(fracPart).padStart(2, '0')}</span> : null}
            </div>
            <p className="hero-sub">
              {applied.from} 至 {applied.to}（共 {days.length} 天），共入账 <b>{paid.length}</b> 笔，日均{' '}
              <b>{yuanText(days.length ? rev / days.length : 0)}</b>。当前账外另有待收尾款{' '}
              <b>{yuanText(st?.balance_money || 0)}</b>。
            </p>
            <div className="folio-controls">
              <div className="range-pills" aria-label="快捷时间范围">
                {(
                  [
                    ['7', '近 7 日'],
                    ['30', '近 30 日'],
                    ['month', '本月'],
                    ['90', '近 90 日'],
                  ] as const
                ).map(([mode, label]) => (
                  <button key={mode} type="button" className={quickRange === mode ? 'on' : ''} onClick={() => switchRange(mode)}>
                    {label}
                  </button>
                ))}
              </div>
              <div className="head-actions">
                <nav className="jumps" aria-label="本页章节">
                  <a href="#books" onClick={(e) => { e.preventDefault(); document.getElementById('books')?.scrollIntoView({ behavior: 'smooth' }) }} className="on">
                    总账
                  </a>
                  <a href="#tape" onClick={(e) => { e.preventDefault(); document.getElementById('tape')?.scrollIntoView({ behavior: 'smooth' }) }}>
                    流水
                  </a>
                  <a href="#orders" onClick={(e) => { e.preventDefault(); document.getElementById('orders')?.scrollIntoView({ behavior: 'smooth' }) }}>
                    订单
                  </a>
                </nav>
                <button
                  type="button"
                  className="ghost-btn"
                  onClick={() => {
                    setDraft({
                      ...applied,
                      kinds: new Set(applied.kinds),
                      channels: new Set(applied.channels),
                      states: new Set(applied.states),
                    })
                    setOpen(true)
                  }}
                >
                  <SlidersHorizontal className="h-3.5 w-3.5" />
                  高级筛账
                </button>
              </div>
            </div>
          </div>

          <div className="cross-grid" aria-label="复式账目构成">
            {crossCells.map((c) => (
              <article className="cross-cell" key={c.lbl}>
                <div className="clbl">
                  <span>{c.lbl}</span>
                  <i style={{ background: c.color }} />
                </div>
                <div className="cval">{c.val}</div>
                <div className="cmeta">
                  <span>{c.left}</span>
                  <span>{c.right}</span>
                </div>
                <div className="cbar">
                  <b style={{ width: `${c.pct}%`, background: c.color }} />
                </div>
              </article>
            ))}
          </div>
        </section>

        <div className="spread">
          <section className="min-w-0">
            <div className="panel-top">
              <h2>
                日收款结构<small>成品 · 定金 · 尾款分段柱状</small>
              </h2>
              <div className="legend-inline">
                <span>
                  <i style={{ background: 'var(--teal)' }} />
                  成品全款
                </span>
                <span>
                  <i style={{ background: 'var(--gold)' }} />
                  约稿定金
                </span>
                <span>
                  <i style={{ background: 'var(--ink)' }} />
                  约稿尾款
                </span>
              </div>
            </div>

            <div className="bar-chart-box">
              <StackedBarChart
                labels={chartDays.map((d) => d.slice(5))}
                series={[
                  { values: chartFull, color: '#0f6e5c' },
                  { values: chartDep, color: '#c4a574' },
                  { values: chartBal, color: '#14201c' },
                ]}
                tip={(i) => (
                  <>
                    <b>{chartDays[i]}</b>
                    <div>成品 {yuanText(chartFull[i] || 0)}</div>
                    <div>
                      定金 {yuanText(chartDep[i] || 0)} · 尾款 {yuanText(chartBal[i] || 0)}
                    </div>
                  </>
                )}
              />
              <div className="chart-summary-strip">
                <div>
                  客单均价<b>{paid.length ? yuanText(rev / paid.length) : '—'}</b>
                </div>
                <div>
                  日均实收<b>{yuanText(days.length ? rev / days.length : 0)}</b>
                </div>
                <div>
                  约稿占比<b>{rev ? `${comPct}%` : '—'}</b>
                </div>
                <div>
                  单日峰值<b>{peakVal ? `${peakDay.slice(5)} · ${yuanText(peakVal)}` : '—'}</b>
                </div>
              </div>
            </div>

            <div className="ribbon-box">
              <div className="ribbon-head">
                <span>24 小时入账节律</span>
                <small>
                  {hours[hotHour].full + hours[hotHour].com
                    ? `峰值在 ${String(hotHour).padStart(2, '0')}:00（${yuanText(hours[hotHour].full + hours[hotHour].com)}）`
                    : '暂无入账时段数据'}
                </small>
              </div>
              <div className="ribbon-grid" aria-label="按钟点的入账">
                {hours.map((h, i) => {
                  const sum = h.full + h.com
                  const pct = sum ? Math.max(12, Math.round((sum / hourMax) * 100)) : 7
                  const bg = !sum ? 'rgba(20,32,28,.08)' : h.com >= h.full ? 'var(--gold)' : 'var(--teal)'
                  const op = !sum ? 1 : Number((0.35 + 0.65 * (sum / hourMax)).toFixed(2))
                  return (
                    <div
                      key={i}
                      className={`ribbon-cell${i === hotHour && sum ? ' hot' : ''}`}
                      title={`${i}:00 · 成品 ${yuanText(h.full)} · 约稿 ${yuanText(h.com)}`}
                    >
                      <div className="bar" style={{ height: `${pct}%`, background: bg, opacity: op }} />
                    </div>
                  )
                })}
              </div>
              <div className="ribbon-axis">
                <span>00:00</span>
                <span>06:00</span>
                <span>12:00</span>
                <span>18:00</span>
                <span>23:00</span>
              </div>
            </div>
          </section>

          <aside className="side-folio">
            <div className="panel-top" style={{ paddingBottom: 8 }}>
              <h2>
                收款渠道<small>点击联动下方订单</small>
              </h2>
              <Link to="/admin/payment" style={{ fontSize: '.76rem', fontWeight: 700, color: 'var(--teal)' }}>
                支付接入
              </Link>
            </div>
            <ul className="ch-list">
              {channels.map((c) => {
                const pct = rev && c.money ? (c.money / rev) * 100 : 0
                const share = !pct ? '0%' : pct < 1 ? '<1%' : `${Math.round(pct)}%`
                return (
                  <li
                    key={c.name}
                    onClick={() => focusOrders('', c.name)}
                    className={`ch-item ${bridgeChannel === c.name ? 'on' : ''}`}
                  >
                    <div className="top">
                      <b>{c.name}</b>
                      <span>{yuanText(c.money)}</span>
                    </div>
                    <div className="bar-track">
                      <i style={{ width: `${Math.min(100, pct).toFixed(1)}%` }} />
                    </div>
                    <div className="meta">
                      <span>占比 {share}</span>
                      <span>{c.got} 笔</span>
                      <span>成功率 {c.rate}%</span>
                    </div>
                  </li>
                )
              })}
            </ul>
            <p className="mt-3 text-[0.74rem] text-ink-mute">
              待收尾款 {st?.balance_count || 0} 笔，其中 {st?.balance_late || 0} 笔超过 48 小时未结清。
            </p>

            <div className="panel-top" style={{ marginTop: 22, paddingBottom: 8 }}>
              <h2>
                每日结算<small>点日期查当天订单</small>
              </h2>
            </div>
            <div className="daybook">
              <table>
                <thead>
                  <tr>
                    <th>日期</th>
                    {applied.kinds.has('full') ? <th className="num">成品</th> : null}
                    {applied.kinds.has('deposit') ? <th className="num">定金</th> : null}
                    {applied.kinds.has('balance') ? <th className="num">尾款</th> : null}
                    <th className="num">实收</th>
                    {showFail ? <th className="num">未入账</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {[...days].reverse().map((day) => {
                    const b = byDay.get(day)!
                    const line = b.full + b.deposit + b.balance
                    return (
                      <tr
                        key={day}
                        onClick={() => focusOrders(day, '')}
                        className={bridgeDay === day ? 'on' : ''}
                      >
                        <td className="text-ink-mute">{day.slice(5)}</td>
                        {applied.kinds.has('full') ? <td className="num">{b.full ? yuanText(b.full) : '—'}</td> : null}
                        {applied.kinds.has('deposit') ? <td className="num">{b.deposit ? yuanText(b.deposit) : '—'}</td> : null}
                        {applied.kinds.has('balance') ? <td className="num">{b.balance ? yuanText(b.balance) : '—'}</td> : null}
                        <td className="num font-bold">{yuanText(line)}</td>
                        {showFail ? <td className="num">{b.fail ? yuanText(b.fail) : '—'}</td> : null}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </aside>
        </div>

        <section className="tape-section" id="tape">
          <div className="panel-top">
            <h2>
              实时入账凭条
              <small>
                展示最新 {Math.min(matched.length, 12)} / {matched.length} 张凭条 · 点击定位订单
              </small>
            </h2>
          </div>
          {matched.length ? (
            <div className="tape-rail">
              {matched.slice(0, 12).map((r) => (
                <Link
                  key={`${r.order_id}-${r.kind}-${r.at}-${r.ok}`}
                  to={`/admin/revenue/${encodeURIComponent(r.order_id)}${searchParams.toString() ? `?${searchParams}` : ''}`}
                  className={`ticket ${r.ok ? '' : 'bad'} ${openId === r.order_id ? 'on' : ''}`}
                >
                  <div className="t-top">
                    <span className="t-kind">{r.ok ? kindName(r.kind) : '未入账'}</span>
                    <span className="t-amt">
                      {r.ok ? '' : '−'}
                      {yuanText(r.amount)}
                    </span>
                  </div>
                  <div className="t-who">
                    {r.buyer} · {r.item}
                  </div>
                  <div className="t-bot">
                    <span>{r.order_id}</span>
                    <span>
                      {r.channel} · {shanghaiDay(r.at).slice(5)} {String(r.at).slice(11, 16)}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <p className="py-8 text-[0.86rem] text-ink-mute">没有符合条件的入账凭条</p>
          )}
        </section>

        <OrdersPage
          bridgeDay={bridgeDay}
          bridgeChannel={bridgeChannel}
          onClearDay={() => setBridgeDay('')}
          onClearChannel={() => setBridgeChannel('')}
          onOrdersChanged={loadAnalytics}
        />

        {open ? <FilterDialog draft={draft} setDraft={setDraft} onClose={() => setOpen(false)} onApply={applyDraft} /> : null}
      </div>
    </div>
  )
}

function kindName(kind: string) {
  if (kind === 'deposit') return '约稿定金'
  if (kind === 'balance') return '约稿尾款'
  return '成品全款'
}

function FilterDialog({
  draft,
  setDraft,
  onClose,
  onApply,
}: {
  draft: LedgerFilter
  setDraft: (f: LedgerFilter) => void
  onClose: () => void
  onApply: () => void
}) {
  function toggle(key: 'kinds' | 'channels' | 'states', value: string) {
    const next = new Set(draft[key])
    if (next.has(value)) next.delete(value)
    else next.add(value)
    setDraft({ ...draft, [key]: next })
  }
  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-[rgba(20,32,28,.46)] p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        className="max-h-[86vh] w-[min(880px,100%)] overflow-auto border border-[var(--line-strong)] bg-[#f7fbf9] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--line)] pb-3">
          <h2 className="font-[family-name:var(--font-display)] text-[1.2rem] font-bold">筛选账本</h2>
          <button type="button" aria-label="关闭" onClick={onClose}>
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <label className="grid gap-1">
            <span className="text-[0.76rem] font-bold text-ink-soft">开始日期</span>
            <input
              type="date"
              className="border-b border-[var(--line-strong)] bg-transparent py-2 outline-none"
              value={draft.from}
              onChange={(e) => setDraft({ ...draft, from: e.target.value })}
            />
          </label>
          <label className="grid gap-1">
            <span className="text-[0.76rem] font-bold text-ink-soft">结束日期</span>
            <input
              type="date"
              className="border-b border-[var(--line-strong)] bg-transparent py-2 outline-none"
              value={draft.to}
              onChange={(e) => setDraft({ ...draft, to: e.target.value })}
            />
          </label>
          <label className="grid gap-1">
            <span className="text-[0.76rem] font-bold text-ink-soft">最小金额</span>
            <input
              type="number"
              min={0}
              className="border-b border-[var(--line-strong)] bg-transparent py-2 outline-none"
              value={draft.min ?? ''}
              placeholder="不限"
              onChange={(e) => setDraft({ ...draft, min: e.target.value === '' ? null : Number(e.target.value) })}
            />
          </label>
          <label className="grid gap-1">
            <span className="text-[0.76rem] font-bold text-ink-soft">最大金额</span>
            <input
              type="number"
              min={0}
              className="border-b border-[var(--line-strong)] bg-transparent py-2 outline-none"
              value={draft.max ?? ''}
              placeholder="不限"
              onChange={(e) => setDraft({ ...draft, max: e.target.value === '' ? null : Number(e.target.value) })}
            />
          </label>
          <label className="grid gap-1 md:col-span-2">
            <span className="text-[0.76rem] font-bold text-ink-soft">买家、订单号或商品</span>
            <input
              className="border-b border-[var(--line-strong)] bg-transparent py-2 outline-none"
              value={draft.q}
              placeholder="留空表示不限"
              onChange={(e) => setDraft({ ...draft, q: e.target.value.trim().toLowerCase() })}
            />
          </label>
        </div>
        <CheckRow title="入账状态" options={[['ok', '已入账'], ['fail', '未入账']]} selected={draft.states} onToggle={(v) => toggle('states', v)} />
        <CheckRow title="款项" options={KINDS} selected={draft.kinds} onToggle={(v) => toggle('kinds', v)} />
        <CheckRow title="渠道" options={CHANNELS.map((c) => [c, c] as const)} selected={draft.channels} onToggle={(v) => toggle('channels', v)} />
        <div className="mt-4 flex justify-end gap-2 border-t border-[var(--line)] pt-3">
          <button type="button" className="h-9 rounded-[10px] border border-[var(--line-strong)] px-3 text-[0.82rem] font-semibold" onClick={() => setDraft(defaultFilter(30))}>
            恢复默认
          </button>
          <button type="button" className="h-9 rounded-[10px] border border-[var(--line-strong)] px-3 text-[0.82rem] font-semibold" onClick={onClose}>
            取消
          </button>
          <button type="button" className="h-9 rounded-[10px] bg-teal px-3 text-[0.82rem] font-bold text-white" onClick={onApply}>
            应用
          </button>
        </div>
      </div>
    </div>
  )
}

function CheckRow({
  title,
  options,
  selected,
  onToggle,
}: {
  title: string
  options: readonly (readonly [string, string])[]
  selected: Set<string>
  onToggle: (v: string) => void
}) {
  return (
    <div className="mt-3">
      <div className="text-[0.76rem] font-bold text-ink-soft">{title}</div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
        {options.map(([value, label]) => (
          <label key={value} className="inline-flex items-center gap-1.5 text-[0.84rem] font-semibold">
            <input type="checkbox" className="accent-teal" checked={selected.has(value)} onChange={() => onToggle(value)} />
            {label}
          </label>
        ))}
      </div>
    </div>
  )
}
