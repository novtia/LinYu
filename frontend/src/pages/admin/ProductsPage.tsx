import { useEffect, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../../lib/api'
import { useToast } from '../../context/ToastContext'
import type { Product } from '../../types'

const TYPE_LABEL: Record<string, string> = { key: '卡密', file: '文件', code: '兑换码' }

export function ProductsPage() {
  const { showToast } = useToast()
  const [products, setProducts] = useState<Product[]>([])
  const navigate = useNavigate()

  async function load() {
    const list = await api.get<Product[]>('/api/products/admin')
    setProducts(list)
  }

  useEffect(() => {
    load().catch(() => setProducts([]))
  }, [])

  async function toggle(id: string) {
    const p = await api.patch<Product>(`/api/products/${id}/toggle`)
    await load()
    showToast(p.status === 'on' ? '已上架' : '已下架')
  }

  return (
    <div>
      <div className="mb-4 flex justify-end">
        <Link
          to="/admin/products/new"
          className="inline-flex h-9 items-center rounded-[10px] bg-ink px-3.5 text-[0.86rem] font-semibold text-white hover:bg-teal-deep"
        >
          新增商品
        </Link>
      </div>
      <PanelTable headers={['封面', 'ID', '名称', '类型', '文件', '价格', '状态', '操作']} empty={!products.length}>
        {products.map((p) => (
          <tr key={p.id} className="border-t border-[var(--line)] hover:bg-[rgba(232,241,238,.4)]">
            <td className="px-[18px] py-3">
              <div className="h-12 w-16 overflow-hidden rounded-lg border border-[var(--line)]">
                {p.cover_url ? (
                  <img src={p.cover_url} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className={`product ${p.cover} h-full w-full`}>
                    <div className="product-media relative h-full">
                      <div className="wash absolute inset-0" />
                    </div>
                  </div>
                )}
              </div>
            </td>
            <td className="whitespace-nowrap px-[18px] py-3.5 font-[family-name:var(--font-mono)] text-[0.85rem]">{p.id}</td>
            <td className="whitespace-nowrap px-[18px] py-3.5">
              <button type="button" className="font-medium hover:text-teal" onClick={() => navigate(`/admin/products/${p.id}/edit`)}>
                {p.name}
              </button>
            </td>
            <td className="whitespace-nowrap px-[18px] py-3.5">{TYPE_LABEL[p.type] || p.type}</td>
            <td className="max-w-[160px] truncate px-[18px] py-3.5 text-[0.82rem] text-ink-mute">
              {p.has_file ? p.file_name : '—'}
            </td>
            <td className="whitespace-nowrap px-[18px] py-3.5">¥{p.price}</td>
            <td className="whitespace-nowrap px-[18px] py-3.5">
              <Tag green={p.status === 'on'}>{p.status === 'on' ? '在售' : '下架'}</Tag>
            </td>
            <td className="whitespace-nowrap px-[18px] py-3.5">
              <div className="flex gap-2">
                <IconBtn title="编辑" onClick={() => navigate(`/admin/products/${p.id}/edit`)}>
                  ✎
                </IconBtn>
                <IconBtn title={p.status === 'on' ? '下架' : '上架'} onClick={() => toggle(p.id)} danger={p.status === 'on'}>
                  {p.status === 'on' ? '✕' : '✓'}
                </IconBtn>
                <IconBtn title="前台预览" onClick={() => window.open(`/product/${p.id}`, '_blank')}>
                  ↗
                </IconBtn>
              </div>
            </td>
          </tr>
        ))}
      </PanelTable>
    </div>
  )
}

export function PanelTable({
  headers,
  children,
  empty,
  emptyText = '暂无数据',
}: {
  headers: string[]
  children: ReactNode
  empty?: boolean
  emptyText?: string
}) {
  return (
    <div className="overflow-hidden rounded-[18px] border border-[var(--line)] bg-white">
      <div className="overflow-x-auto">
        <table className="w-full text-[0.9rem]">
          <thead>
            <tr className="bg-paper text-left text-[0.78rem] font-semibold tracking-wide text-ink-mute">
              {headers.map((h) => (
                <th key={h} className="px-[18px] py-3.5">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {empty ? (
              <tr>
                <td colSpan={headers.length} className="px-[18px] py-7 text-center text-ink-mute">
                  {emptyText}
                </td>
              </tr>
            ) : (
              children
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function Tag({
  children,
  green,
  red,
  gold,
}: {
  children: ReactNode
  green?: boolean
  red?: boolean
  gold?: boolean
  gray?: boolean
}) {
  const cls = green
    ? 'bg-[rgba(15,110,92,.12)] text-teal'
    : red
      ? 'bg-[rgba(180,35,24,.1)] text-danger'
      : gold
        ? 'bg-[rgba(196,165,116,.2)] text-[#8b6b3d]'
        : 'bg-paper text-ink-mute'
  return <span className={`inline-flex rounded-md px-2 py-1 text-[0.75rem] font-semibold ${cls}`}>{children}</span>
}

export function IconBtn({
  children,
  onClick,
  title,
  danger,
}: {
  children: ReactNode
  onClick: () => void
  title?: string
  danger?: boolean
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`grid h-8 w-8 place-items-center rounded-lg border border-[var(--line)] bg-white text-ink-soft hover:border-teal hover:text-teal ${
        danger ? 'hover:!border-danger hover:!text-danger' : ''
      }`}
    >
      {children}
    </button>
  )
}
