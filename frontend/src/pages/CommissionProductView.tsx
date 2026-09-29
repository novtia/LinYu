import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Check, Mail, MessageSquare, PenLine } from 'lucide-react'
import { ApiError, api } from '../lib/api'
import { setGuestEmail } from '../lib/guestEmail'
import { useAuth } from '../context/AuthContext'
import { usePurchaseResult } from '../context/PurchaseResultContext'
import { useToast } from '../context/ToastContext'
import { CommissionChat } from '../components/CommissionChat'
import { MarkdownContent } from '../components/MarkdownContent'
import { PageBreadcrumb } from '../components/PageBreadcrumb'
import { PaymentMethodPicker } from '../components/PaymentMethodPicker'
import { resolveCheckoutResult } from '../lib/checkout'
import {
  DEFAULT_WORDS,
  GENRE_TAGS,
  MIN_WORDS,
  QUOTE_SAMPLES,
  WORD_PRESETS,
  commissionTotal,
  formatPerK,
  formatWords,
  formatYuan,
  isCommissionProduct,
  splitPrice,
} from '../lib/commission'
import { coverGlyph, formatMoney, splitMoney } from '../lib/orderDisplay'
import type { CheckoutResult, CommissionThread, Product, PublicPaymentMethod } from '../types'

const FLOW = [
  { n: '1', title: '沟通设定', desc: '人设、尺度、禁触先聊清楚，不定稿不收费' },
  { n: '2', title: '支付定金', desc: '定金 50% 锁定档期，超时未付自动取消' },
  { n: '3', title: '按章交稿', desc: '大纲确认后动笔，分章交付可随时反馈' },
  { n: '4', title: '支付尾款', desc: '全文交付满意后付尾款，解锁下载' },
] as const

const CHECKS = [
  '先付定金开工，交稿验收后再付尾款',
  '大纲阶段不限次调整，每章含一次免费修改',
  '尾款到账解锁 DOCX / EPUB 双格式下载',
]

