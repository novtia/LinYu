import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowRight, Check, Copy, Mail, ReceiptText, ShoppingBag } from 'lucide-react'
import { ApiError, api } from '../lib/api'
import { getGuestEmail, setGuestEmail } from '../lib/guestEmail'
import { useAuth } from '../context/AuthContext'
import { useCart } from '../context/CartContext'
import { usePurchaseResult } from '../context/PurchaseResultContext'
import { useToast } from '../context/ToastContext'
import { DeliveryFileList } from '../components/DeliveryFileList'
import { MarkdownContent } from '../components/MarkdownContent'
import { PageBreadcrumb } from '../components/PageBreadcrumb'
import { PaymentMethodPicker } from '../components/PaymentMethodPicker'
import { QuantityStepper, clampCartQty } from '../components/QuantityStepper'
import { resolveCheckoutResult } from '../lib/checkout'
import { formatPerK, formatYuan, isCommissionProduct } from '../lib/commission'
import { coverGlyph, formatMoney, itemFiles, splitMoney } from '../lib/orderDisplay'
import { CommissionProductView } from './CommissionProductView'
import type { CheckoutResult, Order, Product, ProductFileItem, PublicPaymentMethod } from '../types'

type OwnedDelivery = {
  orderId: string
  files: ProductFileItem[]
  payload?: string | null
}

function coverClass(p: Pick<Product, 'cover'>) {
  return /^p[1-6]$/.test(p.cover || '') ? p.cover : 'p1'
}

function descExcerpt(md: string, max = 96) {
  const text = (md || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_~-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!text) return ''
  return text.length > max ? `${text.slice(0, max).replace(/[、，。\s]+$/, '')}…` : text
}

function ownedFromOrder(order: Order, productId: number): OwnedDelivery | null {
  if (order.status !== 'paid' && order.status !== 'completed') return null
  const hit = order.items.find((it) => it.product_id === productId)
  if (!hit) return null
  return { orderId: order.id, files: itemFiles(hit), payload: hit.payload || null }
}

function payHintOf(p: PublicPaymentMethod) {
  const extra = p.channel_name || p.provider_name
  if (!extra || extra === p.label) return p.label
  return `${p.label} · ${extra}`
}

function relatedOf(all: Product[], current: Product, n = 3) {
  const others = all.filter((p) => p.id !== current.id)
  const same = others.filter((p) => p.category_id != null && p.category_id === current.category_id)
  const rest = others.filter((p) => !same.includes(p))
  return [...same, ...rest].slice(0, n)
}

