import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ApiError, api } from '../lib/api'
import { setGuestEmail } from '../lib/guestEmail'
import { useAuth } from '../context/AuthContext'
import { useCart } from '../context/CartContext'
import { usePurchaseResult } from '../context/PurchaseResultContext'
import { useToast } from '../context/ToastContext'
import { MarkdownContent } from '../components/MarkdownContent'
import { PageBreadcrumb } from '../components/PageBreadcrumb'
import { PaymentMethodPicker } from '../components/PaymentMethodPicker'
import { QuantityStepper, clampCartQty } from '../components/QuantityStepper'
import { ProductDeliveryPanel, type DeliveryUnlock } from '../components/ProductDeliveryPanel'
import { ProductMedia } from '../components/ProductMedia'
import { resolveCheckoutResult } from '../lib/checkout'
import { formatYuan, isCommissionProduct, splitPrice } from '../lib/commission'
import type { CheckoutResult, Order, Product, PublicPaymentMethod } from '../types'

function emptyUnlock(): DeliveryUnlock {
  return { unlocked: false }
}

export function ProductDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [product, setProduct] = useState<Product | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [payment, setPayment] = useState<PublicPaymentMethod | null>(null)
  const [paymentRequired, setPaymentRequired] = useState(false)
  const [unlock, setUnlock] = useState<DeliveryUnlock | null>(null)
  const [buying, setBuying] = useState(false)
  const [checkoutEmail, setCheckoutEmail] = useState('')
  const [quantity, setQuantity] = useState(1)
  const { addProduct } = useCart()
  const { user, loading: authLoading, publicSettings, refreshMe, openAuth } = useAuth()
  const { showToast } = useToast()
  const { showPurchaseResult } = usePurchaseResult()
  const needEmail = !authLoading && !user?.email

  useEffect(() => {
    if (!id) return
    setLoading(true)
    setPayment(null)
    setPaymentRequired(false)
    setUnlock(null)
    setQuantity(1)
    api
      .get<Product>(`/api/products/${id}`)
      .then((p) => {
        setProduct(p)
        setUnlock(emptyUnlock())
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : '商品不存在'))
      .finally(() => setLoading(false))
  }, [id])

  useEffect(() => {
    if (!user || !product) return
    let alive = true
    api
      .get<Order[]>('/api/orders/mine')
      .then((orders) => {
        if (!alive) return
        for (const order of orders) {
          const hit = order.items.find(
            (it) =>
              it.product_id === product.id &&
              (order.sale_mode === 'commission'
                ? order.status === 'completed'
                : Boolean(it.payload) || Boolean(it.download_url) || Boolean(it.files && it.files.length)),
          )
          if (hit) {
            setUnlock({
              unlocked: true,
              orderId: order.id,
            })
            return
          }
        }
      })
      .catch(() => {
        /* ignore */
      })
    return () => {
      alive = false
    }
  }, [user, product])

  if (loading) {
    return <div className="wrap py-20 text-center text-ink-mute">加载中…</div>
  }

  if (error || !product || !unlock) {
    return (
      <div className="wrap py-20 text-center">
        <p className="mb-4 text-ink-mute">{error || '商品不存在'}</p>
        <Link to="/" className="font-semibold text-teal hover:underline">
          返回商城
        </Link>
      </div>
    )
  }

  const debugMode = !!publicSettings?.debugMode
  const commission = isCommissionProduct(product)
  const orderHalves = splitPrice(product.price * clampCartQty(quantity))
  const isFree = !commission && product.price === 0

  function ensurePayment(): boolean {
    if (debugMode || isFree) return true
    if (!payment) {
      showToast(paymentRequired ? '请选择购买渠道' : '暂无可用支付方式，请稍后再试')
      return false
    }
    return true
  }

  function handleAddCart() {
    if (!product || commission) return
    const qty = clampCartQty(quantity)
    addProduct(product, payment, { openDrawer: true, quantity: qty })
    showToast(qty > 1 ? `已加入购物车：${product.name} ×${qty}` : `已加入购物车：${product.name}`)
  }

  async function handleBuyNow() {
    if (!product) return
    if (commission && !user) {
      openAuth('login')
      showToast('约稿商品请先登录')
      return
    }
    if (!ensurePayment()) return
    if (publicSettings?.maintain) {
      showToast('站点维护中，暂停下单')
      return
    }
    const needEmailNow = !user?.email
    const email = checkoutEmail.trim()
    if (authLoading) return
    if (needEmailNow && !email) {
      showToast('请填写收货邮箱')
      return
    }
    setBuying(true)
    try {
      const qty = clampCartQty(quantity)
      const res = await api.post<CheckoutResult>('/api/orders/checkout', {
        items: Array.from({ length: qty }, () => ({ id: product.id, name: product.name, price: product.price })),
        payment_method_id: payment?.id || '',
        ...(needEmailNow ? { email } : {}),
      })
      if (needEmailNow) setGuestEmail(email)
      if (user) await refreshMe()
      const outcome = resolveCheckoutResult(res)
      if (outcome === 'paid' || outcome === 'deposit') {
        if (outcome === 'paid') {
          const hit = res.order.items.find(
            (it) =>
              it.product_id === product.id &&
              (Boolean(it.payload) || Boolean(it.download_url) || Boolean(it.files && it.files.length)),
          )
          if (hit) {
            setUnlock({ unlocked: true, orderId: res.order.id })
          }
        }
        showPurchaseResult({
          status: 'success',
          message:
            outcome === 'deposit'
              ? debugMode
                ? '调试模式：已跳过定金，等待商家交稿。'
                : '定金已支付，请等待商家交稿。'
              : debugMode
                ? '调试模式：已跳过支付并完成发货'
                : isFree
                  ? '免费领取成功，商品已发放。'
                  : '订单已生成，商品已发货。',
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
        message: e instanceof ApiError ? e.message : '购买失败，请稍后重试。',
      })
    } finally {
      setBuying(false)
    }
  }

  return (
    <main className="pb-16 md:pb-24">
      <div className="wrap pt-6 md:pt-8">
        <PageBreadcrumb
          items={[
            { label: '商城', to: '/' },
            { label: product.category_name || '商品', to: '/#shop' },
            { label: product.name },
          ]}
        />

        <section className="mt-4 overflow-hidden rounded-[22px] border border-[var(--line)] bg-white shadow-[0_20px_44px_-36px_rgba(20,32,28,.4)]">
          <ProductMedia
            cover={product.cover}
            coverUrl={product.cover_url}
            tag={product.category_name || undefined}
            aspectClass="aspect-[16/9] md:aspect-[2.2/1]"
          />
        </section>

        <div className="pt-8 md:pt-10">
          <div className="mb-8 max-w-3xl">
            <div className="mb-3 flex flex-wrap gap-2">
              {product.category_name && (
                <div className="inline-flex rounded-lg bg-paper px-2.5 py-1 text-[0.78rem] font-semibold text-ink-soft">
                  {product.category_name}
                </div>
              )}
              {commission && (
                <div className="inline-flex rounded-lg bg-[rgba(15,110,92,.1)] px-2.5 py-1 text-[0.78rem] font-semibold text-teal">
                  约稿
                </div>
              )}
            </div>
            <h1 className="font-[family-name:var(--font-display)] text-[clamp(1.8rem,3.2vw,2.6rem)] font-extrabold tracking-[-0.03em] text-ink">
              {product.name}
            </h1>
          </div>

          <div className="grid gap-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(300px,0.75fr)] lg:gap-12">
            <article className="flex min-h-0 min-w-0 flex-col rounded-[22px] border border-[var(--line)] bg-white/85 p-5 md:p-8">
              <h2 className="mb-5 shrink-0 font-[family-name:var(--font-display)] text-[1.05rem] font-bold tracking-tight text-ink">
                商品详情
              </h2>
              <div className="min-h-0 flex-1">
                <MarkdownContent content={product.desc} />
              </div>
            </article>

            <aside className="w-full self-start">
              <div className="rounded-[22px] border border-[var(--line)] bg-white p-5 shadow-[0_22px_48px_-40px_rgba(20,32,28,.4)] md:p-6">
                <div className="mb-5 flex items-end justify-between gap-3 border-b border-[var(--line)] pb-5">
                  <div>
                    <span className="font-[family-name:var(--font-display)] text-[2.2rem] font-bold tracking-tight text-ink">
                      ¥{product.price}
                    </span>
                    {commission ? (
                      <div className="mt-1 text-[0.82rem] text-ink-mute">
                        约稿 · 定金 {formatYuan(orderHalves.deposit)} · 尾款 {formatYuan(orderHalves.balance)}
                      </div>
                    ) : null}
                  </div>
                  {quantity > 1 && (
                    <span className="mb-1 text-[0.82rem] text-ink-mute">
                      小计 ¥{Math.round(product.price * quantity * 100) / 100}
                    </span>
                  )}
                </div>

                <ProductDeliveryPanel className="mb-5" unlock={unlock} />

                <div>
                  {debugMode ? (
                    <div className="mb-5 rounded-xl border border-[rgba(196,165,116,.45)] bg-[rgba(196,165,116,.12)] px-3.5 py-3 text-[0.82rem] text-[#8b6b3d]">
                      调试模式已开启：购买将跳过真实支付并直接发货
                    </div>
                  ) : isFree ? (
                    <div className="mb-5 rounded-xl border border-[rgba(15,110,92,.25)] bg-[rgba(15,110,92,.08)] px-3.5 py-3 text-[0.82rem] text-teal">
                      本商品免费，点击购买后将直接发放
                    </div>
                  ) : (
                    <PaymentMethodPicker
                      className="mb-5"
                      value={payment?.id || null}
                      onChange={setPayment}
                      onAvailabilityChange={setPaymentRequired}
                    />
                  )}

                  <div className="mb-5">
                    <span className="mb-1.5 block text-[0.82rem] font-semibold text-ink-soft">购买数量</span>
                    <QuantityStepper value={quantity} onChange={setQuantity} />
                  </div>
                  {commission && (
                    <div className="mb-5 rounded-xl border border-[rgba(15,110,92,.2)] bg-[rgba(15,110,92,.06)] px-3.5 py-3 text-[0.82rem] text-ink-soft">
                      需登录下单。先按件数支付定金，商家交稿后再付尾款才能下载文件。
                    </div>
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

                  <div className={commission ? '' : 'grid grid-cols-2 gap-2.5'}>
                    {!commission && (
                      <button
                        type="button"
                        className="h-12 rounded-xl border border-[var(--line-strong)] bg-white text-[0.95rem] font-semibold text-ink hover:border-teal hover:text-teal"
                        onClick={handleAddCart}
                      >
                        加入购物车
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={buying || authLoading}
                      className="h-12 w-full rounded-xl bg-teal text-[0.95rem] font-semibold text-white transition hover:bg-teal-deep disabled:opacity-60"
                      onClick={handleBuyNow}
                    >
                      {buying
                        ? debugMode || isFree
                          ? '处理中…'
                          : '跳转支付中…'
                        : debugMode
                          ? '调试购买'
                          : isFree
                            ? '免费领取'
                            : commission
                              ? user
                                ? `支付定金 ${formatYuan(orderHalves.deposit)}`
                                : '登录后支付定金'
                              : '购买'}
                    </button>
                  </div>

                  {!debugMode && !isFree && payment && (
                    <p className="mt-3 text-[0.78rem] text-ink-mute">
                      当前渠道：{payment.label} · {payment.channel_name}
                    </p>
                  )}
                </div>

                <ul className="mt-6 grid gap-2 border-t border-[var(--line)] pt-5 text-[0.82rem] text-ink-soft">
                  {(commission
                    ? ['须登录账号购买', '先付一半定金，商家交稿后再付尾款', '尾款到账后才能下载稿件']
                    : isFree
                      ? ['点击购买立即发货', '内容仅买家可见', '支持在「我的订单」随时查看']
                      : ['付款成功自动发货', '内容仅买家可见', '支持在「我的订单」随时查看']
                  ).map((t) => (
                    <li key={t} className="flex items-center gap-2">
                      <span className="grid h-[18px] w-[18px] place-items-center rounded-full bg-[rgba(15,110,92,.12)] text-[0.65rem] text-teal">
                        ✓
                      </span>
                      {t}
                    </li>
                  ))}
                </ul>
              </div>
            </aside>
          </div>
        </div>
      </div>
    </main>
  )
}