function coverClass(p: Pick<Product, 'cover'>) {
  return /^p[1-6]$/.test(p.cover || '') ? p.cover : 'p2'
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

export function CommissionProductView({ product }: { product: Product }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const [pane, setPane] = useState<'brief' | 'talk'>(searchParams.get('pane') === 'talk' ? 'talk' : 'brief')
  const [words, setWords] = useState(DEFAULT_WORDS)
  const [wordsOk, setWordsOk] = useState(true)
  const [payment, setPayment] = useState<PublicPaymentMethod | null>(null)
  const [paymentRequired, setPaymentRequired] = useState(false)
  const [buying, setBuying] = useState(false)
  const [checkoutEmail, setCheckoutEmail] = useState('')
  const [thread, setThread] = useState<CommissionThread | null>(null)
  const [catalog, setCatalog] = useState<Product[]>([])
  const talkRef = useRef<HTMLDivElement>(null)
  const { user, loading: authLoading, publicSettings, refreshMe, openAuth } = useAuth()
  const { showToast } = useToast()
  const { showPurchaseResult } = usePurchaseResult()
  const debugMode = !!publicSettings?.debugMode
  const needEmail = !authLoading && !user?.email
  const brand = publicSettings?.name || '领匣'
  const rate = splitMoney(product.price)
  const serial = `LX-COMMISSION-${String(product.id).padStart(2, '0')}`

  useEffect(() => {
    document.body.setAttribute('data-nav', 'commission')
    return () => document.body.removeAttribute('data-nav')
  }, [])

  useEffect(() => {
    if (searchParams.get('pane') === 'talk') setPane('talk')
  }, [searchParams])

  useEffect(() => {
    api
      .get<Product[]>('/api/products')
      .then(setCatalog)
      .catch(() => setCatalog([]))
  }, [])

  useEffect(() => {
    if (!user || pane !== 'talk') return
    let alive = true
    api
      .get<CommissionThread>(`/api/commission/threads/mine/product/${product.id}`)
      .then((t) => {
        if (alive) setThread(t)
      })
      .catch((e) => {
        if (alive) showToast(e instanceof ApiError ? e.message : '无法打开对话')
      })
    return () => {
      alive = false
    }
  }, [user, pane, product.id, showToast])

  const quote = useMemo(() => {
    const total = commissionTotal(product.price, words)
    return { total, ...splitPrice(total) }
  }, [product.price, words])

  const related = useMemo(() => relatedOf(catalog, product), [catalog, product])
  const payHint = payment ? payHintOf(payment) : ''

  function setPaneAndUrl(next: 'brief' | 'talk') {
    setPane(next)
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev)
        if (next === 'talk') params.set('pane', 'talk')
        else params.delete('pane')
        return params
      },
      { replace: true },
    )
  }

  function openTalk() {
    setPaneAndUrl('talk')
    if (!user) {
      openAuth('login')
      showToast('登录后即可与作者沟通')
    }
  }

  useEffect(() => {
    if (pane !== 'talk') return
    talkRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [pane])

  function applyWords(next: number, ok: boolean) {
    setWords(next)
    setWordsOk(ok)
  }

  function ensurePayment() {
    if (debugMode) return true
    if (!payment) {
      showToast(paymentRequired ? '请选择购买渠道' : '暂无可用支付方式，请稍后再试')
      return false
    }
    return true
  }

  async function handlePayDeposit() {
    if (!user) {
      openAuth('login')
      showToast('约稿商品请先登录')
      return
    }
    if (!wordsOk || words < MIN_WORDS) {
      showToast(`至少 ${MIN_WORDS.toLocaleString('zh-CN')} 字起约`)
      return
    }
    if (!ensurePayment()) return
    if (publicSettings?.maintain) {
      showToast('站点维护中，暂停下单')
      return
    }
    const email = checkoutEmail.trim()
    if (needEmail && !email) {
      showToast('请填写收货邮箱')
      return
    }
    setBuying(true)
    try {
      const res = await api.post<CheckoutResult>('/api/orders/checkout', {
        items: [{ id: product.id, name: product.name, price: product.price }],
        payment_method_id: payment?.id || '',
        word_count: words,
        ...(needEmail ? { email } : {}),
      })
      if (needEmail) setGuestEmail(email)
      if (user) await refreshMe()
      const outcome = resolveCheckoutResult(res)
      if (outcome === 'paid' || outcome === 'deposit') {
        showPurchaseResult({
          status: 'success',
          message: debugMode ? '调试模式：已跳过定金，订单已进入约稿。' : '定金已支付，可在「我的约稿」查看该笔订单。',
          orderId: res.order.id,
        })
        return
      }
      if (outcome === 'redirect') {
        window.location.href = res.pay_url
        return
      }
      showPurchaseResult({ status: 'failure', message: '未能生成支付链接，请稍后重试。', orderId: res.order.id })
    } catch (e) {
      showPurchaseResult({
        status: 'failure',
        message: e instanceof ApiError ? e.message : '购买失败，请稍后重试。',
      })
    } finally {
      setBuying(false)
    }
  }

  const ctaLabel = buying
    ? '处理中…'
    : !user
      ? '登录后支付定金'
      : wordsOk
        ? `支付定金 ${formatMoney(quote.deposit)}`
        : `至少 ${MIN_WORDS.toLocaleString('zh-CN')} 字起约`

  return (
    <>
      <main className="pb-16 pt-8 md:pb-24 md:pt-10">
        <div className="wrap">
          <PageBreadcrumb
            items={[
              { label: '商城', to: '/' },
              { label: product.category_name || '定制约稿', to: '/#commission' },
              { label: product.name },
            ]}
          />

          <section className="hero-card cm-hero">
            <div className="hero-cover cm-cover">
              <span className="c-serial">{serial}</span>
              <span className="c-sched">
                <i />
                排期开放
              </span>
              <span className="c-ico">
                <PenLine className="h-[46px] w-[46px]" strokeWidth={1.6} />
              </span>
              <span className="c-rate">
                ¥{rate.head}
                <small>
                  {rate.frac} /k
                </small>
              </span>
              <span className="c-tag">定制约稿 · 按字计价</span>
              <span className="c-big">约</span>
            </div>

            <div className="pd-buy">
              <p className="pd-eyebrow">COMMISSION STUDIO</p>
              <h1>{product.name}</h1>
              <p className="sub">
                先把人设、尺度和禁触说清楚，确认档期后付定金。大纲通过再按章交稿，全文交付后付尾款解锁。
              </p>
              <div className="pd-meta">
                {['按字计价', '一对一沟通', '按章交稿', '尾款后解锁'].map((bit, i) => (
                  <span key={bit} className="inline-flex items-center gap-2">
                    {i > 0 ? <span className="sep" aria-hidden /> : null}
                    {bit}
                  </span>
                ))}
              </div>

              <dl className="cm-q-grid">
                <div className="cm-q-cell">
                  <dt>约稿字数</dt>
                  <dd>
                    <label className="cm-words">
                      <input
                        type="number"
                        min={MIN_WORDS}
                        step={1000}
                        inputMode="numeric"
                        value={Number.isFinite(words) ? words : ''}
                        onChange={(e) => {
                          const raw = Number(e.target.value)
                          if (!Number.isFinite(raw) || raw < MIN_WORDS) {
                            applyWords(raw, false)
                            return
                          }
                          applyWords(Math.round(raw), true)
                        }}
                        onBlur={() => {
                          if (!Number.isFinite(words) || words < MIN_WORDS) applyWords(MIN_WORDS, true)
                        }}
                        className={wordsOk ? '' : 'err'}
                      />
                      <em>字</em>
                    </label>
                  </dd>
                </div>
                <div className="cm-q-cell">
                  <dt>合计</dt>
                  <dd>{wordsOk ? formatYuan(quote.total) : '—'}</dd>
                </div>
                <div className="cm-q-cell">
                  <dt>定金 50%</dt>
                  <dd className="teal">{wordsOk ? formatYuan(quote.deposit) : '—'}</dd>
                </div>
                <div className="cm-q-cell">
                  <dt>尾款</dt>
                  <dd>{wordsOk ? formatYuan(quote.balance) : '—'}</dd>
                </div>
              </dl>

              <div className="cm-presets">
                {WORD_PRESETS.map((w) => (
                  <button
                    key={w}
                    type="button"
                    className={wordsOk && words === w ? 'on' : ''}
                    onClick={() => applyWords(w, true)}
                  >
                    {w.toLocaleString('zh-CN')} 字
                  </button>
                ))}
              </div>

              {debugMode ? (
                <div className="mt-5 rounded-xl border border-[rgba(196,165,116,.45)] bg-[rgba(196,165,116,.12)] px-3.5 py-3 text-[0.82rem] text-[#8b6b3d]">
                  调试模式已开启：支付定金将跳过真实付款
                </div>
              ) : (
                <>
                  <span className="pd-flabel">支付方式（定金）</span>
                  <PaymentMethodPicker
                    variant="cards"
                    value={payment?.id || null}
                    onChange={setPayment}
                    onAvailabilityChange={setPaymentRequired}
                  />
                </>
              )}

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
                  <p className="mt-[7px] text-[0.72rem] text-ink-mute">用于发货通知与查询订单；登录用户自动跳过</p>
                </>
              ) : null}

              <div className="pd-acts">
                <button type="button" className="pd-btn-line" onClick={openTalk}>
                  <MessageSquare className="h-[15px] w-[15px]" strokeWidth={1.8} />
                  先沟通看看
                </button>
                <button type="button" className="pd-btn-teal" disabled={buying || authLoading} onClick={handlePayDeposit}>
                  <PenLine className="h-[15px] w-[15px]" strokeWidth={1.8} />
                  {ctaLabel}
                </button>
              </div>
              <p className="pd-pay-hint">
                {wordsOk ? (
                  <>
                    {debugMode ? '调试模式将跳过真实支付' : payHint ? <>将跳转 <b>{payHint}</b> 完成支付</> : '选择支付方式后跳转收银台'}
                    {' · '}
                    {formatWords(words)} · {formatPerK(product.price)}
                  </>
                ) : (
                  <>最少 {MIN_WORDS.toLocaleString('zh-CN')} 字起约</>
                )}
              </p>

              <ul className="pd-checks">
                {CHECKS.map((t) => (
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

          <ol className="cm-flow4">
            {FLOW.map((step) => (
              <li key={step.n}>
                <span className="n">{step.n}</span>
                <b>{step.title}</b>
                <span>{step.desc}</span>
              </li>
            ))}
          </ol>

          <div className="pd-below">
            <section className="min-w-0" style={{ animation: 'riseIn .5s var(--ease) .08s both' }}>
              <nav className="cm-tabs" aria-label="约稿内容">
                <button type="button" className={pane === 'brief' ? 'on' : ''} onClick={() => setPaneAndUrl('brief')}>
                  约稿说明
                </button>
                <button type="button" className={pane === 'talk' ? 'on' : ''} onClick={openTalk}>
                  与作者沟通
                  <span className="cm-online" aria-hidden />
                </button>
              </nav>

              {pane === 'brief' ? (
                <div>
                  <div className="cm-brief-stats">
                    <div>
                      <small>计价</small>
                      <b>{formatMoney(product.price)} / 千字</b>
                    </div>
                    <div>
                      <small>起步</small>
                      <b>{MIN_WORDS.toLocaleString('zh-CN')} 字</b>
                    </div>
                    <div>
                      <small>交付</small>
                      <b>定金后按章交稿</b>
                    </div>
                    <div>
                      <small>解锁</small>
                      <b>尾款后下载全文</b>
                    </div>
                  </div>
                  <div className="pt-3.5">
                    <MarkdownContent content={product.desc} />
                  </div>
                </div>
              ) : (
                <div ref={talkRef} className="pt-[26px]">
                  <div className="cm-talk-card">
                    <CommissionChat
                      threadId={thread?.id || null}
                      viewer="user"
                      active={pane === 'talk'}
                      mineAvatar={user?.username.slice(0, 1) || '我'}
                      peerAvatar="匣"
                      placeholder="写人设、尺度、禁触…"
                      className="h-[min(560px,70vh)]"
                      deliveryLabel={product.name}
                      header={
                        <div className="cm-chat-head">
                          <div className="c-av">匣</div>
                          <div className="c-meta">
                            <b>领匣作者</b>
                            <small>本商品的沟通，与订单分开</small>
                          </div>
                          <div className="c-right">
                            <span className="cm-st-online">
                              <i />
                              在线
                            </span>
                          </div>
                        </div>
                      }
                    />
                  </div>
                </div>
              )}
            </section>

            <aside className="pd-rail">
              <div className="cm-quote-card">
                <p className="q-mono">报价示例 · QUOTE</p>
                {QUOTE_SAMPLES.map((q) => (
                  <div key={q.words} className="q-row">
                    <span>{q.label}</span>
                    <b>{formatMoney(commissionTotal(product.price, q.words))}</b>
                  </div>
                ))}
                <div className="q-foot">定金 50% 开工 · {formatPerK(product.price)}</div>
              </div>

              <div className="mt-[30px]">
                <h3>
                  题材范围
                  <small>点梗前可参考</small>
                </h3>
                <div className="cm-tags">
                  {GENRE_TAGS.map((tag) => (
                    <button key={tag} type="button" onClick={openTalk}>
                      {tag}
                    </button>
                  ))}
                </div>
              </div>

              {related.length ? (
                <div className="mt-[30px]">
                  <h3>
                    相关作品
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
                </div>
              ) : null}
            </aside>
          </div>
        </div>
      </main>

      <footer className="mt-[30px] border-t border-[var(--line)] py-[26px] pb-[30px]">
        <div className="wrap flex flex-wrap items-center justify-between gap-3 text-[0.8rem] text-ink-mute">
          <span className="inline-flex items-center gap-2 font-semibold text-ink-soft">
            <span className="brand-mark !h-5 !w-5 !rounded-md" aria-hidden />
            © 2026 {brand} Lingxia
          </span>
          <div className="flex gap-5">
            <Link to="/#shop" className="hover:text-teal">
              商品
            </Link>
            <Link to="/#commission" className="hover:text-teal">
              约稿
            </Link>
            <Link to="/orders" className="hover:text-teal">
              我的订单
            </Link>
            <button type="button" className="hover:text-teal" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
              回到顶部
            </button>
          </div>
          <span className="font-[family-name:var(--font-mono)] text-[0.72rem]">{publicSettings?.domain}</span>
        </div>
      </footer>
    </>
  )
}