export function ProductDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [product, setProduct] = useState<Product | null>(null)
  const [catalog, setCatalog] = useState<Product[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [payment, setPayment] = useState<PublicPaymentMethod | null>(null)
  const [paymentRequired, setPaymentRequired] = useState(false)
  const [owned, setOwned] = useState<OwnedDelivery | null>(null)
  const [buying, setBuying] = useState(false)
  const [checkoutEmail, setCheckoutEmail] = useState(getGuestEmail)
  const [quantity, setQuantity] = useState(1)
  const { addProduct } = useCart()
  const { user, loading: authLoading, publicSettings, refreshMe } = useAuth()
  const { showToast } = useToast()
  const { showPurchaseResult } = usePurchaseResult()
  const needEmail = !authLoading && !user?.email

  useEffect(() => {
    if (!id) return
    setLoading(true)
    setPayment(null)
    setPaymentRequired(false)
    setOwned(null)
    setQuantity(1)
    setCatalog([])
    const productReq = api.get<Product>(`/api/products/${id}`)
    const catalogReq = api.get<Product[]>('/api/products').catch(() => [] as Product[])
    productReq
      .then(async (p) => {
        setProduct(p)
        if (!isCommissionProduct(p)) setCatalog(await catalogReq)
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : '商品不存在'))
      .finally(() => setLoading(false))
  }, [id])

  useEffect(() => {
    if (!user || !product || isCommissionProduct(product)) return
    let alive = true
    api
      .get<Order | null>(`/api/orders/mine/for-product/${product.id}`)
      .then((order) => {
        if (!alive || !order) return
        const next = ownedFromOrder(order, product.id)
        if (next) setOwned(next)
      })
      .catch(() => {
        /* ignore */
      })
    return () => {
      alive = false
    }
  }, [user, product])

  const related = useMemo(() => (product ? relatedOf(catalog, product) : []), [catalog, product])
  const commissionProduct = useMemo(() => catalog.find(isCommissionProduct) || null, [catalog])

  if (loading) {
    return <div className="wrap py-20 text-center text-ink-mute">加载中…</div>
  }

  if (error || !product) {
    return (
      <div className="wrap py-20 text-center">
        <p className="mb-4 text-ink-mute">{error || '商品不存在'}</p>
        <Link to="/" className="font-semibold text-teal hover:underline">
          返回商城
        </Link>
      </div>
    )
  }

  if (isCommissionProduct(product)) {
    return <CommissionProductView product={product} />
  }

  const debugMode = !!publicSettings?.debugMode
  const isFree = product.price === 0
  const qty = clampCartQty(quantity)
  const money = splitMoney(product.price)
  const lineTotal = Math.round(product.price * qty * 100) / 100
  const excerpt = descExcerpt(product.desc)
  const serial = `LX-${String(product.id).padStart(3, '0')}`
  const tone = coverClass(product)
  const payHint = payment ? payHintOf(payment) : ''
  const brand = publicSettings?.name || '领匣'
  const metaBits = ['数字下载', '支付即发', '随时取阅']

  function ensurePayment(): boolean {
    if (debugMode || isFree) return true
    if (!payment) {
      showToast(paymentRequired ? '请选择购买渠道' : '暂无可用支付方式，请稍后再试')
      return false
    }
    return true
  }

  function handleAddCart() {
    if (!product) return
    addProduct(product, payment, { openDrawer: true, quantity: qty })
    showToast(qty > 1 ? `已加入购物车：${product.name} ×${qty}` : `已加入购物车：${product.name}`)
  }

  async function downloadFile(url: string, name: string) {
    try {
      await api.download(url, name)
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : '下载失败')
    }
  }

  async function copyPayload(text: string) {
    try {
      await navigator.clipboard.writeText(text)
      showToast('已复制到剪贴板')
    } catch {
      showToast('复制失败')
    }
  }

  async function handleBuyNow() {
    if (!product) return
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
          const next = ownedFromOrder(res.order, product.id)
          if (next) setOwned(next)
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

  const buyLabel = buying
    ? debugMode || isFree
      ? '处理中…'
      : '跳转支付中…'
    : debugMode
      ? '调试购买'
      : isFree
        ? '免费领取'
        : `立即购买 ${formatMoney(lineTotal)}`

  return (
    <>
      <main className="pb-16 pt-8 md:pb-24 md:pt-10">
        <div className="wrap">
          <PageBreadcrumb
            items={[
              { label: '商城', to: '/' },
              { label: product.category_name || '商品', to: '/#shop' },
              { label: product.name },
            ]}
          />

          <section className="hero-card">
            <div className={`hero-cover ${tone} ${product.cover_url ? 'has-img' : ''}`}>
              {product.cover_url ? (
                <img src={product.cover_url} alt="" className="absolute inset-0 h-full w-full object-cover" />
              ) : null}
              <span className="c-serial">{serial}</span>
              <span className="c-tag">{product.category_name || '作品'}</span>
              {product.cover_url ? null : <span className="c-big">{coverGlyph(product.name)}</span>}
            </div>

            <div className="pd-buy">
              <p className="pd-eyebrow">{product.category_name || '数字作品'}</p>
              <h1>{product.name}</h1>
              {excerpt ? <p className="sub">{excerpt}</p> : null}
              <div className="pd-meta">
                {metaBits.map((bit, i) => (
                  <span key={bit} className="inline-flex items-center gap-2">
                    {i > 0 ? <span className="sep" aria-hidden /> : null}
                    {bit}
                  </span>
                ))}
              </div>

              <div className="pd-price-row">
                <span className="pd-price">
                  ¥{money.head}
                  <small>{money.frac}</small>
                </span>
                {qty > 1 ? (
                  <span className="pd-subtotal">
                    小计 <b>{formatMoney(lineTotal)}</b>
                  </span>
                ) : null}
              </div>

              {owned ? (
                <>
                  <div className="pd-owned">
                    <Check className="h-[15px] w-[15px] shrink-0" strokeWidth={2.2} />
                    已拥有此作品
                    <Link to={`/orders/${owned.orderId}`}>{owned.orderId}</Link>
                  </div>
                  <span className="pd-flabel">发放内容</span>
                  {owned.payload ? (
                    <div className="mb-1">
                      <div className="max-h-40 overflow-auto rounded-[14px] border border-[var(--line)] bg-[#f4f8f6] px-4 py-3 text-[0.86rem] leading-[1.8]">
                        <MarkdownContent content={owned.payload} />
                      </div>
                      <button
                        type="button"
                        className="mt-2 inline-flex items-center gap-1.5 text-[0.76rem] font-bold text-teal hover:underline"
                        onClick={() => copyPayload(owned.payload || '')}
                      >
                        <Copy className="h-3 w-3" strokeWidth={1.8} />
                        复制原文
                      </button>
                    </div>
                  ) : null}
                  {owned.files.length ? (
                    <div className="pd-owned-files">
                      <DeliveryFileList variant="slip" files={owned.files} onDownload={downloadFile} />
                    </div>
                  ) : null}
                  {!owned.payload && !owned.files.length ? (
                    <p className="text-[0.84rem] leading-relaxed text-ink-mute">
                      发货内容已写入订单，可前往
                      <Link to={`/orders/${owned.orderId}`} className="font-semibold text-teal hover:underline">
                        订单详情
                      </Link>
                      查看。
                    </p>
                  ) : null}
                  <div className="pd-acts">
                    <Link to={owned.orderId ? `/orders/${owned.orderId}` : '/orders'} className="pd-btn-line">
                      <ReceiptText className="h-[15px] w-[15px]" strokeWidth={1.8} />
                      我的订单
                    </Link>
                    <button type="button" className="pd-btn-teal" onClick={handleAddCart}>
                      再次购买
                      <ArrowRight className="h-[15px] w-[15px]" strokeWidth={1.8} />
                    </button>
                  </div>
                </>
              ) : (
                <>
                  {debugMode ? (
                    <div className="mt-5 rounded-xl border border-[rgba(196,165,116,.45)] bg-[rgba(196,165,116,.12)] px-3.5 py-3 text-[0.82rem] text-[#8b6b3d]">
                      调试模式已开启：购买将跳过真实支付并直接发货
                    </div>
                  ) : isFree ? (
                    <div className="mt-5 rounded-xl border border-[rgba(15,110,92,.25)] bg-[rgba(15,110,92,.08)] px-3.5 py-3 text-[0.82rem] text-teal">
                      本商品免费，点击领取后将直接发放
                    </div>
                  ) : null}

                  {!isFree ? (
                    <>
                      <span className="pd-flabel">购买数量</span>
                      <QuantityStepper value={quantity} onChange={setQuantity} />

                    </>
                  ) : null}

                  {!debugMode && !isFree ? (
                    <>
                      <span className="pd-flabel">支付方式</span>
                      <PaymentMethodPicker
                        variant="cards"
                        value={payment?.id || null}
                        onChange={setPayment}
                        onAvailabilityChange={setPaymentRequired}
                      />
                    </>
                  ) : null}

                  {needEmail ? (
                    <>
                      <span className="pd-flabel">收货邮箱</span>
                      <label className="pd-mail">
                        <Mail className="h-[15px] w-[15px] shrink-0 text-ink-mute" strokeWidth={1.8} />
                        <input
                          type="email"
                          value={checkoutEmail}
                          onChange={(e) => setCheckoutEmail(e.target.value)}
                          placeholder="you@example.com"
                          autoComplete="email"
                          required
                        />
                      </label>
                      <p className="mt-[7px] text-[0.72rem] text-ink-mute">用于发货通知与游客查单；登录用户自动跳过</p>
                    </>
                  ) : null}

                  <div className={`pd-acts${isFree ? ' !grid-cols-1' : ''}`}>
                    {!isFree ? (
                      <button type="button" className="pd-btn-line" onClick={handleAddCart}>
                        <ShoppingBag className="h-[15px] w-[15px]" strokeWidth={1.8} />
                        加入购物车
                      </button>
                    ) : null}
                    <button type="button" className="pd-btn-teal" disabled={buying || authLoading} onClick={handleBuyNow}>
                      {buyLabel}
                      {buying ? null : <ArrowRight className="h-[15px] w-[15px]" strokeWidth={1.8} />}
                    </button>
                  </div>
                  {!debugMode && !isFree && payHint ? (
                    <p className="pd-pay-hint">
                      将跳转 <b>{payHint}</b> 完成支付
                    </p>
                  ) : null}
                </>
              )}

              <ul className="pd-checks">
                {(isFree
                  ? ['点击领取立即发货，无需等待', '发放内容仅买家可见', '「我的订单」随时查看、重复下载']
                  : ['付款成功自动发货，无需等待', '发放内容仅买家可见', '「我的订单」随时查看、重复下载']
                ).map((t) => (
                  <li key={t}>
                    <i>
                      <Check className="h-[11px] w-[11px]" strokeWidth={2.4} />
                    </i>
                    {t}
                  </li>
                ))}
              </ul>
            </div>
          </section>

          <div className="pd-below">
            <section className="pd-detail">
              <h2>
                商品详情
                <small>简介 · 包含内容 · 发货说明</small>
              </h2>
              <MarkdownContent content={product.desc} />
            </section>

            <aside className="pd-rail">
              {related.length ? (
                <>
                  <h3>
                    相关推荐
                    <Link to="/#shop">全部作品</Link>
                  </h3>
                  <ul className="pd-rel">
                    {related.map((p) => {
                      const commission = isCommissionProduct(p)
                      return (
                        <li key={p.id}>
                          <Link to={`/product/${p.id}`} className="flex min-w-0 flex-1 items-center gap-3">
                            <i className={`rc-cov ${coverClass(p)} ${p.cover_url ? 'has-img' : ''}`}>
                              {p.cover_url ? (
                                <img src={p.cover_url} alt="" className="absolute inset-0 h-full w-full object-cover" />
                              ) : (
                                <s>{coverGlyph(p.name)}</s>
                              )}
                            </i>
                            <span className="r-meta min-w-0">
                              <b>{p.name}</b>
                              <small>{commission ? '定制约稿' : p.category_name || '数字下载'}</small>
                            </span>
                            <span className="r-price">{commission ? formatPerK(p.price) : formatYuan(p.price)}</span>
                          </Link>
                        </li>
                      )
                    })}
                  </ul>
                </>
              ) : null}

              <div className="pd-promo">
                <p className="p-mono">COMMISSION</p>
                <b>想看的剧情，我来写</b>
                <p>番外续写、CP 点梗、长篇定制，按字数计价，定金开工。</p>
                <Link to={commissionProduct ? `/product/${commissionProduct.id}` : '/#commission'}>
                  了解定制约稿
                  <ArrowRight className="h-[13px] w-[13px]" strokeWidth={1.8} />
                </Link>
              </div>
            </aside>
          </div>
        </div>
      </main>

      <footer className="border-t border-[var(--line)] py-[26px] pb-[30px]">
        <div className="wrap flex flex-wrap items-center justify-between gap-3 text-[0.8rem] text-ink-mute">
          <span className="inline-flex items-center gap-2 font-semibold text-ink-soft">
            <span className="brand-mark !h-5 !w-5 !rounded-md" aria-hidden />
            © 2026 {brand} Lingxia
          </span>
          <div className="flex gap-5">
            <Link to="/#shop" className="hover:text-teal">
              商品
            </Link>
            <Link to={commissionProduct ? `/product/${commissionProduct.id}` : '/#commission'} className="hover:text-teal">
              约稿
            </Link>
            <Link to="/orders" className="hover:text-teal">
              我的订单
            </Link>
            <button type="button" className="hover:text-teal" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
              回到顶部
            </button>
          </div>
          <span className="font-[family-name:var(--font-mono)] text-[0.72rem]">xingx.shop</span>
        </div>
      </footer>
    </>
  )
}
