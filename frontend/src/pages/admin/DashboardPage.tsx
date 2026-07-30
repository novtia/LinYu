import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../../lib/api'
import type { Dashboard } from '../../types'

function fmtTime(iso: string) {
  const d = new Date(iso)
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function DashboardPage() {
  const [data, setData] = useState<Dashboard | null>(null)

  useEffect(() => {
    api.get<Dashboard>('/api/dashboard').then(setData).catch(() => setData(null))
  }, [])

  if (!data) return <div className="text-ink-mute">加载中…</div>

  const stats = [
    { label: '今日订单', value: data.today_orders, to: '/admin/orders' },
    { label: '注册用户', value: data.users, to: '/admin/users' },
    { label: '在售商品', value: data.products_on, to: '/admin/products' },
    { label: '发放记录', value: data.deliveries, to: '/admin/deliveries' },
  ]

  return (
    <div>
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
        {stats.map((s) => (
          <Link key={s.label} to={s.to} className="rounded-2xl border border-[var(--line)] bg-white p-[18px] transition hover:border-teal">
            <div className="mb-2 text-[0.82rem] text-ink-mute">{s.label}</div>
            <div className="font-[family-name:var(--font-display)] text-[1.8rem] font-bold tracking-tight">{s.value}</div>
          </Link>
        ))}
      </div>
      <div className="overflow-hidden rounded-[18px] border border-[var(--line)] bg-white">
        <div className="flex items-center justify-between border-b border-[var(--line)] px-[18px] py-4">
          <h3 className="font-[family-name:var(--font-display)] text-[1.05rem]">最近订单</h3>
          <Link to="/admin/orders" className="text-[0.86rem] font-semibold text-teal">
            查看全部
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[0.9rem]">
            <thead>
              <tr className="bg-paper text-left text-[0.78rem] font-semibold tracking-wide text-ink-mute">
                <th className="px-[18px] py-3.5">订单号</th>
                <th className="px-[18px] py-3.5">商品</th>
                <th className="px-[18px] py-3.5">金额</th>
                <th className="px-[18px] py-3.5">状态</th>
                <th className="px-[18px] py-3.5">时间</th>
              </tr>
            </thead>
            <tbody>
              {data.recent_orders.length ? (
                data.recent_orders.map((o) => (
                  <tr key={o.id} className="border-t border-[var(--line)] hover:bg-[rgba(232,241,238,.4)]">
                    <td className="whitespace-nowrap px-[18px] py-3.5">{o.id}</td>
                    <td className="whitespace-nowrap px-[18px] py-3.5">{o.items.map((i) => i.name).join('、')}</td>
                    <td className="whitespace-nowrap px-[18px] py-3.5">¥{o.total}</td>
                    <td className="whitespace-nowrap px-[18px] py-3.5">
                      <span className="inline-flex rounded-md bg-[rgba(15,110,92,.12)] px-2 py-1 text-[0.75rem] font-semibold text-teal">
                        已完成
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-[18px] py-3.5">{fmtTime(o.created_at)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="px-[18px] py-7 text-center text-ink-mute">
                    暂无订单
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
