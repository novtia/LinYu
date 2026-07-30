import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { ApiError, api } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { useCart } from '../context/CartContext'
import { usePurchaseResult } from '../context/PurchaseResultContext'
import { useToast } from '../context/ToastContext'
import { PageBreadcrumb } from '../components/PageBreadcrumb'
import { PaymentMethodPicker } from '../components/PaymentMethodPicker'
import type { CheckoutResult, PublicPaymentMethod } from '../types'

export function CheckoutPage() {
  const { items, replaceWithDelivered } = useCart()
  const { user, loading: authLoading, openAuth, publicSettings } = useAuth()
  const { showToast } = useToast()
  const { showPurchaseResult } = usePurchaseResult()

  const pending = useMemo(() => items.filter((it) => !it.delivered), [items])
  const total = pending.reduce((s, it) => s + it.price, 0)

  const [payment, setPayment] = useState<PublicPaymentMethod | null>(null)
  const [paymentRequired, setPaymentRequired] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!authLoading && !user) openAuth('login')
  }, [authLoading, user, openAuth])

  if (!authLoading && !user) {
    return <Navigate to="/" replace />
  }

  if (!authLoading && user && !pending.length) {
    return (
      <main className="pb-20 pt-8">
        <div className="wrap max-w-xl py-16 text-center">
          <h1 className="mb-3 font-[family-name:var(--font-display)] text-2xl font-extrabold">没有待结算商品</h1>
          <p className="mb-6 text-ink-mute">购物车是空的，或商品已全部发货。</p>
          <Link to="/#shop" className="font-semibold text-teal hover:underline">
            返回商城选购
          </Link>
        </div>
      </main>
    )
  }

  async function submit() {
    if (!pending.length) return
    if (!payment) {
      showToast(paymentRequired ? '请选择支付方式' : '暂无可用支付方式，请稍后再试')
      return
    }
    if (publicSettings?.maintain) {
      showToast('站点维护中，暂停下单')
      return
    }
    setSubmitting(true)
    try {
      const res = await api.post<CheckoutResult>('/api/orders/checkout', {
        items: pending.map((it) => ({ id: it.id, name: it.name, price: it.price })),
        payment_method_id: payment.id,
      })
      replaceWithDelivered([])
      if (!res.pay_url) {
        showPurchaseResult({
          status: 'failure',
          message: '未能生成支付链接，请稍后重试。',
          orderId: res.order.id,
        })
        return
      }
      window.location.href = res.pay_url
    } catch (e) {
      showPurchaseResult({
        status: 'failure',
        message: e instanceof ApiError ? e.message : '结算失败，请稍后重试。',
      })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="pb-20 pt-6 md:pt-8">
      <div className="wrap">
        <PageBreadcrumb items={[{ label: '商城', to: '/' }, { label: '购物车' }, { label: '结算' }]} />

        <h1 className="mb-8 font-[family-name:var(--font-display)] text-[clamp(1.6rem,3vw,2.2rem)] font-extrabold tracking-tight">
          购买结算
        </h1>

        <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)] lg:gap-10">
          <section className="min-w-0">
            <h2 className="mb-4 text-[0.82rem] font-semibold tracking-wide text-ink-mute">商品清单</h2>
            <ul className="divide-y divide-[var(--line)] border-y border-[var(--line)]">
              {pending.map((item, i) => (
                <li key={`${item.id}-${i}`} className="flex items-start justify-between gap-4 py-4">
                  <div className="min-w-0">
                    <div className="font-semibold text-ink">{item.name}</div>
                    {item.payment && (
                      <div className="mt-1 text-[0.8rem] text-ink-mute">
                        加购渠道偏好：{item.payment.label} · {item.payment.channel_name}
                      </div>
                    )}
                  </div>
                  <div className="shrink-0 font-[family-name:var(--font-display)] text-[1.05rem] font-bold">
                    ¥{item.price}
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section className="rounded-[20px] border border-[var(--line)] bg-white p-5 md:p-6 lg:sticky lg:top-24">
            <div className="mb-5 flex items-end justify-between gap-3">
              <span className="text-ink-soft">应付金额</span>
              <span className="font-[family-name:var(--font-display)] text-[2rem] font-bold tracking-tight">¥{total}</span>
            </div>

            <PaymentMethodPicker
              className="mb-5"
              value={payment?.id || null}
              onChange={setPayment}
              onAvailabilityChange={setPaymentRequired}
            />

            {payment && (
              <p className="mb-4 text-[0.78rem] text-ink-mute">
                将使用：{payment.label} · {payment.channel_name}
              </p>
            )}

            <button
              type="button"
              disabled={submitting || !pending.length}
              onClick={submit}
              className="h-12 w-full rounded-xl bg-teal text-[0.95rem] font-semibold text-white hover:bg-teal-deep disabled:opacity-60"
            >
              {submitting ? '正在跳转支付…' : '去支付'}
            </button>

            <p className="mt-4 text-[0.78rem] leading-relaxed text-ink-mute">
              支付成功后将自动发货。卡密 / 文件可在订单详情中查看与下载。
            </p>
          </section>
        </div>
      </div>
    </main>
  )
}
