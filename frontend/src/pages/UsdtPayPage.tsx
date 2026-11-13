import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import qrcode from 'qrcode-generator'
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  ExternalLink,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react'
import { ApiError, api } from '../lib/api'
import { useToast } from '../context/ToastContext'
import { formatMoney } from '../lib/orderDisplay'
import type { UsdtSession } from '../types'

function makeQrDataUrl(text: string): string {
  if (!text) return ''
  const qr = qrcode(0, 'M')
  qr.addData(text)
  qr.make()
  const svg = qr.createSvgTag({ cellSize: 6, margin: 2, scalable: true })
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

function formatCountdown(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  const mm = String(Math.floor(s / 60)).padStart(2, '0')
  const ss = String(s % 60).padStart(2, '0')
  return `${mm}:${ss}`
}

function splitUsdt(amount: string): { head: string; tail: string } {
  const clean = (amount || '0.00').trim()
  const dot = clean.indexOf('.')
  if (dot < 0) return { head: clean, tail: '' }
  return { head: clean.slice(0, dot), tail: clean.slice(dot) }
}

export function UsdtPayPage() {
  const { paymentId } = useParams<{ paymentId: string }>()
  const navigate = useNavigate()
  const { showToast } = useToast()

  const [session, setSession] = useState<UsdtSession | null>(null)
  const [loading, setLoading] = useState(true)
  const [switchingChain, setSwitchingChain] = useState('')
  const [checking, setChecking] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState<'amount' | 'address' | null>(null)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const redirected = useRef(false)

  const loadSession = useCallback(
    async (chain?: string, silent = false) => {
      if (!paymentId) return
      if (!silent) setError('')
      try {
        const qs = chain ? `?chain=${encodeURIComponent(chain)}` : ''
        const res = await api.get<UsdtSession>(`/api/pay/usdt/session/${encodeURIComponent(paymentId)}${qs}`)
        setSession(res)
      } catch (e) {
        if (!silent) {
          setError(e instanceof ApiError ? e.message : '加载收银台失败')
        }
      } finally {
        if (!silent) setLoading(false)
      }
    },
    [paymentId],
  )

  useEffect(() => {
    setLoading(true)
    loadSession()
  }, [loadSession])

  // 本地每秒刷新剩余倒计时
  useEffect(() => {
    const t = window.setInterval(() => setNowMs(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [])

  const remainingSec = useMemo(() => {
    if (!session || session.status === 'paid') return 0
    const exp = Date.parse(session.expires_at)
    if (!Number.isFinite(exp)) return session.remaining_seconds || 0
    return Math.max(0, Math.floor((exp - nowMs) / 1000))
  }, [session, nowMs])

  const isExpired = session ? session.status !== 'paid' && remainingSec <= 0 : false

  // 自动轮询到账状态（每 5 秒）
  useEffect(() => {
    if (!session || session.status === 'paid' || isExpired || !paymentId) return
    const timer = window.setInterval(() => {
      loadSession(session.chain, true)
    }, 5000)
    return () => window.clearInterval(timer)
  }, [session, isExpired, paymentId, loadSession])

  // 到账后自动回跳订单详情完成发货展示
  useEffect(() => {
    if (!session || session.status !== 'paid' || redirected.current) return
    redirected.current = true
    showToast('USDT 已确认到账，正在跳转发货页面…')
    const timer = window.setTimeout(() => {
      navigate(session.redirect_url, { replace: true })
    }, 1600)
    return () => window.clearTimeout(timer)
  }, [session, navigate, showToast])

  async function handleSwitchChain(chainId: string) {
    if (!session || chainId === session.chain || switchingChain) return
    setSwitchingChain(chainId)
    try {
      const res = await api.get<UsdtSession>(
        `/api/pay/usdt/session/${encodeURIComponent(session.payment_id)}?chain=${encodeURIComponent(chainId)}`,
      )
      setSession(res)
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : '切换网络失败')
    } finally {
      setSwitchingChain('')
    }
  }

  async function handleManualCheck() {
    if (!session || checking) return
    setChecking(true)
    try {
      const res = await api.post<UsdtSession>(
        `/api/pay/usdt/session/${encodeURIComponent(session.payment_id)}/check?chain=${encodeURIComponent(session.chain)}`,
      )
      setSession(res)
      if (res.status !== 'paid') {
        showToast('暂未检测到链上确认，区块打包通常需 5~60 秒，系统将持续自动监听')
      }
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : '查账请求失败，请稍后重试')
    } finally {
      setChecking(false)
    }
  }

  async function handleRefreshLock() {
    if (!session || refreshing) return
    setRefreshing(true)
    try {
      const res = await api.post<UsdtSession>(
        `/api/pay/usdt/session/${encodeURIComponent(session.payment_id)}/refresh?chain=${encodeURIComponent(session.chain)}`,
      )
      setSession(res)
      showToast('已重新锁定最新汇率与收款金额')
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : '刷新金额失败')
    } finally {
      setRefreshing(false)
    }
  }

  async function copyValue(kind: 'amount' | 'address', text: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(kind)
      showToast(kind === 'amount' ? `已复制精确金额 ${text} USDT` : '已复制收款地址')
      window.setTimeout(() => {
        setCopied((cur) => (cur === kind ? null : cur))
      }, 2000)
    } catch {
      showToast('复制失败，请手动长按复制')
    }
  }

  const qrSrc = useMemo(() => makeQrDataUrl(session?.address || ''), [session?.address])

  if (loading) {
    return <div className="wrap-order py-20 text-center text-ink-mute">正在准备 USDT 收银台…</div>
  }

  if (error || !session) {
    return (
      <main className="pb-20 pt-10">
        <div className="wrap-order mx-auto max-w-[560px] text-center">
          <div className="rounded-3xl border border-[var(--line)] bg-white px-7 py-12">
            <p className="mb-5 text-[0.95rem] text-ink-soft">{error || '支付会话不存在'}</p>
            <Link
              to="/orders"
              className="inline-flex h-10 items-center rounded-xl bg-teal px-5 text-[0.86rem] font-bold text-white hover:bg-teal-deep"
            >
              返回我的订单
            </Link>
          </div>
        </div>
      </main>
    )
  }

  const parts = splitUsdt(session.amount_usdt)

  return (
    <main className="pb-24 pt-7 md:pt-10">
      <div className="wrap-order mx-auto max-w-[680px]">
        <div className="mb-4 flex items-center justify-between gap-3">
          <Link
            to={`/orders/${encodeURIComponent(session.order_id)}`}
            className="inline-flex items-center gap-1.5 text-[0.84rem] font-semibold text-ink-mute transition hover:text-teal"
          >
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.8} />
            返回订单详情
          </Link>
          <span className="font-[family-name:var(--font-mono)] text-[0.76rem] text-ink-mute">
            订单 {session.order_id}
          </span>
        </div>

        <section className="overflow-hidden rounded-3xl border border-[var(--line)] bg-white shadow-[0_14px_38px_-24px_rgba(20,32,28,.18)]">
          {/* 顶部题头 */}
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--line)] bg-[linear-gradient(180deg,rgba(38,161,123,.08),rgba(255,255,255,0))] px-6 py-5 md:px-8">
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-[#26A17B] font-[family-name:var(--font-mono)] text-[1.2rem] font-extrabold text-white shadow-[0_6px_16px_-6px_rgba(38,161,123,.55)]">
                ₮
              </span>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="m-0 font-[family-name:var(--font-display)] text-[1.22rem] font-extrabold tracking-[-0.02em]">
                    USDT 链上直付
                  </h1>
                  <span className="rounded-md bg-[rgba(38,161,123,.12)] px-2 py-0.5 font-[family-name:var(--font-mono)] text-[0.72rem] font-bold text-[#15694F]">
                    {session.chain_name}
                  </span>
                </div>
                <p className="m-0 mt-0.5 text-[0.8rem] text-ink-mute">{session.title}</p>
              </div>
            </div>

            {session.status === 'paid' ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[rgba(15,110,92,.12)] px-3 py-1 text-[0.78rem] font-bold text-teal">
                <CheckCircle2 className="h-3.5 w-3.5" />
                已确认到账
              </span>
            ) : (
              <div className="flex items-center gap-1.5 rounded-full border border-[var(--line)] bg-white px-3 py-1 font-[family-name:var(--font-mono)] text-[0.8rem] font-semibold">
                <Clock className={`h-3.5 w-3.5 ${isExpired ? 'text-danger' : 'text-[#26A17B]'}`} strokeWidth={2} />
                <span className={isExpired ? 'text-danger' : 'text-ink'}>
                  {isExpired ? '已超时' : formatCountdown(remainingSec)}
                </span>
              </div>
            )}
          </div>

          {session.status === 'paid' ? (
            <div className="px-6 py-11 text-center md:px-10">
              <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-[rgba(38,161,123,.12)] text-[#15694F]">
                <CheckCircle2 className="h-7 w-7" strokeWidth={2} />
              </div>
              <h2 className="m-0 font-[family-name:var(--font-display)] text-[1.5rem] font-extrabold tracking-[-0.03em]">
                链上付款已确认
              </h2>
              <p className="mx-auto mt-2 max-w-[42ch] text-[0.86rem] leading-relaxed text-ink-mute">
                已收到 <b>{session.amount_usdt} USDT</b>（{session.chain_name}），系统已完成自动入账并发货。
              </p>
              {session.tx_hash ? (
                <div className="mx-auto mt-5 max-w-[480px] rounded-xl border border-[var(--line)] bg-paper px-4 py-3 text-left">
                  <div className="text-[0.7rem] text-ink-mute">区块链交易哈希 (TxHash)</div>
                  <div className="mt-1 flex items-center justify-between gap-2 font-[family-name:var(--font-mono)] text-[0.76rem] break-all">
                    <span>{session.tx_hash}</span>
                    {session.explorer_url ? (
                      <a
                        href={session.explorer_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex shrink-0 items-center gap-1 font-[family-name:var(--font-body)] text-[0.75rem] font-bold text-teal hover:underline"
                      >
                        区块浏览器
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    ) : null}
                  </div>
                </div>
              ) : null}
              <div className="mt-7">
                <button
                  type="button"
                  onClick={() => navigate(session.redirect_url, { replace: true })}
                  className="inline-flex h-11 items-center justify-center rounded-xl bg-teal px-7 text-[0.9rem] font-bold text-white hover:bg-teal-deep"
                >
                  立即查看发货内容
                </button>
              </div>
            </div>
          ) : (
            <div className="px-6 py-6 md:px-8 md:py-7">
              {/* 1. 选择转账网络 */}
              {session.available_chains.length > 0 ? (
                <div>
                  <div className="mb-2.5 flex items-baseline justify-between">
                    <span className="text-[0.76rem] font-bold tracking-[0.04em] text-ink-soft">1. 选择转账网络</span>
                    <span className="text-[0.74rem] text-ink-mute">提币网络须与下方所选完全一致</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {session.available_chains.map((c) => {
                      const active = c.id === session.chain
                      const busy = switchingChain === c.id
                      return (
                        <button
                          key={c.id}
                          type="button"
                          disabled={Boolean(switchingChain)}
                          onClick={() => handleSwitchChain(c.id)}
                          className={`relative rounded-xl border px-3 py-2.5 text-left transition ${
                            active
                              ? 'border-[#26A17B] bg-[rgba(38,161,123,.08)] text-[#125B44]'
                              : 'border-[var(--line)] bg-white text-ink hover:border-[var(--line-strong)]'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-1">
                            <b className="font-[family-name:var(--font-mono)] text-[0.88rem] font-extrabold">{c.name}</b>
                            {c.badge ? (
                              <span
                                className={`rounded px-1.5 py-0.5 text-[0.62rem] font-bold ${
                                  active ? 'bg-[#26A17B] text-white' : 'bg-paper text-ink-mute'
                                }`}
                              >
                                {busy ? '切换…' : c.badge}
                              </span>
                            ) : null}
                          </div>
                          <small className="mt-1 block truncate text-[0.69rem] text-ink-mute">{c.hint}</small>
                        </button>
                      )
                    })}
                  </div>
                </div>
              ) : null}

              {/* 2. 精确转账金额 */}
              <div className="mt-6 rounded-2xl border border-[rgba(38,161,123,.3)] bg-[linear-gradient(180deg,rgba(38,161,123,.06),rgba(38,161,123,.02))] p-5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-[0.76rem] font-bold tracking-[0.04em] text-ink-soft">
                    2. 请按以下精确金额到账（含小数尾数）
                  </span>
                  <span className="font-[family-name:var(--font-mono)] text-[0.74rem] text-ink-mute">
                    应付 {formatMoney(session.amount_cny)} · 汇率 1 USDT ≈ ¥{session.exchange_rate}
                  </span>
                </div>

                <div className="mt-3 flex flex-wrap items-center justify-between gap-4">
                  <div className="flex items-baseline gap-1.5 font-[family-name:var(--font-mono)]">
                    <span className="text-[2.25rem] font-extrabold leading-none tracking-[-0.04em] text-ink">
                      {parts.head}
                    </span>
                    <span className="rounded-md bg-[rgba(38,161,123,.16)] px-1.5 py-0.5 text-[1.75rem] font-extrabold leading-none text-[#126B4F]">
                      {parts.tail}
                    </span>
                    <span className="ml-1 text-[0.95rem] font-bold text-ink-soft">USDT</span>
                  </div>

                  <button
                    type="button"
                    disabled={isExpired}
                    onClick={() => copyValue('amount', session.amount_usdt)}
                    className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[#26A17B] bg-white px-3.5 text-[0.82rem] font-bold text-[#15694F] transition hover:bg-[rgba(38,161,123,.08)] disabled:opacity-50"
                  >
                    {copied === 'amount' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    {copied === 'amount' ? '已复制金额' : '复制精确金额'}
                  </button>
                </div>

                <div className="mt-3.5 flex items-start gap-2 rounded-xl bg-white/85 px-3 py-2.5 text-[0.76rem] leading-relaxed text-[#7c5c23]">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#b58125]" strokeWidth={2} />
                  <span>
                    系统通过专属小数尾数 <b>{parts.tail}</b> 自动匹配你的订单。若从交易所（欧易 / 币安等）提币，请将提币手续费另加，务必使<b>实际到账金额恰好等于 {session.amount_usdt} USDT</b>。
                  </span>
                </div>
              </div>

              {/* 3. 收款地址与二维码 */}
              <div className="mt-6">
                <div className="mb-2.5 flex items-baseline justify-between">
                  <span className="text-[0.76rem] font-bold tracking-[0.04em] text-ink-soft">
                    3. 扫码或复制 {session.chain_full_name} 收款地址
                  </span>
                </div>

                {isExpired ? (
                  <div className="rounded-2xl border border-dashed border-[var(--line-strong)] bg-paper px-6 py-9 text-center">
                    <p className="m-0 text-[0.9rem] font-bold text-ink">当前锁定金额已超时</p>
                    <p className="mt-1.5 mb-5 text-[0.8rem] text-ink-mute">
                      为防止金额尾数与其他买家冲突，请点击下方按钮重新获取有效期内的专属金额后再转账。
                    </p>
                    <button
                      type="button"
                      disabled={refreshing}
                      onClick={handleRefreshLock}
                      className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-teal px-5 text-[0.86rem] font-bold text-white hover:bg-teal-deep disabled:opacity-60"
                    >
                      <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
                      {refreshing ? '正在重新锁定…' : '重新获取锁定金额'}
                    </button>
                  </div>
                ) : (
                  <div className="grid items-center gap-5 rounded-2xl border border-[var(--line)] p-4 sm:grid-cols-[164px_minmax(0,1fr)] sm:p-5">
                    <div className="mx-auto grid h-[156px] w-[156px] place-items-center rounded-2xl border border-[var(--line)] bg-white p-2.5">
                      {qrSrc ? (
                        <img
                          src={qrSrc}
                          alt={`${session.chain_name} 收款二维码`}
                          className="h-full w-full object-contain"
                        />
                      ) : null}
                    </div>

                    <div className="min-w-0">
                      <div className="text-[0.72rem] text-ink-mute">
                        收款钱包地址（仅限 {session.chain_name} 网络 USDT）
                      </div>
                      <div className="mt-1.5 rounded-xl border border-[var(--line)] bg-paper px-3.5 py-2.5 font-[family-name:var(--font-mono)] text-[0.82rem] font-semibold leading-relaxed break-all text-ink">
                        {session.address}
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-2.5">
                        <button
                          type="button"
                          onClick={() => copyValue('address', session.address)}
                          className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-ink px-4 text-[0.82rem] font-bold text-white transition hover:bg-teal-deep"
                        >
                          {copied === 'address' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                          {copied === 'address' ? '已复制地址' : '复制收款地址'}
                        </button>
                        <span className="font-[family-name:var(--font-mono)] text-[0.7rem] text-ink-mute">
                          合约尾号 …{session.contract.slice(-6)}
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* 底部状态与手动查账按钮 */}
              {!isExpired ? (
                <div className="mt-6 border-t border-[var(--line)] pt-5">
                  <button
                    type="button"
                    disabled={checking}
                    onClick={handleManualCheck}
                    className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#26A17B] text-[0.95rem] font-extrabold text-white transition hover:bg-[#1E8866] disabled:opacity-60"
                  >
                    <RefreshCw className={`h-4 w-4 ${checking ? 'animate-spin' : ''}`} strokeWidth={2.2} />
                    {checking ? '正在查询区块链节点…' : '我已完成转账，立即查账'}
                  </button>
                  <p className="mt-3 mb-0 flex items-center justify-center gap-1.5 text-center text-[0.75rem] text-ink-mute">
                    <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-[#26A17B]" strokeWidth={1.9} />
                    页面每 5 秒自动同步链上区块，确认到账后将自动跳转并发货（关闭页面也不影响后台自动发货）
                  </p>
                </div>
              ) : null}
            </div>
          )}
        </section>
      </div>
    </main>
  )
}
