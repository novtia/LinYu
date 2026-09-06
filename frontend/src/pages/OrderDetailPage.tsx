import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ApiError, api } from '../lib/api'
import { getGuestEmail, orderPath, setGuestEmail } from '../lib/guestEmail'
import { orderStatusClass, orderStatusLabel } from '../lib/orderStatus'
import { formatYuan } from '../lib/commission'
import { useAuth } from '../context/AuthContext'
import { usePurchaseResult } from '../context/PurchaseResultContext'
import { useToast } from '../context/ToastContext'
import { MarkdownContent } from '../components/MarkdownContent'
import { DeliveryFileList } from '../components/DeliveryFileList'
import { PaymentMethodPicker } from '../components/PaymentMethodPicker'
import type { CheckoutResult, Order, ProductFileItem, PublicPaymentMethod } from '../types'

function fmtTime(iso: string) {
  const d = new Date(iso)
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function OrderDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const fromPay = searchParams.get('pay') === '1'
  const { user, loading, publicSettings } = useAuth()
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

  if (needEmail) {
    return (
      <main className="pb-20 pt-8">
        <div className="wrap max-w-lg">
          <h1 className="mb-2 font-[family-name:var(--font-display)] text-2xl font-extrabold tracking-tight">查找订单</h1>
          <p className="mb-6 text-[0.9rem] text-ink-mute">请填写购买时使用的邮箱后查看发放内容。</p>
          <form onSubmit={submitEmail} className="rounded-[22px] border border-[var(--line)] bg-white p-5">
            <label className="mb-4 block">
              <span className="mb-1.5 block text-[0.82rem] font-semibold text-ink-soft">购买邮箱</span>
              <input
                className="field-input"
                type="email"
                value={emailInput}
                onChange={(ev) => setEmailInput(ev.target.value)}
                placeholder="填写下单时使用的邮箱"
                required
              />
            </label>
            <button
              type="submit"
              className="h-11 w-full rounded-xl bg-teal text-[0.9rem] font-semibold text-white hover:bg-teal-deep"
            >
              查看订单
            </button>
          </form>
          <Link to="/orders" className="mt-5 inline-block text-[0.9rem] font-semibold text-teal hover:underline">
            返回订单列表
          </Link>
        </div>
      </main>
    )
  }

  if (busy) return <div className="wrap py-20 text-center text-ink-mute">加载中…</div>

  if (error || !order) {
    return (
      <div className="wrap py-20 text-center">
        <p className="mb-4 text-ink-mute">{error || '订单不存在'}</p>
        <Link to="/orders" className="font-semibold text-teal hover:underline">
          返回订单列表
        </Link>
      </div>
    )
  }

  const commission = order.sale_mode === 'commission'
  const delivered = order.status === 'completed' || (!commission && order.status === 'paid')
  const waitingPay = order.status === 'pending'
  const isAdmin = user?.role === 'admin'
  const deposit = order.deposit_amount ?? 0
  const balance = order.balance_amount ?? 0

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

  return (
    <main className="pb-20 pt-8">
      <div className="wrap">
        <button type="button" onClick={() => navigate('/orders')} className="mb-6 text-[0.9rem] text-ink-soft hover:text-teal">
          ← 我的订单
        </button>

        <div className="mb-6 rounded-[22px] border border-[var(--line)] bg-white p-6">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="font-[family-name:var(--font-display)] text-2xl font-extrabold tracking-tight">订单详情</h1>
              <p className="mt-1 font-[family-name:var(--font-mono)] text-[0.85rem] text-ink-mute">{order.id}</p>
            </div>
            <span className={`inline-flex rounded-md px-2.5 py-1 text-[0.78rem] font-semibold ${orderStatusClass(order.status)}`}>
              {commission ? `约稿 · ${orderStatusLabel(order.status)}` : orderStatusLabel(order.status)}
            </span>
          </div>
          <div className="grid gap-3 text-[0.92rem] sm:grid-cols-3">
            <Meta label="下单时间" value={fmtTime(order.created_at)} />
            <Meta label="买家" value={order.username} />
            <Meta label="合计" value={`¥${order.total}`} />
            {commission ? (
              <>
                <Meta label="定金" value={formatYuan(deposit)} />
                <Meta label="尾款" value={formatYuan(balance)} />
              </>
            ) : null}
          </div>
          {waitingPay && (
            <p className="mt-4 rounded-xl bg-[rgba(196,165,116,.16)] px-3.5 py-3 text-[0.86rem] text-[#8a6a2f]">
              {commission
                ? '订单待付定金。若你已完成付款，请稍候刷新本页。'
                : '订单待支付。若你已完成付款，请稍候刷新本页；支付结果确认后将自动发货。'}
            </p>
          )}
          {commission && order.status === 'deposit_paid' && (
            <p className="mt-4 rounded-xl bg-[rgba(196,165,116,.16)] px-3.5 py-3 text-[0.86rem] text-[#8a6a2f]">
              定金已到账，等待商家上传稿件。
            </p>
          )}
          {commission && order.status === 'awaiting_balance' && (
            <div className="mt-4 rounded-xl border border-[var(--line)] bg-paper p-4">
              <p className="mb-3 text-[0.86rem] text-ink-soft">稿件已就绪，支付尾款 {formatYuan(balance)} 后即可下载。</p>
              <PaymentMethodPicker className="mb-3" value={balancePayment?.id || null} onChange={setBalancePayment} />
              <button
                type="button"
                disabled={payingBalance}
                className="h-11 rounded-xl bg-teal px-5 text-[0.9rem] font-semibold text-white hover:bg-teal-deep disabled:opacity-60"
                onClick={handlePayBalance}
              >
                {payingBalance ? '跳转支付中…' : `支付尾款 ${formatYuan(balance)}`}
              </button>
            </div>
          )}
          {commission && isAdmin && (order.status === 'deposit_paid' || order.status === 'awaiting_balance') && (
            <div className="mt-4 rounded-xl border border-dashed border-[var(--line-strong)] bg-paper px-4 py-3">
              <div className="mb-2 text-[0.82rem] font-semibold text-ink-soft">上传稿件</div>
              <input
                type="file"
                disabled={uploading}
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  e.target.value = ''
                  if (file) handleUploadManuscript(file)
                }}
              />
              {uploading ? <p className="mt-2 text-[0.8rem] text-ink-mute">上传中…</p> : null}
            </div>
          )}
        </div>

        <div className="overflow-hidden rounded-[22px] border border-[var(--line)] bg-white">
          <div className="border-b border-[var(--line)] px-5 py-4">
            <h2 className="font-[family-name:var(--font-display)] text-lg font-bold">发放内容</h2>
          </div>
          <div className="divide-y divide-[var(--line)]">
            {order.items.map((it, i) => (
              <div key={i} className="px-5 py-4">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <strong className="text-[0.98rem]">{it.name}</strong>
                  <span className="font-semibold text-teal">¥{it.price}</span>
                </div>
                {!delivered && !(commission && (it.files?.length || order.status === 'awaiting_balance')) ? (
                  <div className="rounded-xl bg-paper px-3.5 py-3 text-[0.86rem] text-ink-mute">
                    {waitingPay ? (commission ? '支付定金后进入交稿流程' : '支付成功后自动发放') : commission && order.status === 'deposit_paid' ? '等待商家交稿' : '尚未发放'}
                  </div>
                ) : (
                  <div className="rounded-xl bg-paper px-3.5 py-3">
                    {it.payload ? (
                      <>
                        <div className="mb-3 min-w-0">
                          <MarkdownContent content={it.payload} />
                        </div>
                        <button
                          type="button"
                          className="text-[0.82rem] font-semibold text-teal hover:underline"
                          onClick={async () => {
                            try {
                              await navigator.clipboard.writeText(it.payload || '')
                              showToast('已复制到剪贴板')
                            } catch {
                              showToast('复制失败')
                            }
                          }}
                        >
                          复制原文
                        </button>
                      </>
                    ) : null}
                    {(it.files && it.files.length > 0) || it.download_url ? (
                      <div className={it.payload ? 'mt-3' : ''}>
                        {commission && !delivered ? (
                          <p className="mb-2 text-[0.8rem] text-ink-mute">稿件已上传，支付尾款后解锁下载。</p>
                        ) : null}
                        <DeliveryFileList
                          files={
                            it.files && it.files.length
                              ? it.files
                              : ([
                                  {
                                    id: it.download_url || it.file_name || String(i),
                                    file_name: it.file_name || '已购文件',
                                    is_image: /\.(png|jpe?g|gif|webp|bmp)$/i.test(it.file_name || ''),
                                    download_url: it.download_url,
                                  },
                                ] as ProductFileItem[])
                          }
                          onDownload={async (url, name) => {
                            try {
                              await api.download(url, name)
                            } catch (e) {
                              showToast(e instanceof ApiError ? e.message : '下载失败')
                            }
                          }}
                        />
                        {isAdmin && commission && !delivered && it.files?.length
                          ? it.files.map((f) => (
                              <button
                                key={`del-${f.id}`}
                                type="button"
                                className="mt-2 mr-3 text-[0.78rem] text-danger hover:underline"
                                onClick={() => handleDeleteManuscript(f.id)}
                              >
                                删除 {f.file_name}
                              </button>
                            ))
                          : null}
                      </div>
                    ) : null}
                    {!it.payload && !(it.files && it.files.length) && !it.download_url ? (
                      <div className="text-[0.86rem] text-ink-mute">未发放</div>
                    ) : null}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </main>
  )
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-paper px-3.5 py-3">
      <div className="mb-1 text-[0.75rem] text-ink-mute">{label}</div>
      <div className="font-semibold">{value}</div>
    </div>
  )
}
