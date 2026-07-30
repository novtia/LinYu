import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../../lib/api'
import { useToast } from '../../context/ToastContext'
import type { PaymentChannel } from '../../types'
import { IconBtn, PanelTable, Tag } from './ProductsPage'

const PROVIDER_LABEL: Record<string, string> = {
  alipay: '支付宝电脑网站支付',
  ezpay: '易支付',
}

export function PaymentPage() {
  const { showToast } = useToast()
  const navigate = useNavigate()
  const [channels, setChannels] = useState<PaymentChannel[]>([])
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    try {
      const list = await api.get<PaymentChannel[]>('/api/payment-channels')
      setChannels(list)
    } catch {
      setChannels([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  async function toggle(id: string) {
    const ch = await api.patch<PaymentChannel>(`/api/payment-channels/${id}/toggle`)
    await load()
    showToast(ch.enabled ? '渠道已启用' : '渠道已停用')
  }

  async function remove(id: string, name: string) {
    if (!window.confirm(`确定删除渠道「${name}」？`)) return
    await api.delete(`/api/payment-channels/${id}`)
    await load()
    showToast('渠道已删除')
  }

  if (loading) return <div className="text-ink-mute">加载中…</div>

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-[0.88rem] text-ink-mute">管理支付渠道商，支持支付宝官方电脑网站支付与易支付。</p>
        <Link
          to="/admin/payment/new"
          className="inline-flex h-9 items-center rounded-[10px] bg-ink px-3.5 text-[0.86rem] font-semibold text-white hover:bg-teal-deep"
        >
          添加渠道
        </Link>
      </div>

      <PanelTable
        headers={['名称', '渠道商', '商户标识', '支付方式', '状态', '操作']}
        empty={!channels.length}
        emptyText="暂无支付渠道，点击右上角添加"
      >
        {channels.map((ch) => {
          const methods = (ch.config?.methods || {}) as Record<string, boolean>
          const methodLabels = [
            methods.alipay ? '支付宝' : null,
            methods.wxpay ? '微信' : null,
            methods.qqpay ? 'QQ' : null,
          ].filter(Boolean)
          const merchantId = String(ch.config?.app_id || ch.config?.pid || '—')
          return (
            <tr key={ch.id} className="border-t border-[var(--line)] hover:bg-[rgba(232,241,238,.4)]">
              <td className="whitespace-nowrap px-[18px] py-3.5">
                <button
                  type="button"
                  className="font-medium hover:text-teal"
                  onClick={() => navigate(`/admin/payment/${ch.id}`)}
                >
                  {ch.name}
                </button>
              </td>
              <td className="whitespace-nowrap px-[18px] py-3.5">
                {PROVIDER_LABEL[ch.provider] || ch.provider}
              </td>
              <td className="whitespace-nowrap px-[18px] py-3.5 font-[family-name:var(--font-mono)] text-[0.85rem]">
                {merchantId}
              </td>
              <td className="px-[18px] py-3.5 text-[0.85rem] text-ink-soft">
                {methodLabels.length ? methodLabels.join(' / ') : '—'}
              </td>
              <td className="whitespace-nowrap px-[18px] py-3.5">
                <Tag green={ch.enabled} red={!ch.enabled}>
                  {ch.enabled ? '启用' : '停用'}
                </Tag>
              </td>
              <td className="whitespace-nowrap px-[18px] py-3.5">
                <div className="flex gap-2">
                  <IconBtn title="编辑" onClick={() => navigate(`/admin/payment/${ch.id}`)}>
                    ✎
                  </IconBtn>
                  <IconBtn
                    title={ch.enabled ? '停用' : '启用'}
                    onClick={() => toggle(ch.id)}
                    danger={ch.enabled}
                  >
                    {ch.enabled ? '✕' : '✓'}
                  </IconBtn>
                  <IconBtn title="删除" onClick={() => remove(ch.id, ch.name)} danger>
                    ⌫
                  </IconBtn>
                </div>
              </td>
            </tr>
          )
        })}
      </PanelTable>
    </div>
  )
}
