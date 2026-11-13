import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { api } from '../../lib/api'
import { addDays, isoDay, shanghaiDay, yuanText } from '../../lib/ledger'
import { useToast } from '../../context/ToastContext'
import type {
  AlipayPageConfig,
  Analytics,
  EzpayConfig,
  PaymentChannel,
  PaymentProvider,
  UsdtChainItemConfig,
  UsdtChainSpec,
  UsdtConfig,
} from '../../types'
import { Field, SwitchRow } from './FormBits'

const DEFAULT_EZPAY: EzpayConfig = {
  gateway: 'https://www.ezfpy.cn',
  pid: '',
  key: '',
  notify_url: '',
  return_url: '',
  sitename: '领匣',
  methods: { alipay: true, wxpay: true, qqpay: false },
}

const DEFAULT_ALIPAY: AlipayPageConfig = {
  app_id: '',
  app_private_key: '',
  alipay_public_key: '',
  sandbox: false,
  notify_url: '',
  return_url: '',
  methods: { alipay: true },
}

const DEFAULT_CHAIN_SPECS: UsdtChainSpec[] = [
  { id: 'trc20', name: 'TRC20', full_name: 'Tron (TRC20)', kind: 'tron', badge: '推荐 · 最常用', hint: '波场网络 · T 开头 34 位地址' },
  { id: 'bep20', name: 'BEP20', full_name: 'BNB Smart Chain (BEP20)', kind: 'evm', badge: '极低手续费', hint: '币安智能链 · 0x 开头 42 位地址' },
  { id: 'polygon', name: 'Polygon', full_name: 'Polygon PoS', kind: 'evm', badge: '极低手续费', hint: 'Polygon 网络 · 0x 开头 42 位地址' },
  { id: 'arbitrum', name: 'Arbitrum', full_name: 'Arbitrum One', kind: 'evm', badge: '以太坊 L2', hint: 'Arbitrum One · 0x 开头 42 位地址' },
  { id: 'optimism', name: 'Optimism', full_name: 'OP Mainnet', kind: 'evm', badge: '以太坊 L2', hint: 'OP Mainnet · 0x 开头 42 位地址' },
  { id: 'erc20', name: 'ERC20', full_name: 'Ethereum (ERC20)', kind: 'evm', badge: '主网通用', hint: '以太坊主网 · 0x 开头 42 位地址' },
]

function makeDefaultUsdt(): UsdtConfig {
  const chains: Record<string, UsdtChainItemConfig> = {}
  for (const c of DEFAULT_CHAIN_SPECS) {
    chains[c.id] = { enabled: c.id === 'trc20' || c.id === 'bep20', address: '', rpc_url: '' }
  }
  return {
    rate_mode: 'auto',
    fixed_rate: 7.2,
    rate_markup_pct: 0,
    expire_minutes: 20,
    trongrid_api_key: '',
    chains,
    methods: { usdt: true },
  }
}

function mergeUsdtConfig(raw?: Partial<UsdtConfig>): UsdtConfig {
  const base = makeDefaultUsdt()
  if (!raw) return base
  const mergedChains: Record<string, UsdtChainItemConfig> = { ...base.chains }
  if (raw.chains && typeof raw.chains === 'object') {
    for (const spec of DEFAULT_CHAIN_SPECS) {
      const incoming = raw.chains[spec.id]
      if (incoming && typeof incoming === 'object') {
        mergedChains[spec.id] = {
          enabled: Boolean(incoming.enabled),
          address: String(incoming.address || ''),
          rpc_url: String(incoming.rpc_url || ''),
        }
      }
    }
  }
  return {
    ...base,
    ...raw,
    rate_mode: raw.rate_mode === 'fixed' ? 'fixed' : 'auto',
    fixed_rate: Number.isFinite(Number(raw.fixed_rate)) ? Number(raw.fixed_rate) : 7.2,
    rate_markup_pct: Number.isFinite(Number(raw.rate_markup_pct)) ? Number(raw.rate_markup_pct) : 0,
    expire_minutes: Number.isFinite(Number(raw.expire_minutes)) ? Number(raw.expire_minutes) : 20,
    trongrid_api_key: String(raw.trongrid_api_key || ''),
    chains: mergedChains,
    methods: {
      usdt: raw.methods?.usdt !== undefined ? Boolean(raw.methods.usdt) : true,
    },
  }
}

