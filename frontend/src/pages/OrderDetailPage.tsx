import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Copy,
  Lock,
  Mail,
  MessageSquare,
  PenLine,
  ShieldCheck,
  ShoppingBag,
  Upload,
  Zap,
} from 'lucide-react'
import { ApiError, api } from '../lib/api'
import { getGuestEmail, orderPath, setGuestEmail } from '../lib/guestEmail'
import { formatYuan } from '../lib/commission'
import { useAuth } from '../context/AuthContext'
import { usePurchaseResult } from '../context/PurchaseResultContext'
import { useToast } from '../context/ToastContext'
import { MarkdownContent } from '../components/MarkdownContent'
import { DeliveryFileList } from '../components/DeliveryFileList'
import { PaymentMethodPicker } from '../components/PaymentMethodPicker'
import {
  channelLabel,
  fmtFullTime,
  formatMoney,
  heroDotClass,
  isCommissionOrder,
  itemFiles,
  maskEmail,
  orderHeroHint,
  orderHeroTitle,
  orderSteps,
  splitMoney,
} from '../lib/orderDisplay'
import type { CheckoutResult, Order, OrderItem, PublicPaymentMethod } from '../types'

export function OrderDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const fromPay = searchParams.get('pay') === '1'
  const { user, loading, publicSettings, openAuth } = useAuth()
  const { showToast } = useToast()
  const { showPurchaseResult } = usePurchaseResult()
  const [order, setOrder] = useState<Order | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(true)
  const [needEmail, setNeedEmail] = useState(false)
  const [emailInput, setEmailInput] = useState(getGuestEmail())
  const [emailKey, setEmailKey] = useState(0)
  const [balancePayment, setBalancePayment] = useState<PublicPaymentMethod | null>(null)
  const [payingBalance, setPayingBalance] = useState(false)
  const [uploading, setUploading] = useState(false)
  const navigate = useNavigate()
  const resultShown = useRef(false)

  function reloadOrder() {
    if (!id) return
    return api.get<Order>(user ? `/api/orders/${id}` : orderPath(id)).then(setOrder)
  }

  useEffect(() => {
    if (loading) return
    if (!id) return
    const canFetch = !!user || !!getGuestEmail()
    if (!canFetch) {
      setNeedEmail(true)
      setBusy(false)
      setOrder(null)
      return
    }
    let alive = true
    setBusy(true)
    setNeedEmail(false)
    setError('')
    api
      .get<Order>(user ? `/api/orders/${id}` : orderPath(id))
      .then((o) => {
        if (alive) setOrder(o)
      })
      .catch((e) => {
        if (!alive) return
        const message = e instanceof ApiError ? e.message : '加载失败'
        if (e instanceof ApiError && e.status === 403 && message.includes('邮箱')) {
          setNeedEmail(true)
          setOrder(null)
          setError('')
          return
        }
        setError(message)
      })
      .finally(() => {
        if (alive) setBusy(false)
      })
    return () => {
      alive = false
    }
  }, [id, user, loading, emailKey])

  useEffect(() => {
    const hasAccess = !!user || !!getGuestEmail()
    if (!fromPay || !id || !hasAccess || !order) return
    const commission = order.sale_mode === 'commission'
    if (order.status === 'completed' || (!commission && order.status === 'paid')) {
      if (!resultShown.current) {
        resultShown.current = true
        showPurchaseResult({
          status: 'success',
          orderId: order.id,
          message: commission ? '尾款已支付，稿件已解锁，可在下方下载。' : '支付成功，商品已自动发货，可在下方查看发放内容。',
        })
        setSearchParams({}, { replace: true })
      }
      return
    }
    if (commission && (order.status === 'deposit_paid' || order.status === 'awaiting_balance')) {
      if (!resultShown.current) {
        resultShown.current = true
        showPurchaseResult({
          status: 'success',
          orderId: order.id,
          message: order.status === 'awaiting_balance' ? '稿件已就绪，请支付尾款后下载。' : '定金已支付，请等待商家交稿。',
        })
        setSearchParams({}, { replace: true })
      }
      return
    }
    if (order.status === 'failed' || order.status === 'cancelled') {
      if (!resultShown.current) {
        resultShown.current = true
        showPurchaseResult({
          status: 'failure',
          orderId: order.id,
          message: '支付未完成，请重新下单或联系客服。',
        })
        setSearchParams({}, { replace: true })
      }
      return
    }

    let tries = 0
    const timer = window.setInterval(async () => {
      tries += 1
      try {
        const next = await api.get<Order>(user ? `/api/orders/${id}` : orderPath(id))
        setOrder(next)
        const nextCommission = next.sale_mode === 'commission'
        const settled =
          next.status === 'completed' ||
          (!nextCommission && next.status === 'paid') ||
          (nextCommission && (next.status === 'deposit_paid' || next.status === 'awaiting_balance'))
        if (settled) {
          window.clearInterval(timer)
          if (!resultShown.current) {
            resultShown.current = true
            showPurchaseResult({
              status: 'success',
              orderId: next.id,
              message: nextCommission
                ? next.status === 'completed'
                  ? '尾款已支付，稿件已解锁，可在下方下载。'
                  : next.status === 'awaiting_balance'
                    ? '稿件已就绪，请支付尾款后下载。'
                    : '定金已支付，请等待商家交稿。'
                : '支付成功，商品已自动发货，可在下方查看发放内容。',
            })
            setSearchParams({}, { replace: true })
          }
        } else if (tries >= 20) {
          window.clearInterval(timer)
          if (!resultShown.current) {
            resultShown.current = true
            showPurchaseResult({
              status: 'failure',
              orderId: next.id,
              message: '暂未确认支付结果，请稍后刷新订单页，或确认是否已完成付款。',
            })
            setSearchParams({}, { replace: true })
          }
        }
      } catch {
        /* ignore transient errors while polling */
      }
    }, 2000)

    return () => window.clearInterval(timer)
  }, [fromPay, id, user, order, showPurchaseResult, setSearchParams])

  function submitEmail(e: FormEvent) {
    e.preventDefault()
    const value = emailInput.trim()
    if (!value) {
      showToast('请填写购买时使用的邮箱')
      return
    }
    setGuestEmail(value)
    setBusy(true)
    setEmailKey((n) => n + 1)
  }

  async function copyText(text: string) {
    try {
      await navigator.clipboard.writeText(text)
      showToast('已复制到剪贴板')
    } catch {
      showToast('复制失败')
    }
  }

  if (needEmail) {
    return (
      <main className="pb-[90px] pt-8 md:pt-10">
        <div className="wrap-order">
          <Link to="/orders" className="mb-[18px] inline-flex items-center gap-1.5 text-[0.84rem] font-semibold text-ink-mute transition hover:text-teal">
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.8} />
            我的订单
          </Link>
          <div className="mx-auto max-w-[560px] rounded-3xl border border-[var(--line)] bg-white px-6 py-9 text-center sm:px-11">
            <div className="mx-auto mb-[18px] grid h-[54px] w-[54px] place-items-center rounded-2xl bg-paper text-teal">
              <Mail className="h-6 w-6" strokeWidth={1.8} />
            </div>
            <h1 className="mb-2.5 font-[family-name:var(--font-display)] text-[1.5rem] tracking-[-0.03em]">查找订单</h1>
            <p className="mb-6 text-[0.86rem] leading-[1.8] text-ink-mute">请填写购买时使用的邮箱后查看发放内容。</p>
            <form onSubmit={submitEmail} className="text-left">
              <label className="mb-5 flex items-center gap-2.5 border-b-[1.5px] border-[var(--line-strong)] pb-2 transition-[border-color] focus-within:border-teal">
                <Mail className="h-[15px] w-[15px] shrink-0 text-ink-mute" strokeWidth={1.8} />
                <input
                  type="email"
                  value={emailInput}
                  onChange={(ev) => setEmailInput(ev.target.value)}
                  placeholder="you@example.com"
                  required
                  className="min-w-0 flex-1 border-0 bg-transparent text-[0.95rem] outline-none"
                />
              </label>
              <button type="submit" className="h-11 w-full rounded-xl bg-teal text-[0.9rem] font-bold text-white hover:bg-teal-deep">
                查看订单
              </button>
            </form>
            <div className="mt-5 text-[0.8rem] text-ink-mute">
              已有账号？
              <button type="button" className="font-bold text-teal hover:underline" onClick={() => openAuth('login')}>
                登录后查看
              </button>
            </div>
          </div>
        </div>
      </main>
    )
  }

  if (busy) return <div className="wrap-order py-20 text-center text-ink-mute">加载中…</div>

  if (error || !order) {
    return (
      <div className="wrap-order py-20 text-center">
        <p className="mb-4 text-ink-mute">{error || '订单不存在'}</p>
        <Link to="/orders" className="font-semibold text-teal hover:underline">
          返回订单列表
        </Link>
      </div>
    )
  }

  const commission = isCommissionOrder(order)
  const delivered = order.status === 'completed' || (!commission && order.status === 'paid')
  const waitingPay = order.status === 'pending'
  const awaitingBalance = commission && order.status === 'awaiting_balance'
  const isAdmin = user?.role === 'admin'
  const deposit = order.deposit_amount ?? 0
  const balance = order.balance_amount ?? 0
  const money = splitMoney(order.total)
  const steps = orderSteps(order)
  const allFiles = order.items.flatMap(itemFiles)
  const hasLockedFiles = awaitingBalance && allFiles.length > 0
  const payLabel = formatYuan(balance)

  async function handlePayBalance() {
    if (!id) return
    if (!balancePayment && !(publicSettings?.debugMode && isAdmin)) {
      showToast('请选择支付方式')
      return
    }
    setPayingBalance(true)
    try {
      const res = await api.post<CheckoutResult>(`/api/orders/${id}/pay-balance`, {
        payment_method_id: balancePayment?.id || '',
      })
      if (res.pay_url) {
        window.location.href = res.pay_url
        return
      }
      setOrder(res.order)
      showPurchaseResult({
        status: 'success',
        orderId: res.order.id,
        message: '尾款已支付，稿件已解锁。',
      })
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : '发起尾款支付失败')
    } finally {
      setPayingBalance(false)
    }
  }

  async function handleUploadManuscript(file: File) {
    if (!id) return
    setUploading(true)
    try {
      await api.upload(`/api/orders/${id}/files`, file)
      await reloadOrder()
      showToast('稿件已上传')
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : '上传失败')
    } finally {
      setUploading(false)
    }
  }

  async function handleDeleteManuscript(fileId: string) {
    if (!id) return
    try {
      await api.delete(`/api/orders/${id}/files/${fileId}`)
      await reloadOrder()
      showToast('已删除稿件')
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : '删除失败')
    }
  }

  async function downloadFile(url: string, name: string) {
    try {
      await api.download(url, name)
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : '下载失败')
    }
  }

  const deliveryCaption = delivered
    ? `${allFiles.length} 个文件 · 永久有效`
    : hasLockedFiles
      ? '待解锁'
      : '暂未发放'

  return (
    <main className="pb-[90px] pt-8 md:pt-10">
      <div className="wrap-order">
        <button
          type="button"
          onClick={() => navigate('/orders')}
          className="mb-[18px] inline-flex items-center gap-1.5 text-[0.84rem] font-semibold text-ink-mute transition hover:text-teal"
        >
          <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.8} />
          我的订单
        </button>

        <section className="flex items-start justify-between gap-8 rounded-3xl border border-[var(--line)] bg-white px-6 py-7 max-[760px]:flex-col max-[760px]:gap-[22px] max-[760px]:px-[22px] md:px-[34px]">
          <div className="min-w-0">
            <div className="flex items-center gap-2 font-[family-name:var(--font-mono)] text-[0.8rem] tracking-[-0.01em] text-ink-mute">
              <span>{order.id}</span>
              <button
                type="button"
                title="复制订单号"
                className="grid rounded-md p-[3px] text-ink-mute transition hover:bg-paper hover:text-teal"
                onClick={() => copyText(order.id)}
              >
                <Copy className="h-3.5 w-3.5" strokeWidth={1.8} />
              </button>
            </div>
            <h1 className="mt-3.5 mb-2.5 flex items-center gap-3.5 font-[family-name:var(--font-display)] text-[clamp(1.9rem,4vw,2.5rem)] font-extrabold leading-[1.1] tracking-[-0.045em]">
              <i className={`h-[11px] w-[11px] shrink-0 rounded-full ${heroDotClass(order.status)}`} />
              {orderHeroTitle(order)}
            </h1>
            <p className="m-0 max-w-[48ch] text-[0.9rem] leading-[1.75] text-ink-mute">{orderHeroHint(order)}</p>
          </div>
          <div className="shrink-0 pt-1 text-right max-[760px]:text-left">
            <small className="mb-2 block text-[0.72rem] tracking-[0.1em] text-ink-mute">订单总额</small>
            <b className="font-[family-name:var(--font-display)] text-[2.55rem] font-extrabold leading-none tracking-[-0.05em]">
              ¥{money.head}
              <small className="ml-0.5 text-[1.05rem] tracking-normal text-ink-mute">{money.frac}</small>
            </b>
            {commission ? (
              <div className="mt-3.5 grid justify-items-end gap-1.5 max-[760px]:justify-items-start">
                <HeroSplit
                  label="定金"
                  value={formatMoney(deposit)}
                  tag={waitingPay ? '待支付' : '已支付'}
                  wait={waitingPay}
                />
                <HeroSplit
                  label="尾款"
                  value={formatMoney(balance)}
                  tag={delivered ? '已支付' : awaitingBalance ? '待支付' : '交稿后支付'}
                  wait={awaitingBalance || waitingPay}
                  ok={delivered}
                />
              </div>
            ) : null}
          </div>
        </section>

        <ol className="order-steps">
          {steps.map((s) => (
            <li key={s.label} className={s.kind}>
              <i className="order-s-dot">{s.kind === 'done' ? <Check className="h-[9px] w-[9px]" strokeWidth={3} /> : null}</i>
              <b className={`mt-[11px] block text-[0.84rem] font-bold max-[760px]:text-[0.72rem] ${s.kind === 'todo' ? 'font-semibold text-ink-mute' : s.kind === 'now' ? 'text-teal-deep' : ''}`}>
                {s.label}
              </b>
              {s.kind === 'done' && s.time ? (
                <time className="mt-[3px] block font-[family-name:var(--font-mono)] text-[0.68rem] text-ink-mute max-[760px]:text-[0.62rem]">
                  {s.time}
                </time>
              ) : s.kind === 'now' ? (
                <span className="mt-[3px] block text-[0.68rem] font-bold text-teal max-[760px]:text-[0.62rem]">当前</span>
              ) : null}
            </li>
          ))}
        </ol>

        {awaitingBalance ? (
          <section className="mt-[30px] rounded-3xl border border-[rgba(15,110,92,.35)] bg-[linear-gradient(180deg,rgba(232,241,238,.65),#fff_55%)] px-[30px] py-[26px] max-[760px]:px-5">
            <div className="flex items-end justify-between gap-4">
              <div>
                <h2 className="mb-1 font-[family-name:var(--font-display)] text-[1.18rem] tracking-[-0.02em]">支付尾款</h2>
                <p className="m-0 text-[0.78rem] text-ink-mute">选择支付方式，跳转收银台完成付款</p>
              </div>
              <b className="font-[family-name:var(--font-display)] text-[1.9rem] font-extrabold leading-none tracking-[-0.045em]">{payLabel}</b>
            </div>
            {publicSettings?.debugMode ? (
              <p className="mt-5 rounded-xl bg-[rgba(196,165,116,.16)] px-3.5 py-3 text-[0.82rem] text-[#8a6a2f]">
                调试模式已开启：将跳过真实支付并解锁稿件
              </p>
            ) : (
              <PaymentMethodPicker className="mt-5" variant="cards" value={balancePayment?.id || null} onChange={setBalancePayment} />
            )}
            <button
              type="button"
              disabled={payingBalance}
              className="mt-5 flex h-[52px] w-full items-center justify-center gap-2 rounded-[14px] bg-teal text-[1rem] font-extrabold tracking-[0.01em] text-white transition hover:bg-teal-deep disabled:opacity-60"
              onClick={handlePayBalance}
            >
              {payingBalance ? '跳转支付中…' : `支付尾款 ${payLabel}`}
              <ArrowRight className="h-4 w-4" strokeWidth={2} />
            </button>
            <p className="mt-3.5 mb-0 flex items-center justify-center gap-1.5 text-[0.74rem] text-ink-mute">
              <ShieldCheck className="h-[13px] w-[13px] shrink-0" strokeWidth={1.8} />
              支付在官方收银台完成，成功后自动返回并更新订单状态
            </p>
          </section>
        ) : null}

        <section className="mt-[30px] rounded-3xl border border-[var(--line)] bg-white">
          <div className="px-[30px] pt-6 pb-[26px] max-[760px]:px-5">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="m-0 font-[family-name:var(--font-display)] text-[1.14rem] tracking-[-0.02em]">发放内容</h2>
              <small className="text-[0.74rem] text-ink-mute">{deliveryCaption}</small>
            </div>
            {order.items.map((it, i) => (
              <DeliveryBlock
                key={`${it.product_id}-${i}`}
                item={it}
                commission={commission}
                delivered={delivered}
                waitingPay={waitingPay}
                depositPaid={order.status === 'deposit_paid'}
                awaitingBalance={!!awaitingBalance}
                canDelete={!!(isAdmin && commission && !delivered)}
                onCopy={copyText}
                onDownload={downloadFile}
                onDelete={handleDeleteManuscript}
              />
            ))}
            {isAdmin && commission && (order.status === 'deposit_paid' || awaitingBalance) ? (
              <label className="mt-4 flex cursor-pointer items-center justify-center gap-2 rounded border border-dashed border-[var(--line-strong)] px-3.5 py-3.5 text-[0.78rem] text-ink-mute transition hover:border-teal hover:text-teal">
                <Upload className="h-4 w-4" strokeWidth={1.8} />
                {uploading ? '上传中…' : '上传稿件'}
                <input
                  type="file"
                  className="hidden"
                  disabled={uploading}
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    e.target.value = ''
                    if (file) handleUploadManuscript(file)
                  }}
                />
              </label>
            ) : null}
          </div>
          <div className="order-slip-tear" />
          <div className="px-[30px] pt-6 pb-[26px] max-[760px]:px-5">
            <h2 className="m-0 font-[family-name:var(--font-display)] text-[1.14rem] tracking-[-0.02em]">订单信息</h2>
            <dl className="mt-2.5 grid grid-cols-1 gap-x-11 md:grid-cols-2">
              <MetaRow label="订单编号" value={order.id} mono onCopy={() => copyText(order.id)} />
              <MetaRow label="下单时间" value={fmtFullTime(order.created_at)} />
              <MetaRow label="买家" value={order.username} />
              {order.email ? <MetaRow label="联系邮箱" value={user ? order.email : maskEmail(order.email)} /> : null}
              <MetaRow label="订单类型" value={commission ? '定制约稿' : '商城商品'} />
              {commission ? (
                <MetaRow
                  label="约定字数"
                  value={order.word_count ? `${order.word_count.toLocaleString('zh-CN')} 字` : '—'}
                />
              ) : null}
              {channelLabel(order) ? <MetaRow label="支付方式" value={channelLabel(order)} /> : null}
              {order.trade_no && (delivered || order.status === 'deposit_paid' || awaitingBalance) ? (
                <MetaRow label="交易流水" value={order.trade_no} mono onCopy={() => copyText(order.trade_no || '')} />
              ) : null}
            </dl>
          </div>
        </section>

        {commission && !waitingPay && order.status !== 'failed' && order.status !== 'cancelled' ? (
          <section className="mt-[26px] flex items-center gap-3.5 rounded-[20px] border border-[var(--line)] bg-white px-5 py-4 max-[760px]:flex-wrap">
            <div className="grid h-[42px] w-[42px] shrink-0 place-items-center rounded-full bg-[linear-gradient(135deg,var(--teal),#1a9a7c)] text-[0.9rem] font-extrabold text-white">
              作
            </div>
            <div className="min-w-0 flex-1">
              <b className="text-[0.9rem]">与作者沟通</b>
              <p className="mt-[3px] mb-0 truncate text-[0.78rem] text-ink-mute">
                {order.status === 'deposit_paid'
                  ? '定金已支付，可在对话中补充需求细节。'
                  : awaitingBalance
                    ? '稿件已上传，支付尾款后即可下载。'
                    : '成稿已交付，如需微调请在对话中提出。'}
              </p>
            </div>
            <Link
              to={
                user?.role === 'admin' && order.user_id
                  ? `/admin/conversations?order=${encodeURIComponent(order.id)}`
                  : `/commissions?order=${encodeURIComponent(order.id)}`
              }
              className="ml-auto inline-flex h-[38px] shrink-0 items-center gap-1.5 rounded-[10px] border border-[var(--line-strong)] bg-white/60 px-[15px] text-[0.84rem] font-semibold text-ink transition hover:border-ink hover:bg-white max-[760px]:ml-0 max-[760px]:w-full max-[760px]:justify-center"
            >
              <MessageSquare className="h-3.5 w-3.5" strokeWidth={1.8} />
              打开对话
            </Link>
          </section>
        ) : null}

        <div className="mt-[30px] flex gap-2.5">
          <Link
            to="/"
            className="inline-flex h-[38px] items-center gap-1.5 rounded-[10px] border border-[var(--line-strong)] bg-white/60 px-[15px] text-[0.84rem] font-semibold text-ink transition hover:border-ink hover:bg-white"
          >
            <ShoppingBag className="h-3.5 w-3.5" strokeWidth={1.8} />
            返回商城
          </Link>
        </div>
      </div>
    </main>
  )
}

