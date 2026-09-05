import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ApiError, api } from '../lib/api'
import { setGuestEmail } from '../lib/guestEmail'
import { useAuth } from '../context/AuthContext'
import { useCart } from '../context/CartContext'
import { usePurchaseResult } from '../context/PurchaseResultContext'
import { useToast } from '../context/ToastContext'
import { PageBreadcrumb } from '../components/PageBreadcrumb'
import { PaymentMethodPicker } from '../components/PaymentMethodPicker'
import { resolveCheckoutResult } from '../lib/checkout'
import type { CheckoutResult, PublicPaymentMethod } from '../types'

export function CheckoutPage() {
  const { items, replaceWithDelivered } = useCart()
  const { user, loading: authLoading, publicSettings, refreshMe } = useAuth()
  const { showToast } = useToast()
  const { showPurchaseResult } = usePurchaseResult()

  const pending = useMemo(() => items.filter((it) => !it.delivered), [items])
  const total = pending.reduce((s, it) => s + it.price, 0)

  const [payment, setPayment] = useState<PublicPaymentMethod | null>(null)
  const [paymentRequired, setPaymentRequired] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [checkoutEmail, setCheckoutEmail] = useState('')
  const needEmail = !authLoading && !user?.email

  if (!authLoading && !pending.length) {
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

  const debugMode = !!publicSettings?.debugMode
  const isFree = total === 0

  async function submit() {
    if (!pending.length) return
    if (!debugMode && !isFree && !payment) {
      showToast(paymentRequired ? '请选择支付方式' : '暂无可用支付方式，请稍后再试')
      return
    }
    if (publicSettings?.maintain) {
      showToast('站点维护中，暂停下单')
      return
    }
    const email = checkoutEmail.trim()
    if (needEmail && !email) {
      showToast('请填写收货邮箱')
      return
    }
    setSubmitting(true)
    try {
      const res = await api.post<CheckoutResult>('/api/orders/checkout', {
        items: pending.map((it) => ({ id: it.id, name: it.name, price: it.price })),
        payment_method_id: payment?.id || '',
        ...(needEmail ? { email } : {}),
      })
      if (needEmail) setGuestEmail(email)
      if (user) await refreshMe()
      replaceWithDelivered([])
      const outcome = resolveCheckoutResult(res)
      if (outcome === 'paid') {
        showPurchaseResult({
          status: 'success',
          message: debugMode ? '调试模式：已跳过支付并完成发货' : isFree ? '免费领取成功，商品已发放。' : '订单已生成，商品已发货。',
          orderId: res.order.id,
        })
        return
      }
      if (outcome === 'redirect') {
        window.location.href = res.pay_url
        return
      }
      showPurchaseResult({
        status: 'failure',
        message: '未能生成支付链接，请稍后重试。',
        orderId: res.order.id,
      })
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

            {debugMode ? (
              <div className="mb-5 rounded-xl border border-[rgba(196,165,116,.45)] bg-[rgba(196,165,116,.12)] px-3.5 py-3 text-[0.82rem] text-[#8b6b3d]">
                调试模式已开启：将跳过真实支付并直接发货
              </div>
            ) : isFree ? (
              <div className="mb-5 rounded-xl border border-[rgba(15,110,92,.25)] bg-[rgba(15,110,92,.08)] px-3.5 py-3 text-[0.82rem] text-teal">
                本单免费，确认后将直接发放
              </div>
            ) : (
              <PaymentMethodPicker
                className="mb-5"
                value={payment?.id || null}
                onChange={setPayment}
                onAvailabilityChange={setPaymentRequired}
              />
            )}

            {!debugMode && !isFree && payment && (
              <p className="mb-4 text-[0.78rem] text-ink-mute">
                将使用：{payment.label} · {payment.channel_name}
              </p>
            )}

            {needEmail && (
              <label className="mb-5 block">
                <span className="mb-1.5 block text-[0.82rem] font-semibold text-ink-soft">收货邮箱</span>
                <input
                  className="field-input"
                  type="email"
                  value={checkoutEmail}
                  onChange={(e) => setCheckoutEmail(e.target.value)}
                  placeholder="用于发货通知与查询订单"
                  required
                />
              </label>
            )}

            <button
              type="button"
              disabled={submitting || !pending.length || authLoading}
              onClick={submit}
              className="h-12 w-full rounded-xl bg-teal text-[0.95rem] font-semibold text-white hover:bg-teal-deep disabled:opacity-60"
            >
              {submitting
                ? debugMode || isFree
                  ? '处理中…'
                  : '正在跳转支付…'
                : debugMode
                  ? '调试购买'
                  : isFree
                    ? '免费领取'
                    : '去支付'}
            </button>

            <p className="mt-4 text-[0.78rem] leading-relaxed text-ink-mute">
              {debugMode
                ? '调试模式下不会发起真实支付，订单会立即完成并发货。'
                : isFree
                  ? '确认后将立即发货，内容可在订单详情中查看。'
                  : '支付成功后将自动发货，内容可在订单详情中查看。'}
            </p>
          </section>
        </div>
      </div>
    </main>
  )
}
