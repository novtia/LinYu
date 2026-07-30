import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../../lib/api'
import type { Order } from '../../types'
import { orderStatusLabel } from '../../lib/orderStatus'
import { PanelTable, Tag } from './ProductsPage'

function fmtTime(iso: string) {
  const d = new Date(iso)
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([])

  useEffect(() => {
    api.get<Order[]>('/api/orders').then(setOrders).catch(() => setOrders([]))
  }, [])

  return (
    <PanelTable headers={['订单号', '用户', '商品', '金额', '状态', '时间', '操作']} empty={!orders.length} emptyText="暂无订单">
      {orders.map((o) => (
        <tr key={o.id} className="border-t border-[var(--line)] hover:bg-[rgba(232,241,238,.4)]">
          <td className="whitespace-nowrap px-[18px] py-3.5 font-[family-name:var(--font-mono)] text-[0.85rem]">{o.id}</td>
          <td className="whitespace-nowrap px-[18px] py-3.5">{o.username}</td>
          <td className="whitespace-nowrap px-[18px] py-3.5">{o.items.map((i) => i.name).join('、')}</td>
          <td className="whitespace-nowrap px-[18px] py-3.5">¥{o.total}</td>
          <td className="whitespace-nowrap px-[18px] py-3.5">
            {o.status === 'completed' || o.status === 'paid' ? (
              <Tag green>{orderStatusLabel(o.status)}</Tag>
            ) : o.status === 'pending' ? (
              <Tag>{orderStatusLabel(o.status)}</Tag>
            ) : (
              <Tag red>{orderStatusLabel(o.status)}</Tag>
            )}
          </td>
          <td className="whitespace-nowrap px-[18px] py-3.5">{fmtTime(o.created_at)}</td>
          <td className="whitespace-nowrap px-[18px] py-3.5">
            <Link to={`/orders/${o.id}`} className="text-[0.82rem] font-semibold text-teal hover:underline">
              详情
            </Link>
          </td>
        </tr>
      ))}
    </PanelTable>
  )
}
