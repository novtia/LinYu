import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ApiError, api } from '../lib/api'
import { setGuestEmail } from '../lib/guestEmail'
import { useAuth } from '../context/AuthContext'
import { usePurchaseResult } from '../context/PurchaseResultContext'
import { useToast } from '../context/ToastContext'
import { CommissionChat } from '../components/CommissionChat'
import { MarkdownContent } from '../components/MarkdownContent'
import { PageBreadcrumb } from '../components/PageBreadcrumb'
import { PaymentMethodPicker } from '../components/PaymentMethodPicker'
import { ProductMedia } from '../components/ProductMedia'
import { resolveCheckoutResult } from '../lib/checkout'
import { MIN_WORDS, commissionTotal, formatPerK, formatWords, formatYuan, splitPrice } from '../lib/commission'
import type { CheckoutResult, CommissionThread, Product, PublicPaymentMethod } from '../types'

const FLOW = ['沟通设定', '支付定金', '按章交稿', '支付尾款'] as const

export function CommissionProductView({ product }: { product: Product }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const [pane, setPane] = useState<'brief' | 'talk'>(searchParams.get('pane') === 'talk' ? 'talk' : 'brief')
  const [words, setWords] = useState(20000)
  const [wordsOk, setWordsOk] = useState(true)
  const [payment, setPayment] = useState<PublicPaymentMethod | null>(null)
  const [paymentRequired, setPaymentRequired] = useState(false)
  const [buying, setBuying] = useState(false)
  const [checkoutEmail, setCheckoutEmail] = useState('')
  const [thread, setThread] = useState<CommissionThread | null>(null)
  const { user, loading: authLoading, publicSettings, refreshMe, openAuth } = useAuth()
  const { showToast } = useToast()
  const { showPurchaseResult } = usePurchaseResult()
  const debugMode = !!publicSettings?.debugMode
  const needEmail = !authLoading && !user?.email

  useEffect(() => {
    if (searchParams.get('pane') === 'talk') setPane('talk')
  }, [searchParams])

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

  function openTalk() {
    setPane('talk')
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.set('pane', 'talk')
      return next
    }, { replace: true })
  }

  function openBrief() {
    setPane('brief')
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.delete('pane')
      return next
    }, { replace: true })
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

  return (
    <main className="pb-16 md:pb-24">
      <div className="wrap pt-6 md:pt-8">
        <PageBreadcrumb
          items={[
            { label: '商城', to: '/' },
            { label: product.category_name || '约稿', to: '/#shop' },
            { label: product.name },
          ]}
        />

        <h1 className="mt-3.5 font-[family-name:var(--font-display)] text-[clamp(2rem,4vw,2.7rem)] font-extrabold leading-[1.12] tracking-[-0.04em]">
          {product.name}
        </h1>
        <p className="mt-2 mb-[18px] max-w-[34em] text-base leading-relaxed text-ink-soft">
          先把人设、尺度和禁触说清楚，确认档期后付定金。大纲通过再按章交稿，全文交付后付尾款解锁。
        </p>

        <section className="mt-9 grid items-stretch gap-10 border-t border-[var(--line)] pt-9 md:grid-cols-[minmax(200px,260px)_minmax(0,1fr)]">
          <div className="mx-auto w-full max-w-[240px] overflow-hidden rounded-sm bg-[#1a2c27] md:mx-0 md:h-full md:max-w-none">
            <ProductMedia
              cover={product.cover}
              coverUrl={product.cover_url}
              className="h-full"
              aspectClass="aspect-[3/4] h-full md:aspect-auto"
            />
          </div>
          <div className="flex min-w-0 flex-col justify-center">
            <div className="font-[family-name:var(--font-display)] text-[3rem] font-extrabold leading-none tracking-[-0.05em]">
              {formatYuan(product.price)}
              <small className="ml-1 text-[1.05rem] font-semibold tracking-normal text-ink-mute">/k</small>
            </div>
            <dl className="my-7 grid grid-cols-2 border-y border-[var(--line)] md:grid-cols-[1.4fr_repeat(3,1fr)]">
              <div className="py-4">
                <dt className="mb-1.5 text-[0.72rem] tracking-[0.06em] text-ink-mute">约稿字数</dt>
                <dd className="m-0 text-[1.05rem] font-bold">
                  <label className="inline-flex items-baseline gap-1.5">
                    <input
                      type="number"
                      min={MIN_WORDS}
                      step={1000}
                      inputMode="numeric"
                      value={words}
                      onChange={(e) => {
                        const raw = Number(e.target.value)
                        if (!Number.isFinite(raw) || raw < MIN_WORDS) {
                          setWords(raw)
                          setWordsOk(false)
                          return
                        }
                        setWords(Math.round(raw))
                        setWordsOk(true)
                      }}
                      onBlur={() => {
                        if (!Number.isFinite(words) || words < MIN_WORDS) {
                          setWords(MIN_WORDS)
                          setWordsOk(true)
                        }
                      }}
                      className="w-24 border-0 border-b border-ink bg-transparent pb-0.5 text-[1.05rem] font-bold outline-none focus:border-teal focus:text-teal"
                    />
                    <em className="not-italic text-[0.82rem] font-semibold text-ink-mute">字</em>
                  </label>
                </dd>
              </div>
              <div className="border-t border-[var(--line)] py-4 md:border-t-0 md:border-l md:pl-5">
                <dt className="mb-1.5 text-[0.72rem] tracking-[0.06em] text-ink-mute">合计</dt>
                <dd className="m-0 text-[1.05rem] font-bold">{wordsOk ? formatYuan(quote.total) : '—'}</dd>
              </div>
              <div className="border-t border-[var(--line)] py-4 md:border-t-0 md:border-l md:pl-5">
                <dt className="mb-1.5 text-[0.72rem] tracking-[0.06em] text-ink-mute">定金</dt>
                <dd className="m-0 text-[1.05rem] font-bold">{wordsOk ? formatYuan(quote.deposit) : '—'}</dd>
              </div>
              <div className="border-t border-[var(--line)] py-4 md:border-t-0 md:border-l md:pl-5">
                <dt className="mb-1.5 text-[0.72rem] tracking-[0.06em] text-ink-mute">尾款</dt>
                <dd className="m-0 text-[1.05rem] font-bold">{wordsOk ? formatYuan(quote.balance) : '—'}</dd>
              </div>
            </dl>

            {!debugMode ? (
              <PaymentMethodPicker className="mb-4" value={payment?.id || null} onChange={setPayment} onAvailabilityChange={setPaymentRequired} />
            ) : null}
            {needEmail ? (
              <label className="mb-4 block">
                <span className="mb-1.5 block text-[0.82rem] font-semibold text-ink-soft">收货邮箱</span>
                <input
                  className="field-input"
                  type="email"
                  value={checkoutEmail}
                  onChange={(e) => setCheckoutEmail(e.target.value)}
                  placeholder="用于发货通知与查询订单"
                />
              </label>
            ) : null}

            <button
              type="button"
              disabled={buying || authLoading}
              className="inline-flex h-11 w-[220px] items-center justify-center bg-teal px-[18px] font-bold text-white hover:bg-teal-deep disabled:opacity-60"
              onClick={handlePayDeposit}
            >
              {buying ? '处理中…' : !user ? '登录后支付定金' : wordsOk ? `支付定金 ${formatYuan(quote.deposit)}` : '请填写字数'}
            </button>
            <p className="mt-3 text-[0.8rem] text-ink-mute">
              {wordsOk ? `${formatWords(words)} · ${formatPerK(product.price)}` : `至少 ${MIN_WORDS.toLocaleString('zh-CN')} 字`}
              {debugMode ? ' · 调试模式将跳过真实支付' : ''}
            </p>
          </div>
        </section>

        <ol className="mt-10 grid list-none grid-cols-2 gap-0 p-0 md:grid-cols-4">
          {FLOW.map((label) => (
            <li key={label} className="relative pr-4 text-[0.86rem] text-ink-soft">
              <span className="mb-2.5 block h-[7px] w-[7px] rounded-full bg-teal" />
              {label}
            </li>
          ))}
        </ol>

        <section className="mt-12 border-t border-[var(--line)]">
          <nav className="flex gap-7 border-b border-[var(--line)]" aria-label="约稿内容">
            <button
              type="button"
              className={`relative h-12 bg-transparent text-[0.95rem] font-semibold ${pane === 'brief' ? 'text-ink after:absolute after:right-0 after:bottom-[-1px] after:left-0 after:h-0.5 after:bg-ink' : 'text-ink-mute hover:text-ink'}`}
              onClick={openBrief}
            >
              约稿说明
            </button>
            <button
              type="button"
              className={`relative h-12 bg-transparent text-[0.95rem] font-semibold ${pane === 'talk' ? 'text-ink after:absolute after:right-0 after:bottom-[-1px] after:left-0 after:h-0.5 after:bg-ink' : 'text-ink-mute hover:text-ink'}`}
              onClick={() => {
                if (!user) {
                  openAuth('login')
                  showToast('登录后即可与作者沟通')
                  return
                }
                openTalk()
              }}
            >
              与作者沟通
            </button>
          </nav>

          {pane === 'brief' ? (
            <div className="pt-7">
              <div className="mb-7 grid grid-cols-2 gap-6 border-b border-[var(--line)] pb-7 md:grid-cols-4">
                <div>
                  <small className="mb-1.5 block text-[0.72rem] text-ink-mute">计价</small>
                  <b className="text-[0.95rem]">{formatPerK(product.price)}</b>
                </div>
                <div>
                  <small className="mb-1.5 block text-[0.72rem] text-ink-mute">起步</small>
                  <b className="text-[0.95rem]">{MIN_WORDS.toLocaleString('zh-CN')} 字</b>
                </div>
                <div>
                  <small className="mb-1.5 block text-[0.72rem] text-ink-mute">交付</small>
                  <b className="text-[0.95rem]">定金后按章交稿</b>
                </div>
                <div>
                  <small className="mb-1.5 block text-[0.72rem] text-ink-mute">解锁</small>
                  <b className="text-[0.95rem]">尾款后下载</b>
                </div>
              </div>
              <MarkdownContent content={product.desc} />
            </div>
          ) : (
            <div className="pt-7">
              <CommissionChat
                threadId={thread?.id || null}
                viewer="user"
                active={pane === 'talk'}
                mineAvatar={user?.username.slice(0, 1) || '我'}
                peerAvatar="匣"
                className="h-[600px] p-4 md:px-[18px]"
                header={
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] pb-3">
                    <div className="flex items-center gap-2.5">
                      <div className="grid h-8 w-8 place-items-center rounded-full bg-teal text-[0.78rem] font-bold text-white">匣</div>
                      <div>
                        <strong className="block text-[0.92rem]">领匣作者</strong>
                        <span className="text-[0.72rem] text-ink-mute">本商品的沟通，与订单分开</span>
                      </div>
                    </div>
                    <span className="inline-flex items-center gap-1.5 text-[0.75rem] font-bold text-teal">
                      <i className="inline-block h-[7px] w-[7px] rounded-full bg-[#1a9a7c]" />
                      在线
                    </span>
                  </div>
                }
              />
            </div>
          )}
        </section>
      </div>
    </main>
  )
}