function checkAddressFormat(kind: string | undefined, addr: string): boolean {
  const s = addr.trim()
  if (!s) return false
  if (kind === 'tron') return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(s)
  return /^0x[0-9a-fA-F]{40}$/.test(s)
}

function TextArea({
  label,
  value,
  onChange,
  placeholder,
  hint,
  rows = 5,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  hint?: string
  rows?: number
}) {
  return (
    <label className="grid gap-1.5 md:col-span-2">
      <span className="text-[0.82rem] font-semibold text-ink-soft">{label}</span>
      <textarea
        className="min-h-[7rem] w-full resize-y border-0 border-b border-[var(--line-strong)] bg-transparent py-2 font-[family-name:var(--font-mono)] text-[0.82rem] leading-relaxed outline-none focus:border-teal"
        rows={rows}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint && <span className="text-[0.75rem] text-ink-mute">{hint}</span>}
    </label>
  )
}

export function PaymentChannelFormPage() {
  const { id } = useParams()
  const [search] = useSearchParams()
  const isNew = !id || id === 'new'
  const navigate = useNavigate()
  const { showToast } = useToast()

  const [providers, setProviders] = useState<PaymentProvider[]>([])
  const [chainSpecs, setChainSpecs] = useState<UsdtChainSpec[]>(DEFAULT_CHAIN_SPECS)
  const [provider, setProvider] = useState(search.get('provider') || '')
  const [name, setName] = useState('')
  const [enabled, setEnabled] = useState(false)
  const [ezpay, setEzpay] = useState<EzpayConfig>(DEFAULT_EZPAY)
  const [alipay, setAlipay] = useState<AlipayPageConfig>(DEFAULT_ALIPAY)
  const [usdt, setUsdt] = useState<UsdtConfig>(makeDefaultUsdt)
  const [showAdvancedRpc, setShowAdvancedRpc] = useState(false)
  const [loading, setLoading] = useState(!isNew)
  const [saving, setSaving] = useState(false)
  const [books, setBooks] = useState<Analytics | null>(null)

  const selectedProvider = useMemo(
    () => providers.find((p) => p.id === provider),
    [providers, provider],
  )

  useEffect(() => {
    api
      .get<PaymentProvider[]>('/api/payment-channels/providers')
      .then(setProviders)
      .catch(() => setProviders([]))
    api
      .get<UsdtChainSpec[]>('/api/pay/usdt/chains')
      .then((list) => {
        if (Array.isArray(list) && list.length) setChainSpecs(list)
      })
      .catch(() => {})
    api.get<Analytics>('/api/analytics').then(setBooks).catch(() => setBooks(null))
  }, [])

  useEffect(() => {
    if (isNew) return
    setLoading(true)
    api
      .get<PaymentChannel>(`/api/payment-channels/${id}`)
      .then((ch) => {
        setProvider(ch.provider)
        setName(ch.name)
        setEnabled(ch.enabled)
        if (ch.provider === 'ezpay') {
          setEzpay({
            ...DEFAULT_EZPAY,
            ...(ch.config as Partial<EzpayConfig>),
            methods: {
              ...DEFAULT_EZPAY.methods,
              ...((ch.config?.methods as EzpayConfig['methods']) || {}),
            },
          })
        } else if (ch.provider === 'alipay') {
          setAlipay({
            ...DEFAULT_ALIPAY,
            ...(ch.config as Partial<AlipayPageConfig>),
            methods: {
              ...DEFAULT_ALIPAY.methods,
              ...((ch.config?.methods as AlipayPageConfig['methods']) || {}),
            },
          })
        } else if (ch.provider === 'usdt') {
          setUsdt(mergeUsdtConfig(ch.config as Partial<UsdtConfig>))
        }
      })
      .catch(() => {
        showToast('渠道不存在')
        navigate('/admin/payment')
      })
      .finally(() => setLoading(false))
  }, [id, isNew, navigate, showToast])

  function pickProvider(p: PaymentProvider) {
    setProvider(p.id)
    setName(p.name)
    if (p.id === 'ezpay') {
      setEzpay({
        ...DEFAULT_EZPAY,
        ...(p.default_config as Partial<EzpayConfig>),
        methods: {
          ...DEFAULT_EZPAY.methods,
          ...((p.default_config?.methods as EzpayConfig['methods']) || {}),
        },
      })
    } else if (p.id === 'alipay') {
      setAlipay({
        ...DEFAULT_ALIPAY,
        ...(p.default_config as Partial<AlipayPageConfig>),
        methods: {
          ...DEFAULT_ALIPAY.methods,
          ...((p.default_config?.methods as AlipayPageConfig['methods']) || {}),
        },
      })
    } else if (p.id === 'usdt') {
      setUsdt(mergeUsdtConfig(p.default_config as Partial<UsdtConfig>))
    }
  }

  function updateUsdtChain(cid: string, patch: Partial<UsdtChainItemConfig>) {
    setUsdt((prev) => ({
      ...prev,
      chains: {
        ...prev.chains,
        [cid]: {
          ...(prev.chains[cid] || { enabled: false, address: '', rpc_url: '' }),
          ...patch,
        },
      },
    }))
  }

  function syncEvmAddresses(sourceAddr: string) {
    const clean = sourceAddr.trim()
    if (!/^0x[0-9a-fA-F]{40}$/.test(clean)) {
      showToast('请先填写一个有效的 0x 开头 42 位 EVM 收款地址')
      return
    }
    setUsdt((prev) => {
      const next = { ...prev.chains }
      for (const spec of chainSpecs) {
        if (spec.kind === 'evm') {
          const cur = next[spec.id] || { enabled: false, address: '', rpc_url: '' }
          next[spec.id] = { ...cur, address: clean }
        }
      }
      return { ...prev, chains: next }
    })
    showToast('已将该地址同步填入全部 EVM 网络')
  }

  async function save() {
    if (!provider) {
      showToast('请选择渠道商')
      return
    }
    if (!name.trim()) {
      showToast('请填写渠道名称')
      return
    }
    if (provider === 'ezpay') {
      if (!ezpay.pid.trim()) {
        showToast('请填写商户 ID (pid)')
        return
      }
      if (!ezpay.key.trim()) {
        showToast('请填写商户密钥')
        return
      }
    }
    if (provider === 'alipay') {
      if (!alipay.app_id.trim()) {
        showToast('请填写应用 APPID')
        return
      }
      if (!alipay.app_private_key.trim()) {
        showToast('请填写应用私钥')
        return
      }
      if (!alipay.alipay_public_key.trim()) {
        showToast('请填写支付宝公钥')
        return
      }
    }
    if (provider === 'usdt') {
      const activeSpecs = chainSpecs.filter((s) => usdt.chains[s.id]?.enabled)
      if (!activeSpecs.length) {
        showToast('请至少开启一条 USDT 收款网络')
        return
      }
      for (const s of activeSpecs) {
        const addr = (usdt.chains[s.id]?.address || '').trim()
        if (!addr) {
          showToast(`请填写 ${s.name} 网络的收款地址，或关闭该网络`)
          return
        }
        if (!checkAddressFormat(s.kind, addr)) {
          showToast(`${s.name} 地址格式不正确（${s.kind === 'tron' ? 'T 开头 34 位' : '0x 开头 42 位'}）`)
          return
        }
      }
    }
    setSaving(true)
    try {
      const config =
        provider === 'alipay' ? alipay : provider === 'ezpay' ? ezpay : provider === 'usdt' ? usdt : {}
      const body = {
        name: name.trim(),
        provider,
        enabled,
        config,
      }
      if (isNew) {
        await api.post<PaymentChannel>('/api/payment-channels', body)
        showToast('渠道已添加')
      } else {
        await api.put<PaymentChannel>(`/api/payment-channels/${id}`, body)
        showToast('渠道已保存')
      }
      navigate('/admin/payment')
    } catch (e) {
      showToast(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const month = useMemo(() => {
    const from = isoDay(addDays(new Date(), -29))
    const paid = (books?.rows || []).filter((r) => r.ok && shanghaiDay(r.at) >= from)
    const sum = (chName: string) => paid.filter((r) => r.channel === chName).reduce((a, r) => a + r.amount, 0)
    return { alipay: sum('支付宝'), ezpay: sum('易支付'), wx: sum('微信'), usdt: sum('USDT') }
  }, [books])

  if (loading) return <div className="text-ink-mute">加载中…</div>

  if (isNew && !provider) {
    return (
      <div className="lx-desk -m-4 min-h-full bg-white px-6 py-7 md:-m-6 md:px-8">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-[family-name:var(--font-display)] text-[clamp(1.7rem,2.4vw,2.1rem)] leading-none font-extrabold tracking-[-0.04em]">添加渠道</h1>
            <p className="mt-2 max-w-2xl text-[0.88rem] text-ink-mute">先选渠道商。密钥与钱包地址留在这一页，列表上只看实收和失败。</p>
          </div>
          <Link to="/admin/payment" className="inline-flex h-9 items-center rounded-[10px] border border-[var(--line-strong)] px-3 text-[0.84rem] font-semibold">
            返回配置
          </Link>
        </header>
        <div className="mt-6 grid border-y border-[var(--line)] md:grid-cols-3">
          {providers.map((p, idx) => (
            <button
              key={p.id}
              type="button"
              onClick={() => pickProvider(p)}
              className={`border-b border-[var(--line)] py-5 pr-5 text-left last:border-b-0 md:border-b-0 ${
                idx > 0 ? 'md:border-l md:pl-7' : ''
              }`}
            >
              <b className="block font-[family-name:var(--font-display)] text-[1.2rem] tracking-[-0.03em]">{p.name}</b>
              <p className="mt-2 text-[0.8rem] leading-relaxed text-ink-mute">{p.desc}</p>
              <span
                className={`mt-3 inline-flex rounded px-1.5 py-0.5 text-[0.68rem] font-bold ${
                  p.id === 'alipay'
                    ? 'bg-[rgba(15,110,92,.1)] text-teal'
                    : p.id === 'usdt'
                      ? 'bg-[rgba(38,161,123,.14)] text-[#15694F]'
                      : 'bg-[rgba(196,165,116,.22)] text-[#8a6a2f]'
                }`}
              >
                {p.id === 'alipay' ? '官方' : p.id === 'usdt' ? '自托管 · 0 手续费' : '网关'}
              </span>
            </button>
          ))}
          {!providers.length ? <p className="py-8 text-[0.86rem] text-ink-mute">暂无可用渠道商</p> : null}
        </div>
      </div>
    )
  }

  const firstValidEvmAddr =
    chainSpecs
      .filter((s) => s.kind === 'evm')
      .map((s) => (usdt.chains[s.id]?.address || '').trim())
      .find((a) => /^0x[0-9a-fA-F]{40}$/.test(a)) || ''

  const enabledUsdtCount = chainSpecs.filter(
    (s) => usdt.chains[s.id]?.enabled && checkAddressFormat(s.kind, usdt.chains[s.id]?.address || ''),
  ).length

  const checks: [string, boolean, string][] =
    provider === 'alipay'
      ? [
          ['APPID', Boolean(alipay.app_id.trim()), alipay.app_id.trim() ? '已填' : '缺'],
          ['应用私钥', Boolean(alipay.app_private_key.trim()), alipay.app_private_key.trim() ? '已填' : '缺'],
          ['支付宝公钥', Boolean(alipay.alipay_public_key.trim()), alipay.alipay_public_key.trim() ? '已填' : '缺'],
          ['沙箱', true, alipay.sandbox ? '开着' : '关'],
          ['买家可选', enabled && alipay.methods.alipay, enabled ? '结算里会出现' : '还没启用'],
        ]
      : provider === 'usdt'
        ? [
            ['可用链数', enabledUsdtCount > 0, enabledUsdtCount ? `${enabledUsdtCount} 条已就绪` : '缺地址'],
            ['汇率方式', true, usdt.rate_mode === 'auto' ? '实时汇率' : `固定 ${usdt.fixed_rate}`],
            ['锁单时长', true, `${usdt.expire_minutes} 分钟`],
            ...chainSpecs.map(
              (s): [string, boolean, string] => {
                const item = usdt.chains[s.id]
                const on = Boolean(item?.enabled)
                const ok = checkAddressFormat(s.kind, item?.address || '')
                return [s.name, !on || ok, on ? (ok ? '已就绪' : '地址无效') : '关']
              },
            ),
            ['买家可选', enabled && usdt.methods.usdt && enabledUsdtCount > 0, enabled ? '结算里会出现' : '还没启用'],
          ]
        : [
            ['网关', Boolean(ezpay.gateway.trim()), ezpay.gateway.trim() ? '已填' : '缺'],
            ['商户 ID', Boolean(ezpay.pid.trim()), ezpay.pid.trim() ? '已填' : '缺'],
            ['密钥', Boolean(ezpay.key.trim()), ezpay.key.trim() ? '已填' : '缺'],
            ['支付宝', ezpay.methods.alipay, 'type=alipay'],
            ['微信', ezpay.methods.wxpay, 'type=wxpay'],
            ['QQ 钱包', ezpay.methods.qqpay, ezpay.methods.qqpay ? '开' : '关'],
          ]

  return (
    <div className="lx-desk -m-4 min-h-full bg-white px-6 py-7 md:-m-6 md:px-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-[clamp(1.7rem,2.4vw,2.1rem)] leading-none font-extrabold tracking-[-0.04em]">
            {isNew ? '添加' : '编辑'}{selectedProvider?.name || '渠道'}
          </h1>
          <p className="mt-2 max-w-2xl text-[0.88rem] text-ink-mute">
            {provider === 'usdt'
              ? '只需填写你自己的公开收款地址（切勿填私钥）。买家下单时自动分配唯一小数尾数并轮询链上区块完成自动发货。'
              : '密钥留在这一页。'}
            {selectedProvider?.docs ? (
              <a href={selectedProvider.docs} target="_blank" rel="noreferrer" className="ml-2 font-semibold text-teal">开发文档</a>
            ) : null}
          </p>
        </div>
        <div className="flex gap-2">
          <Link to="/admin/payment" className="inline-flex h-9 items-center rounded-[10px] border border-[var(--line-strong)] px-3 text-[0.84rem] font-semibold">
            返回配置
          </Link>
          {isNew ? (
            <button type="button" className="h-9 rounded-[10px] border border-[var(--line-strong)] px-3 text-[0.84rem] font-semibold" onClick={() => setProvider('')}>
              重选渠道商
            </button>
          ) : null}
        </div>
      </header>

      <div className="mt-6 grid items-start gap-10 xl:grid-cols-[minmax(0,1fr)_280px]">
        <div>
          <h2 className="border-b border-[var(--line)] pb-2 font-[family-name:var(--font-display)] text-[1.05rem] font-bold">渠道</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <Field label="渠道名称" value={name} onChange={setName} placeholder="例如：USDT 多链直收" />
            <label className="grid gap-1.5">
              <span className="text-[0.76rem] font-bold text-ink-soft">渠道商</span>
              <div className="border-b border-[var(--line-strong)] py-2 text-[0.9rem]">{selectedProvider?.name || provider}</div>
            </label>
          </div>

          <SwitchRow
            title="启用渠道"
            desc="启用后，买家结算时可选择该通道完成真实支付"
            on={enabled}
            onToggle={() => setEnabled((v) => !v)}
          />

          {provider === 'alipay' && (
            <>
              <h2 className="mt-8 flex items-baseline justify-between border-b border-[var(--line)] pb-2 font-[family-name:var(--font-display)] text-[1.05rem] font-bold">
                支付宝开放平台
                <small className="font-[family-name:var(--font-body)] text-[0.74rem] font-medium text-ink-mute">alipay.trade.page.pay</small>
              </h2>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <Field
                  label="应用 APPID"
                  value={alipay.app_id}
                  onChange={(v) => setAlipay({ ...alipay, app_id: v })}
                  placeholder="开放平台应用的 APPID"
                />
                <Field
                  label="异步通知 notify_url"
                  value={alipay.notify_url}
                  onChange={(v) => setAlipay({ ...alipay, notify_url: v })}
                  placeholder="https://你的域名/api/pay/alipay/notify"
                  hint="可留空自动填充；须公网可访问，否则无法自动发货"
                />
                <Field
                  label="同步回跳 return_url"
                  value={alipay.return_url}
                  onChange={(v) => setAlipay({ ...alipay, return_url: v })}
                  placeholder="https://你的域名/api/pay/alipay/return"
                  hint="可留空自动填充"
                />
                <TextArea
                  label="应用私钥（RSA2）"
                  value={alipay.app_private_key}
                  onChange={(v) => setAlipay({ ...alipay, app_private_key: v })}
                  placeholder="支持带 BEGIN/END 头，或纯 Base64 正文"
                  hint="已保存的私钥以掩码显示，保持不变即不修改；需更换时粘贴新私钥"
                />
                <TextArea
                  label="支付宝公钥"
                  value={alipay.alipay_public_key}
                  onChange={(v) => setAlipay({ ...alipay, alipay_public_key: v })}
                  placeholder="开放平台「支付宝公钥」，不是应用公钥"
                  hint="用于验签异步/同步通知"
                />
              </div>
              <SwitchRow
                title="沙箱模式"
                desc="开启后走支付宝沙箱网关，仅用于联调测试"
                on={alipay.sandbox}
                onToggle={() => setAlipay({ ...alipay, sandbox: !alipay.sandbox })}
              />
              <SwitchRow
                title="支付宝"
                desc="电脑网站支付（FAST_INSTANT_TRADE_PAY）"
                on={alipay.methods.alipay}
                onToggle={() =>
                  setAlipay({
                    ...alipay,
                    methods: { ...alipay.methods, alipay: !alipay.methods.alipay },
                  })
                }
              />
              <div className="mt-3 text-[0.78rem] leading-relaxed text-ink-mute">
                在{' '}
                <a
                  href="https://open.alipay.com/"
                  target="_blank"
                  rel="noreferrer"
                  className="font-semibold text-teal hover:underline"
                >
                  支付宝开放平台
                </a>{' '}
                创建应用并签约「电脑网站支付」，配置 RSA2 密钥后把 APPID、应用私钥、支付宝公钥填入此处。
                授权回调地址 / 网关需能访问你的域名。
              </div>
            </>
          )}

          {provider === 'ezpay' && (
            <>
              <h2 className="mt-8 flex items-baseline justify-between border-b border-[var(--line)] pb-2 font-[family-name:var(--font-display)] text-[1.05rem] font-bold">
                易支付
                <small className="font-[family-name:var(--font-body)] text-[0.74rem] font-medium text-ink-mute">submit.php</small>
              </h2>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <Field
                  label="网关地址"
                  value={ezpay.gateway}
                  onChange={(v) => setEzpay({ ...ezpay, gateway: v })}
                  placeholder="https://www.ezfpy.cn"
                  hint="发起支付将请求网关地址后面的 /submit.php"
                />
                <Field
                  label="网站名称 sitename"
                  value={ezpay.sitename}
                  onChange={(v) => setEzpay({ ...ezpay, sitename: v })}
                  hint="可为空，其他参数必填"
                />
                <Field
                  label="商户 ID (pid)"
                  value={ezpay.pid}
                  onChange={(v) => setEzpay({ ...ezpay, pid: v })}
                  placeholder="易支付后台提供的商户 ID"
                />
                <Field
                  label="商户密钥 (key)"
                  value={ezpay.key}
                  onChange={(v) => setEzpay({ ...ezpay, key: v })}
                  type="password"
                  placeholder="用于 MD5 签名"
                  hint="已保存的密钥以掩码显示，保持不变即不修改"
                />
                <Field
                  label="异步通知 notify_url"
                  value={ezpay.notify_url}
                  onChange={(v) => setEzpay({ ...ezpay, notify_url: v })}
                  placeholder="https://你的域名/api/pay/ezpay/notify"
                  hint="可留空自动填充；必须是公网可访问地址，否则无法自动发货"
                />
                <Field
                  label="跳转通知 return_url"
                  value={ezpay.return_url}
                  onChange={(v) => setEzpay({ ...ezpay, return_url: v })}
                  placeholder="https://你的域名/api/pay/ezpay/return"
                  hint="可留空，系统自动使用当前站点回调地址"
                />
              </div>

              <SwitchRow
                title="支付宝 alipay"
                desc="type=alipay"
                on={ezpay.methods.alipay}
                onToggle={() =>
                  setEzpay({
                    ...ezpay,
                    methods: { ...ezpay.methods, alipay: !ezpay.methods.alipay },
                  })
                }
              />
              <SwitchRow
                title="微信支付 wxpay"
                desc="type=wxpay"
                on={ezpay.methods.wxpay}
                onToggle={() =>
                  setEzpay({
                    ...ezpay,
                    methods: { ...ezpay.methods, wxpay: !ezpay.methods.wxpay },
                  })
                }
              />
              <SwitchRow
                title="QQ 钱包 qqpay"
                desc="type=qqpay"
                on={ezpay.methods.qqpay}
                onToggle={() =>
                  setEzpay({
                    ...ezpay,
                    methods: { ...ezpay.methods, qqpay: !ezpay.methods.qqpay },
                  })
                }
              />
            </>
          )}

          {provider === 'usdt' && (
            <>
              <h2 className="mt-8 flex items-baseline justify-between border-b border-[var(--line)] pb-2 font-[family-name:var(--font-display)] text-[1.05rem] font-bold">
                汇率与锁单策略
                <small className="font-[family-name:var(--font-body)] text-[0.74rem] font-medium text-ink-mute">
                  唯一小数尾数虚拟账号机制
                </small>
              </h2>

              <SwitchRow
                title="自动获取实时汇率"
                desc="开启后每 5 分钟同步一次公开市场 USDT/CNY 汇率；关闭则始终按下方固定汇率折算"
                on={usdt.rate_mode === 'auto'}
                onToggle={() =>
                  setUsdt({ ...usdt, rate_mode: usdt.rate_mode === 'auto' ? 'fixed' : 'auto' })
                }
              />

              <div className="mt-4 grid gap-4 md:grid-cols-3">
                <Field
                  label={usdt.rate_mode === 'auto' ? '兜底汇率 (CNY/USDT)' : '固定汇率 (CNY/USDT)'}
                  value={String(usdt.fixed_rate)}
                  onChange={(v) => setUsdt({ ...usdt, fixed_rate: Number(v) || 0 })}
                  type="number"
                  placeholder="7.20"
                  hint={usdt.rate_mode === 'auto' ? '外部汇率接口超时时自动降级使用' : '1 USDT 折算多少人民币'}
                />
                <Field
                  label="汇率浮动 (%)"
                  value={String(usdt.rate_markup_pct)}
                  onChange={(v) => setUsdt({ ...usdt, rate_markup_pct: Number(v) || 0 })}
                  type="number"
                  placeholder="0"
                  hint="填 0 为原价；如填 -2 则汇率调低 2%（实收略多）"
                />
                <Field
                  label="锁单时长（分钟）"
                  value={String(usdt.expire_minutes)}
                  onChange={(v) => setUsdt({ ...usdt, expire_minutes: Number(v) || 20 })}
                  type="number"
                  placeholder="20"
                  hint="支持 10 ~ 60 分钟，超时后尾数释放"
                />
              </div>

              <div className="mt-8 flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--line)] pb-2">
                <h2 className="font-[family-name:var(--font-display)] text-[1.05rem] font-bold">
                  收款网络与钱包地址
                </h2>
                <div className="flex items-center gap-3">
                  {firstValidEvmAddr ? (
                    <button
                      type="button"
                      onClick={() => syncEvmAddresses(firstValidEvmAddr)}
                      className="text-[0.76rem] font-bold text-teal hover:underline"
                    >
                      将 EVM 地址一键填入其余 0x 网络
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => setShowAdvancedRpc((v) => !v)}
                    className="text-[0.76rem] font-semibold text-ink-mute hover:text-ink"
                  >
                    {showAdvancedRpc ? '收起节点高级设置' : '自定义节点 / API Key'}
                  </button>
                </div>
              </div>

              <div className="mt-3 divide-y divide-[var(--line)]">
                {chainSpecs.map((spec) => {
                  const item = usdt.chains[spec.id] || { enabled: false, address: '', rpc_url: '' }
                  const hasAddr = Boolean(item.address.trim())
                  const validAddr = checkAddressFormat(spec.kind, item.address)
                  return (
                    <div key={spec.id} className="py-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <b className="font-[family-name:var(--font-mono)] text-[0.95rem] font-extrabold">
                              USDT-{spec.name}
                            </b>
                            <span className="rounded bg-paper px-1.5 py-0.5 text-[0.68rem] font-semibold text-ink-mute">
                              {spec.full_name}
                            </span>
                            {hasAddr ? (
                              <span
                                className={`rounded px-1.5 py-0.5 text-[0.66rem] font-bold ${
                                  validAddr
                                    ? 'bg-[rgba(38,161,123,.12)] text-[#15694F]'
                                    : 'bg-[rgba(180,35,24,.1)] text-danger'
                                }`}
                              >
                                {validAddr ? '地址有效' : '格式有误'}
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-0.5 text-[0.76rem] text-ink-mute">{spec.hint}</p>
                        </div>

                        <button
                          type="button"
                          role="switch"
                          aria-checked={item.enabled}
                          onClick={() => updateUsdtChain(spec.id, { enabled: !item.enabled })}
                          className={`relative h-6 w-11 shrink-0 rounded-full transition ${
                            item.enabled ? 'bg-[#26A17B]' : 'bg-[var(--line-strong)]'
                          }`}
                        >
                          <span
                            className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                              item.enabled ? 'translate-x-5' : ''
                            }`}
                          />
                        </button>
                      </div>

                      {item.enabled ? (
                        <div className="mt-3 grid gap-3 md:grid-cols-2">
                          <div className={showAdvancedRpc ? '' : 'md:col-span-2'}>
                            <Field
                              label={`${spec.name} 收款地址`}
                              value={item.address}
                              onChange={(v) => updateUsdtChain(spec.id, { address: v })}
                              placeholder={
                                spec.kind === 'tron'
                                  ? 'T 开头的 34 位波场收款地址（如 TR7N...）'
                                  : '0x 开头的 42 位 EVM 钱包地址（自托管钱包各 EVM 链通用）'
                              }
                            />
                          </div>
                          {showAdvancedRpc ? (
                            <Field
                              label={`${spec.name} 自定义 RPC 节点（可选）`}
                              value={item.rpc_url}
                              onChange={(v) => updateUsdtChain(spec.id, { rpc_url: v })}
                              placeholder={
                                spec.kind === 'tron'
                                  ? '留空默认使用 https://api.trongrid.io'
                                  : '留空自动使用内置高可用公共 RPC 节点'
                              }
                            />
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  )
                })}
              </div>

              {showAdvancedRpc ? (
                <div className="mt-4 border-t border-[var(--line)] pt-4">
                  <Field
                    label="TronGrid API Key（可选，仅 TRC20 高并发时填写）"
                    value={usdt.trongrid_api_key}
                    onChange={(v) => setUsdt({ ...usdt, trongrid_api_key: v })}
                    type="password"
                    placeholder="在 trongrid.io 免费申请的 API Key，留空亦可正常轮询"
                    hint="已保存的 Key 以掩码显示，保持不变即不修改"
                  />
                </div>
              ) : null}
            </>
          )}

          <div className="mt-6 flex justify-end gap-2 border-t border-[var(--line)] pt-4">
            <button
              type="button"
              className="h-9 rounded-[10px] border border-[var(--line-strong)] px-4 text-[0.86rem] font-semibold"
              onClick={() => navigate('/admin/payment')}
            >
              取消
            </button>
            <button
              type="button"
              disabled={saving}
              className="h-9 rounded-[10px] bg-teal px-4 text-[0.86rem] font-bold text-white disabled:opacity-60"
              onClick={save}
            >
              {saving ? '保存中…' : isNew ? '添加渠道' : '保存修改'}
            </button>
          </div>
        </div>

        <aside className="xl:sticky xl:top-0 xl:border-l xl:border-[var(--line)] xl:pl-5">
          <div className="text-[0.72rem] tracking-[0.06em] text-ink-mute">接入检查</div>
          <h3 className="mt-2 font-[family-name:var(--font-display)] text-[1.25rem] font-extrabold tracking-[-0.03em]">{selectedProvider?.name || '渠道'}</h3>
          <ul className="mt-3">
            {checks.map(([label, ok, text]) => (
              <li key={String(label)} className="flex items-baseline justify-between gap-3 border-b border-[var(--line)] py-2 text-[0.82rem]">
                <span>{label}</span>
                <b className={ok ? 'text-teal' : 'text-danger'}>{text}</b>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[0.78rem] leading-relaxed text-ink-mute">
            {provider === 'alipay'
              ? `近 30 日支付宝入账 ${yuanText(month.alipay)}。私钥不会回到列表页。`
              : provider === 'usdt'
                ? `近 30 日 USDT 入账折合 ${yuanText(month.usdt)}。资金直达你自己的钱包，无需中转归集。`
                : `近 30 日易支付 ${yuanText(month.ezpay)}，微信 ${yuanText(month.wx)}。网关和密钥改完再看下一笔回调。`}
          </p>
        </aside>
      </div>
    </div>
  )
}
