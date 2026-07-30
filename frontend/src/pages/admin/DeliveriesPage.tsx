import { useEffect, useState } from 'react'
import { ApiError, api } from '../../lib/api'
import { useToast } from '../../context/ToastContext'
import type { Delivery } from '../../types'
import { PanelTable, Tag } from './ProductsPage'

function fmtTime(iso: string) {
  const d = new Date(iso)
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function DeliveriesPage() {
  const { showToast } = useToast()
  const [rows, setRows] = useState<Delivery[]>([])

  useEffect(() => {
    api.get<Delivery[]>('/api/deliveries').then(setRows).catch(() => setRows([]))
  }, [])

  return (
    <PanelTable headers={['订单号', '商品', '发放内容', '状态', '时间', '操作']} empty={!rows.length} emptyText="暂无发放记录">
      {rows.map((d) => (
        <tr key={d.id} className="border-t border-[var(--line)] hover:bg-[rgba(232,241,238,.4)]">
          <td className="whitespace-nowrap px-[18px] py-3.5">{d.order_id}</td>
          <td className="whitespace-nowrap px-[18px] py-3.5">{d.product_name}</td>
          <td className="max-w-[220px] truncate px-[18px] py-3.5 font-[family-name:var(--font-mono)] text-[0.82rem]">{d.payload}</td>
          <td className="whitespace-nowrap px-[18px] py-3.5">
            <Tag green>已发放</Tag>
          </td>
          <td className="whitespace-nowrap px-[18px] py-3.5">{fmtTime(d.created_at)}</td>
          <td className="whitespace-nowrap px-[18px] py-3.5">
            {d.payload ? (
              <button
                type="button"
                className="text-[0.82rem] font-semibold text-teal hover:underline"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(d.payload)
                    showToast('已复制')
                  } catch {
                    showToast('复制失败')
                  }
                }}
              >
                复制
              </button>
            ) : d.download_url ? (
              <button
                type="button"
                className="text-[0.82rem] font-semibold text-teal hover:underline"
                onClick={async () => {
                  try {
                    await api.download(d.download_url!, d.file_name || undefined)
                  } catch (e) {
                    showToast(e instanceof ApiError ? e.message : '下载失败')
                  }
                }}
              >
                下载
              </button>
            ) : (
              <span className="text-ink-mute">—</span>
            )}
          </td>
        </tr>
      ))}
    </PanelTable>
  )
}
