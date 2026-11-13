import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ApiError, api } from '../../lib/api'
import { addDays, isoDay, matchRow, shanghaiDay, yuanText, type LedgerFilter } from '../../lib/ledger'
import { useToast } from '../../context/ToastContext'
import { StatStrip } from '../../components/StatStrip'
import type { Analytics, PaymentChannel } from '../../types'
import { IconBtn, PanelTable, Tag } from './ProductsPage'

const PROVIDER_LABEL: Record<string, string> = {
  alipay: '支付宝电脑网站支付',
  ezpay: '易支付',
  usdt: 'USDT 自托管收款',
}

export function PaymentPage() {
  const { showToast } = useToast()
  const navigate = useNavigate()
  const [channels, setChannels] = useState<PaymentChannel[]>([])
  const [books, setBooks] = useState<Analytics | null>(null)
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    try {
      const list = await api.get<PaymentChannel[]>('/api/payment-channels')
      setChannels(list)
    } catch (e) {
      setChannels([])
      showToast(e instanceof ApiError ? e.message : '支付渠道加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    api.get<Analytics>('/api/analytics').then(setBooks).catch(() => setBooks(null))
  }, [])

  async function toggle(id: string) {
    try {
      const ch = await api.patch<PaymentChannel>(`/api/payment-channels/${id}/toggle`)
      await load()
      showToast(ch.enabled ? '渠道已启用' : '渠道已停用')
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : '操作失败')
    }
  }

  async function remove(id: string, name: string) {
    if (!window.confirm(`确定删除渠道「${name}」？`)) return
    try {
      await api.delete(`/api/payment-channels/${id}`)
      await load()
      showToast('渠道已删除')
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : '删除失败')
    }
  }

  const channelMoney = useMemo(() => {
    const from = isoDay(addDays(new Date(), -29))
    const to = isoDay(new Date())
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
    const paid = (books?.rows || []).filter((r) => matchRow(r, filter))
    const sum = (name: string) => paid.filter((r) => r.channel === name).reduce((a, r) => a + r.amount, 0)
    return {
      alipay: sum('支付宝'),
      ezpay: sum('易支付'),
      wx: sum('微信'),
      usdt: sum('USDT'),
      other: sum('其他') + sum('—'),
    }
  }, [books])

  const failed = useMemo(() => {
    const from = isoDay(addDays(new Date(), -6))
    return (books?.rows || [])
      .filter((r) => !r.ok && shanghaiDay(r.at) >= from)
      .slice(0, 8)
  }, [books])

  if (loading) return <div className="text-ink-mute">加载中…</div>

  return (
    <div>
      <StatStrip
        items={[
          { label: '近 30 日 · 支付宝', value: yuanText(channelMoney.alipay), to: '/admin/revenue' },
          { label: '近 30 日 · 易支付', value: yuanText(channelMoney.ezpay), to: '/admin/revenue' },
          { label: '近 30 日 · 微信', value: yuanText(channelMoney.wx), to: '/admin/revenue' },
          { label: '近 30 日 · USDT', value: yuanText(channelMoney.usdt), to: '/admin/revenue' },
        ]}
      />
      {failed.length ? (
        <section className="mb-5">
          <div className="flex items-baseline justify-between border-b border-[var(--line)] pb-2">
            <h2 className="font-[family-name:var(--font-display)] text-[1.05rem]">近 7 日未入账</h2>
            <Link to="/admin/revenue?status=failed#orders" className="text-[0.8rem] font-bold text-teal">
              到订单里看
            </Link>
          </div>
          <ul>
            {failed.map((r) => (
              <li key={`${r.order_id}-${r.at}`}>
                <Link to={`/admin/revenue/${encodeURIComponent(r.order_id)}`} className="flex items-baseline justify-between gap-3 border-b border-[var(--line)] py-2.5 text-[0.84rem] hover:text-teal">
                  <span className="min-w-0 truncate">
                    <b>{r.item}</b>
                    <em className="ml-2 text-[0.72rem] font-medium text-ink-mute not-italic">{r.buyer || '买家'} · {r.channel} · {shanghaiDay(r.at).slice(5)}</em>
                  </span>
                  <span className="shrink-0 font-[family-name:var(--font-mono)] text-danger">{yuanText(r.amount)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-[0.88rem] text-ink-mute">管理支付渠道商，支持支付宝官方、易支付与 USDT 多链自托管收款。</p>
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
            methods.usdt ? 'USDT' : null,
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