function HeroSplit({
  label,
  value,
  tag,
  wait,
  ok,
}: {
  label: string
  value: string
  tag?: string
  wait?: boolean
  ok?: boolean
}) {
  const tagClass = wait ? 'text-[#8a6a2f]' : ok || tag === '已支付' ? 'text-teal' : 'text-ink-mute'
  return (
    <div className="flex items-baseline gap-2 text-[0.76rem] text-ink-mute">
      <span>{label}</span>
      <b className="font-[family-name:var(--font-mono)] text-[0.78rem] font-bold tracking-[-0.01em] text-ink-soft">{value}</b>
      {tag ? <span className={`text-[0.72rem] font-bold ${tagClass}`}>{tag}</span> : null}
    </div>
  )
}

function MetaRow({
  label,
  value,
  mono,
  onCopy,
}: {
  label: string
  value: string
  mono?: boolean
  onCopy?: () => void
}) {
  return (
    <div className="flex items-baseline justify-between gap-[18px] border-b border-[var(--line)] py-[11px] text-[0.84rem]">
      <dt className="shrink-0 whitespace-nowrap text-ink-mute">{label}</dt>
      {mono ? (
        <dd className="m-0 inline-flex items-center gap-1.5 text-right font-[family-name:var(--font-mono)] text-[0.78rem] font-semibold tracking-[-0.01em] break-all">
          {value}
          {onCopy ? (
            <button type="button" title="复制" className="grid rounded p-0.5 text-ink-mute hover:bg-paper hover:text-teal" onClick={onCopy}>
              <Copy className="h-3 w-3" strokeWidth={1.8} />
            </button>
          ) : null}
        </dd>
      ) : (
        <dd className="m-0 text-right font-semibold break-all">{value}</dd>
      )}
    </div>
  )
}

