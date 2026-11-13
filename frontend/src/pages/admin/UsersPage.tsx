import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Search } from 'lucide-react'
import { ApiError, api } from '../../lib/api'
import { fmtBeijingMonthDayClock } from '../../lib/time'
import { firstPaidAt } from '../../lib/desk'
import { addDays, eachDay, isoDay, shanghaiDay, yuanText } from '../../lib/ledger'
import { useToast } from '../../context/ToastContext'
import { TwinBars } from './deskCharts'
import type { Analytics, LedgerRow, User } from '../../types'

interface ResetPasswordRes {
  password: string
  message: string
}

function fmtTime(iso: string) {
  return fmtBeijingMonthDayClock(iso)
}

export function UsersPage() {
  const { showToast } = useToast()
  const [users, setUsers] = useState<User[]>([])
  const [rows, setRows] = useState<LedgerRow[]>([])
  const [stock, setStock] = useState<Analytics['stock'] | null>(null)
  const [issued, setIssued] = useState<{ username: string; password: string } | null>(null)
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<'all' | 'pay' | 'repeat' | 'new' | 'off'>('all')
  const [range, setRange] = useState<'7' | '30'>('30')
  const [activeId, setActiveId] = useState<string | null>(null)

  async function load() {
    setUsers(await api.get<User[]>('/api/users'))
  }

  useEffect(() => {
    load().catch((e) => {
      setUsers([])
      showToast(e instanceof ApiError ? e.message : '用户列表加载失败')
    })
    api
      .get<Analytics>('/api/analytics')
      .then((a) => {
        setStock(a.stock)
        setRows(a.rows)
      })
      .catch(() => setStock(null))
  }, [showToast])

  async function resetPassword(u: User) {
    if (!window.confirm(`确定重置「${u.username}」的密码？重置后该账号的登录状态会失效。`)) return
    try {
      const res = await api.post<ResetPasswordRes>(`/api/users/${u.username}/reset-password`)
      setIssued({ username: u.username, password: res.password })
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : '重置失败')
    }
  }

  async function toggle(u: User) {
    try {
      await api.post(`/api/users/${u.username}/toggle`)
      await load()
      showToast(u.disabled ? '已启用' : '已禁用')
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : '操作失败')
    }
  }

  const paid = useMemo(() => rows.filter((r) => r.ok), [rows])
  const spend = useMemo(() => {
    const map = new Map<string, { n: Set<string>; money: number; last: string }>()
    for (const row of paid) {
      const key = row.buyer
      const hit = map.get(key) || { n: new Set<string>(), money: 0, last: row.at }
      hit.n.add(row.order_id)
      hit.money += row.amount
      if (row.at > hit.last) hit.last = row.at
      map.set(key, hit)
    }
    return map
  }, [paid])

  const first = useMemo(() => firstPaidAt(paid), [paid])
  const members = useMemo(() => users.filter((u) => u.role !== 'admin'), [users])
  const disabledN = members.filter((u) => u.disabled).length
  const totalSpend = members.reduce((a, u) => a + (spend.get(u.username)?.money || 0), 0)

  const windowDays = useMemo(() => {
    const n = range === '7' ? 7 : 14
    const to = isoDay(new Date())
    const from = isoDay(addDays(new Date(), -(n - 1)))
    return eachDay(from, to)
  }, [range])

  const regSince = isoDay(addDays(new Date(), range === '7' ? -6 : -29))
  const freshCount = members.filter((u) => shanghaiDay(u.created_at) >= regSince).length
  const firstCount = [...first.values()].filter((at) => shanghaiDay(at) >= regSince).length
  const convRate = freshCount ? Math.round((firstCount / freshCount) * 100) : 0

  const regSeries = useMemo(
    () => windowDays.map((d) => members.filter((u) => shanghaiDay(u.created_at) === d).length),
    [windowDays, members],
  )
  const buySeries = useMemo(
    () => windowDays.map((d) => [...first.values()].filter((at) => shanghaiDay(at) === d).length),
    [windowDays, first],
  )

  const payingUsers = stock?.paying_users || members.filter((u) => (spend.get(u.username)?.n.size || 0) >= 1).length
  const repeatUsers = stock?.repeat_users || members.filter((u) => (spend.get(u.username)?.n.size || 0) >= 2).length
  const payPct = members.length ? Math.round((payingUsers / members.length) * 100) : 0
  const repeatPct = payingUsers ? Math.round((repeatUsers / payingUsers) * 100) : 0

  const cohorts = [
    ['all', '全站会员', '不含管理员', `${members.length} 人`, 100, 'var(--ink)'],
    ['pay', '付费买家', '至少付过一笔', `${payingUsers} 人 · ${payPct}%`, payPct, 'var(--teal)'],
    ['repeat', '复购铁粉', '下单 ≥ 2 次', `${repeatUsers} 人 · ${repeatPct}%`, repeatPct, 'var(--gold)'],
    ['off', '已禁用账号', '限制登录', `${disabledN} 人`, Math.max(4, disabledN * 8), 'var(--danger)'],
  ] as const

  const shown = members.filter((u) => {
    const book = spend.get(u.username)
    const orders = book?.n.size || 0
    if (filter === 'pay' && orders < 1) return false
    if (filter === 'repeat' && orders < 2) return false
    if (filter === 'new' && orders > 0) return false
    if (filter === 'off' && !u.disabled) return false
    if (q && !`${u.username} ${u.email || ''}`.toLowerCase().includes(q.toLowerCase())) return false
    return true
  })
  const active = members.find((u) => u.id === activeId) || shown[0] || null
  const activeBook = active ? spend.get(active.username) : undefined
  const activeOrders = activeBook?.n.size || 0
  const activeMoney = activeBook?.money || 0

  return (
    <div className="lx-desk -m-4 min-h-full bg-fog px-5 py-6 md:-m-6 md:px-7 md:py-7">
      <div className="desk-inner">
        <section className="user-hero">
          <div>
            <div className="u-kicker">
              <span className="badge">READER ROSTER</span>
              <span>点左侧分层可直接筛选下方花名册</span>
            </div>
            <h1>读者与买家名册</h1>
            <p className="lead">
              全站会员 <b>{members.length}</b> 人，付过钱的 <b>{payingUsers}</b> 人，复购率 <b>{repeatPct}%</b>。当前名单消费合计{' '}
              <b>{yuanText(totalSpend)}</b>。
            </p>
            <div className="cohort-stack">
              {cohorts.map(([f, lbl, sub, val, pct, color]) => (
                <button key={f} type="button" className={`cohort-btn ${filter === f ? 'on' : ''}`} onClick={() => setFilter(f)}>
                  <span className="clbl">
                    {lbl}
                    <small>{sub}</small>
                  </span>
                  <span className="ctrack">
                    <i style={{ width: `${pct}%`, background: color }} />
                  </span>
                  <span className="cval">{val}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="reg-card">
            <div>
              <div className="reg-head">
                <h2>
                  新增与首购转化{' '}
                  <small style={{ fontFamily: 'var(--font-body)', fontSize: '.73rem', color: 'var(--ink-mute)', fontWeight: 500 }}>
                    {range === '7' ? '近 7 天每日表现' : '近 14 天走势'}
                  </small>
                </h2>
                <div className="seg-pills">
                  <button type="button" className={range === '7' ? 'on' : ''} onClick={() => setRange('7')}>
                    近 7 日
                  </button>
                  <button type="button" className={range === '30' ? 'on' : ''} onClick={() => setRange('30')}>
                    近 30 日
                  </button>
                </div>
              </div>
              <div className="reg-stats">
                <div>
                  本期新注册<b>{freshCount} 人</b>
                </div>
                <div>
                  其中首购成交<b>{firstCount} 人</b>
                </div>
                <div>
                  首购转化率<b style={{ color: 'var(--teal)' }}>{convRate}%</b>
                </div>
              </div>
            </div>
            <div>
              <div className="legend" style={{ marginTop: 12 }}>
                <span>
                  <i className="cat" style={{ opacity: 0.25 }} />
                  新注册
                </span>
                <span>
                  <i className="cat" />
                  其中完成首购
                </span>
              </div>
              <TwinBars reg={regSeries} buy={buySeries} labels={windowDays.map((d) => d.slice(5))} />
            </div>
          </div>
        </section>

        {issued ? (
          <div className="issued">
            已为「{issued.username}」生成新密码 <code>{issued.password}</code>
            <button
              type="button"
              className="ghost-btn"
              style={{ marginLeft: 8, height: 30 }}
              onClick={() => {
                navigator.clipboard?.writeText(issued.password)
                showToast('密码已复制')
              }}
            >
              复制
            </button>
            <button type="button" className="line-btn" style={{ marginLeft: 8, height: 30 }} onClick={() => setIssued(null)}>
              我已记录
            </button>
            <p className="funnel-note">仅本次显示，请转达用户并提醒其尽快修改。</p>
          </div>
        ) : null}

        <div className="user-stage">
          <div>
            <div className="u-toolbar">
              <label className="search">
                <Search className="h-3.5 w-3.5 text-ink-mute" />
                <input value={q} placeholder="搜索用户名或邮箱…" onChange={(e) => setQ(e.target.value)} />
              </label>
              <div className="chips">
                {(['all', 'pay', 'repeat', 'new', 'off'] as const).map((id) => {
                  const labels: Record<string, string> = { all: '全部', pay: '付费', repeat: '复购', new: '只注册', off: '禁用' }
                  return (
                    <button key={id} type="button" className={filter === id ? 'on' : ''} onClick={() => setFilter(id)}>
                      {labels[id]}
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="u-sheet-card">
              <table className="sheet">
                <thead>
                  <tr>
                    <th>读者</th>
                    <th>订单</th>
                    <th>累计消费</th>
                    <th>最近活跃</th>
                    <th>身份标签</th>
                    <th style={{ textAlign: 'right' }}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((u) => {
                    const book = spend.get(u.username)
                    const orders = book?.n.size || 0
                    const money = book?.money || 0
                    const avaCls = u.disabled ? 'off' : orders >= 2 ? 'vip' : ''
                    return (
                      <tr key={u.id} className={active?.id === u.id ? 'on' : ''} onClick={() => setActiveId(u.id)}>
                        <td>
                          <div className="u-ident">
                            <span className={`u-ava ${avaCls}`}>{u.username.slice(0, 1).toUpperCase()}</span>
                            <div className="min-w-0">
                              <span className="name">{u.username}</span>
                              <span className="sub">
                                {u.email || '无邮箱'} · {fmtTime(u.created_at)}
                              </span>
                            </div>
                          </div>
                        </td>
                        <td className="mono">{orders}</td>
                        <td className="mono font-bold">{yuanText(money)}</td>
                        <td className="mono text-ink-mute">{book ? fmtTime(book.last) : '—'}</td>
                        <td>
                          {u.disabled ? (
                            <span className="tag danger">禁用</span>
                          ) : orders >= 2 ? (
                            <span className="tag">复购</span>
                          ) : money > 0 ? (
                            <span className="tag gold">付费</span>
                          ) : (
                            <span className="tag mute">未付</span>
                          )}
                        </td>
                        <td className="ops" style={{ justifyContent: 'flex-end' }}>
                          <button type="button" onClick={(e) => { e.stopPropagation(); void resetPassword(u) }}>
                            重置密码
                          </button>
                          <button
                            type="button"
                            className="danger"
                            onClick={(e) => {
                              e.stopPropagation()
                              void toggle(u)
                            }}
                          >
                            {u.disabled ? '启用' : '禁用'}
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {!shown.length ? <p className="empty" style={{ padding: '28px 16px' }}>没有匹配的用户</p> : null}
            </div>
          </div>

          <aside className="dossier" aria-label="读者档案夹">
            {active ? (
              <>
                <div className="dossier-kicker">
                  <span>读者档案夹</span>
                  {active.disabled ? (
                    <span className="tag danger">已禁用</span>
                  ) : activeOrders >= 2 ? (
                    <span className="tag">复购读者</span>
                  ) : activeMoney > 0 ? (
                    <span className="tag gold">已付费</span>
                  ) : (
                    <span className="tag mute">暂未消费</span>
                  )}
                </div>
                <div className="dossier-head">
                  <div className="dossier-ava">{active.username.slice(0, 1).toUpperCase()}</div>
                  <div className="min-w-0">
                    <h3>{active.username}</h3>
                    <div className="meta">
                      {active.email || '无邮箱'} · {fmtTime(active.created_at)} 注册
                    </div>
                  </div>
                </div>
                <div className="dossier-metrics">
                  <div className="dm-box">
                    <small>累计订单</small>
                    <b>{activeOrders} 笔</b>
                  </div>
                  <div className="dm-box">
                    <small>累计消费</small>
                    <b>{yuanText(activeMoney)}</b>
                  </div>
                  <div className="dm-box">
                    <small>客单均价</small>
                    <b>{activeOrders ? yuanText(Math.round(activeMoney / activeOrders)) : '—'}</b>
                  </div>
                  <div className="dm-box">
                    <small>最近活跃</small>
                    <b>{activeBook ? fmtTime(activeBook.last) : '—'}</b>
                  </div>
                </div>
                <div className="dossier-acts">
                  <Link className="teal-btn full" to={`/admin/revenue?q=${encodeURIComponent(active.username)}#orders`}>
                    查看名下订单
                  </Link>
                  <button type="button" className="line-btn" onClick={() => void resetPassword(active)}>
                    重置密码
                  </button>
                  <button type="button" className={`line-btn ${active.disabled ? '' : 'danger'}`} onClick={() => void toggle(active)}>
                    {active.disabled ? '恢复启用' : '禁用账号'}
                  </button>
                </div>
              </>
            ) : (
              <p className="empty">还没有用户</p>
            )}
          </aside>
        </div>
      </div>
    </div>
  )
}
