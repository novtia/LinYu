import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ApiError, api } from '../../lib/api'
import { useToast } from '../../context/ToastContext'
import type { Order } from '../../types'
import { orderStatusLabel } from '../../lib/orderStatus'
import { PanelTable, Tag } from './ProductsPage'

function fmtTime(iso: string) {
  const d = new Date(iso)
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function OrdersPage() {
  const { showToast } = useToast()
  const [orders, setOrders] = useState<Order[]>([])

  useEffect(() => {
    api
      .get<Order[]>('/api/orders')
      .then(setOrders)
      .catch((e) => {
        setOrders([])
        showToast(e instanceof ApiError ? e.message : '订单加载失败')
      })
  }, [])

  return (
    <PanelTable headers={['订单号', '用户', '邮箱', '商品', '金额', '状态', '时间', '操作']} empty={!orders.length} emptyText="暂无订单">
      {orders.map((o) => (
        <tr key={o.id} className="border-t border-[var(--line)] hover:bg-[rgba(232,241,238,.4)]">
          <td className="whitespace-nowrap px-[18px] py-3.5 font-[family-name:var(--font-mono)] text-[0.85rem]">{o.id}</td>
          <td className="whitespace-nowrap px-[18px] py-3.5">{o.username}</td>
          <td className="whitespace-nowrap px-[18px] py-3.5 text-[0.85rem] text-ink-soft">{o.email || '—'}</td>
          <td className="whitespace-nowrap px-[18px] py-3.5">
            {o.items.map((i) => i.name).join('、')}
            {o.sale_mode === 'commission' ? (
              <span className="ml-2 inline-flex rounded-md bg-[rgba(15,110,92,.1)] px-1.5 py-0.5 text-[0.72rem] font-semibold text-teal">
                约稿
              </span>
            ) : null}
          </td>
          <td className="whitespace-nowrap px-[18px] py-3.5">¥{o.total}</td>
          <td className="whitespace-nowrap px-[18px] py-3.5">
            {o.status === 'completed' || o.status === 'paid' ? (
              <Tag green>{orderStatusLabel(o.status)}</Tag>
            ) : o.status === 'pending' || o.status === 'deposit_paid' || o.status === 'awaiting_balance' ? (
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
