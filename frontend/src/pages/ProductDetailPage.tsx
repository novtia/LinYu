import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ApiError, api } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { useCart } from '../context/CartContext'
import { usePurchaseResult } from '../context/PurchaseResultContext'
import { useToast } from '../context/ToastContext'
import { MarkdownContent } from '../components/MarkdownContent'
import { PageBreadcrumb } from '../components/PageBreadcrumb'
import { PaymentMethodPicker } from '../components/PaymentMethodPicker'
import { ProductDeliveryPanel, type DeliveryUnlock } from '../components/ProductDeliveryPanel'
import { ProductMedia } from '../components/ProductMedia'
import type { CheckoutResult, Order, Product, PublicPaymentMethod } from '../types'

const TYPE_LABEL: Record<string, string> = {
  key: '卡密 / 激活码',
  file: '数字文件',
  code: '兑换码',
}
const TYPE_SHORT: Record<string, string> = {
  key: '卡密',
  file: '数字文件',
  code: '兑换码',
}
const unit = (t: string) => (t === 'file' ? '包' : '码')

function emptyUnlock(product: Product): DeliveryUnlock {
  return {
    unlocked: false,
    productType: product.type,
    hasFile: product.has_file,
    fileName: product.file_name,
  }
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
  const { addProduct } = useCart()
  const { user, openAuth, publicSettings } = useAuth()
  const { showToast } = useToast()
  const { showPurchaseResult } = usePurchaseResult()

  useEffect(() => {
    if (!id) return
    setLoading(true)
    setPayment(null)
    setPaymentRequired(false)
    setUnlock(null)
    api
      .get<Product>(`/api/products/${id}`)
      .then((p) => {
        setProduct(p)
        setUnlock(emptyUnlock(p))
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
          const hit = order.items.find((it) => it.product_id === product.id && (it.payload || it.download_url))
          if (hit) {
            setUnlock({
              unlocked: true,
              productType: product.type,
              hasFile: product.has_file,
              fileName: hit.file_name || product.file_name,
              downloadUrl: hit.download_url,
              payload: hit.payload,
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

  function ensurePayment(): boolean {
    if (!payment) {
      showToast(paymentRequired ? '请选择购买渠道' : '暂无可用支付方式，请稍后再试')
      return false
    }
    return true
  }

  /** 加入购物车：仅写入购物车，不直接下单 */
  function handleAddCart() {
    if (!product) return
    addProduct(product, payment, { openDrawer: true })
    showToast(`已加入购物车：${product.name}`)
  }

  /** 购买：创建待支付订单并跳转易支付 */
  async function handleBuyNow() {
    if (!product) return
    if (!ensurePayment()) return
    if (!user) {
      openAuth('login')
      showToast('请先登录后再购买')
      return
    }
    if (publicSettings?.maintain) {
      showToast('站点维护中，暂停下单')
      return
    }
    setBuying(true)
    try {
      const res = await api.post<CheckoutResult>('/api/orders/checkout', {
        items: [{ id: product.id, name: product.name, price: product.price }],
        payment_method_id: payment!.id,
      })
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
            { label: TYPE_SHORT[product.type] || '商品', to: '/#shop' },
            { label: product.name },
          ]}
        />

        <section className="mt-4 overflow-hidden rounded-[22px] border border-[var(--line)] bg-white shadow-[0_20px_44px_-36px_rgba(20,32,28,.4)]">
          <ProductMedia
            cover={product.cover}
            coverUrl={product.cover_url}
            tag={product.tag}
            aspectClass="aspect-[16/9] md:aspect-[2.2/1]"
          />
        </section>

        <div className="pt-8 md:pt-10">
          <div className="mb-8 max-w-3xl">
            <div className="mb-3 inline-flex rounded-lg bg-paper px-2.5 py-1 text-[0.78rem] font-semibold text-ink-soft">
              {TYPE_LABEL[product.type] || product.type}
            </div>
            <h1 className="font-[family-name:var(--font-display)] text-[clamp(1.8rem,3.2vw,2.6rem)] font-extrabold tracking-[-0.03em] text-ink">
              {product.name}
            </h1>
          </div>

          <div className="grid gap-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(300px,0.75fr)] lg:gap-12">
            {/* 左侧：行高由较高一侧决定；仅在矮于右侧时被拉齐 */}
            <article className="flex min-h-0 min-w-0 flex-col rounded-[22px] border border-[var(--line)] bg-white/85 p-5 md:p-8">
              <h2 className="mb-5 shrink-0 font-[family-name:var(--font-display)] text-[1.05rem] font-bold tracking-tight text-ink">
                商品详情
              </h2>
              <div className="min-h-0 flex-1">
                <MarkdownContent content={product.desc} />
              </div>
            </article>

            {/* 右侧：始终按内容高度，不被左侧拉高 */}
            <aside className="w-full self-start">
              <div className="rounded-[22px] border border-[var(--line)] bg-white p-5 shadow-[0_22px_48px_-40px_rgba(20,32,28,.4)] md:p-6">
                <div className="mb-5 flex items-end gap-2 border-b border-[var(--line)] pb-5">
                  <span className="font-[family-name:var(--font-display)] text-[2.2rem] font-bold tracking-tight text-ink">
                    ¥{product.price}
                  </span>
                  <span className="pb-1.5 text-ink-mute">/{unit(product.type)}</span>
                </div>

                <ProductDeliveryPanel className="mb-5" unlock={unlock} />

                <div>
                  <PaymentMethodPicker
                    className="mb-5"
                    value={payment?.id || null}
                    onChange={setPayment}
                    onAvailabilityChange={setPaymentRequired}
                  />

                  <div className="grid grid-cols-2 gap-2.5">
                    <button
                      type="button"
                      className="h-12 rounded-xl border border-[var(--line-strong)] bg-white text-[0.95rem] font-semibold text-ink hover:border-teal hover:text-teal"
                      onClick={handleAddCart}
                    >
                      加入购物车
                    </button>
                    <button
                      type="button"
                      disabled={buying}
                      className="h-12 rounded-xl bg-teal text-[0.95rem] font-semibold text-white transition hover:bg-teal-deep disabled:opacity-60"
                      onClick={handleBuyNow}
                    >
                      {buying ? '跳转支付中…' : '购买'}
                    </button>
                  </div>

                  {payment && (
                    <p className="mt-3 text-[0.78rem] text-ink-mute">
                      当前渠道：{payment.label} · {payment.channel_name}
                    </p>
                  )}
                </div>

                <ul className="mt-6 grid gap-2 border-t border-[var(--line)] pt-5 text-[0.82rem] text-ink-soft">
                  {['付款成功自动发货', '内容仅买家可见', '支持在「我的订单」随时查看'].map((t) => (
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