function DeliveryBlock({
  item,
  commission,
  delivered,
  waitingPay,
  depositPaid,
  awaitingBalance,
  canDelete,
  onCopy,
  onDownload,
  onDelete,
}: {
  item: OrderItem
  commission: boolean
  delivered: boolean
  waitingPay: boolean
  depositPaid: boolean
  awaitingBalance: boolean
  canDelete: boolean
  onCopy: (text: string) => void
  onDownload: (url: string, name: string) => Promise<void>
  onDelete: (fileId: string) => void
}) {
  const files = itemFiles(item)
  const locked = awaitingBalance && !delivered
  const hold = !delivered && !locked

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 py-4">
        <b className="text-[0.98rem] tracking-[-0.01em]">{item.name}</b>
        <span className="whitespace-nowrap font-[family-name:var(--font-mono)] text-[0.86rem] font-bold">
          {commission ? `¥${item.price}/k` : `¥${item.price}`}
        </span>
      </div>
      {hold ? (
        <div className="rounded-2xl border-[1.5px] border-dashed border-[var(--line-strong)] px-5 py-[30px] text-center text-ink-mute">
          <div className="mx-auto mb-3 grid h-[46px] w-[46px] place-items-center rounded-[14px] bg-paper text-teal">
            {waitingPay && !commission ? (
              <Zap className="h-5 w-5" strokeWidth={1.8} />
            ) : waitingPay || depositPaid ? (
              <PenLine className="h-5 w-5" strokeWidth={1.8} />
            ) : (
              <Lock className="h-5 w-5" strokeWidth={1.8} />
            )}
          </div>
          <b className="mb-1 block text-[0.9rem] text-ink-soft">
            {waitingPay ? (commission ? '等待支付定金' : '支付后自动发货') : depositPaid ? '等待作者交稿' : '尚未发放'}
          </b>
          <p className="m-0 text-[0.8rem] leading-[1.7]">
            {waitingPay
              ? commission
                ? '支付定金后进入交稿流程，成稿将通过本页发放。'
                : '发放内容与下载文件将在支付成功后立即展示在此处。'
              : depositPaid
                ? '可通过下方对话跟进进度、补充需求细节。'
                : '商家尚未发放内容。'}
          </p>
        </div>
      ) : (
        <>
          {locked ? (
            <div className="mt-1 mb-1 flex items-start gap-2 rounded-xl bg-[rgba(196,165,116,.14)] px-3.5 py-2.5 text-[0.8rem] leading-[1.6] text-[#8a6a2f]">
              <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
              稿件已上传，支付尾款后解锁下载。
            </div>
          ) : null}
          {item.payload && delivered ? (
            <>
              <div className="rounded-[14px] border border-[var(--line)] bg-[#f4f8f6] px-[18px] py-4 text-[0.88rem] leading-[1.8] text-ink-soft">
                <MarkdownContent content={item.payload} />
              </div>
              <button
                type="button"
                className="mt-3 inline-flex items-center gap-1.5 text-[0.78rem] font-bold text-teal hover:underline"
                onClick={() => onCopy(item.payload || '')}
              >
                <Copy className="h-3 w-3" strokeWidth={1.8} />
                复制原文
              </button>
            </>
          ) : null}
          {files.length ? (
            <DeliveryFileList
              variant="slip"
              files={files}
              onDownload={onDownload}
              onDelete={canDelete ? (fileId) => onDelete(fileId) : undefined}
            />
          ) : delivered ? (
            <div className="text-[0.86rem] text-ink-mute">未发放</div>
          ) : null}
        </>
      )}
    </div>
  )
}
