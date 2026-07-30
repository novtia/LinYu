import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { api } from '../../lib/api'
import { useToast } from '../../context/ToastContext'
import type { AlipayPageConfig, EzpayConfig, PaymentChannel, PaymentProvider } from '../../types'
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
        className="min-h-[7rem] rounded-xl border border-[var(--line)] bg-paper px-3.5 py-2.5 font-[family-name:var(--font-mono)] text-[0.82rem] leading-relaxed outline-none focus:border-teal"
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
  const [provider, setProvider] = useState(search.get('provider') || '')
  const [name, setName] = useState('')
  const [enabled, setEnabled] = useState(false)
  const [ezpay, setEzpay] = useState<EzpayConfig>(DEFAULT_EZPAY)
  const [alipay, setAlipay] = useState<AlipayPageConfig>(DEFAULT_ALIPAY)
  const [loading, setLoading] = useState(!isNew)
  const [saving, setSaving] = useState(false)

  const selectedProvider = useMemo(
    () => providers.find((p) => p.id === provider),
    [providers, provider],
  )

  useEffect(() => {
    api
      .get<PaymentProvider[]>('/api/payment-channels/providers')
      .then(setProviders)
      .catch(() => setProviders([]))
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
    }
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
    setSaving(true)
    try {
      const config = provider === 'alipay' ? alipay : provider === 'ezpay' ? ezpay : {}
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

  if (loading) return <div className="text-ink-mute">加载中…</div>

  if (isNew && !provider) {
    return (
      <div>
        <div className="mb-4">
          <Link to="/admin/payment" className="text-[0.86rem] font-semibold text-ink-mute hover:text-ink">
            ← 返回渠道列表
          </Link>
          <h2 className="mt-2 font-[family-name:var(--font-display)] text-[1.2rem] font-bold tracking-tight">
            选择渠道商
          </h2>
          <p className="mt-1 text-[0.88rem] text-ink-mute">选择后进入配置详情页完成接入。</p>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {providers.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => pickProvider(p)}
              className="rounded-[16px] border border-[var(--line)] bg-white p-5 text-left transition hover:border-teal hover:shadow-[0_12px_28px_-22px_rgba(15,110,92,.55)]"
            >
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <strong className="text-[1.05rem]">{p.name}</strong>
                {p.id === 'alipay' && (
                  <span className="rounded-md bg-[rgba(15,110,92,.1)] px-2 py-0.5 text-[0.72rem] font-semibold text-teal">
                    官方
                  </span>
                )}
              </div>
              <p className="mb-3 text-[0.86rem] leading-relaxed text-ink-mute">{p.desc}</p>
              <a
                href={p.docs}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="text-[0.82rem] font-semibold text-teal hover:underline"
              >
                查看开发文档 →
              </a>
            </button>
          ))}
          {!providers.length && (
            <div className="rounded-[16px] border border-dashed border-[var(--line-strong)] bg-white p-6 text-ink-mute">
              暂无可用渠道商
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link to="/admin/payment" className="text-[0.86rem] font-semibold text-ink-mute hover:text-ink">
            ← 返回渠道列表
          </Link>
          <h2 className="mt-2 font-[family-name:var(--font-display)] text-[1.2rem] font-bold tracking-tight">
            {isNew ? `添加${selectedProvider?.name || '渠道'}` : `编辑${selectedProvider?.name || '渠道'}`}
          </h2>
          {selectedProvider?.docs && (
            <a
              href={selectedProvider.docs}
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-block text-[0.82rem] font-semibold text-teal hover:underline"
            >
              查看开发文档
            </a>
          )}
        </div>
        {isNew && (
          <button
            type="button"
            className="h-9 rounded-[10px] border border-[var(--line-strong)] bg-paper px-3 text-[0.86rem] font-semibold"
            onClick={() => setProvider('')}
          >
            重选渠道商
          </button>
        )}
      </div>

      <div className="overflow-hidden rounded-[18px] border border-[var(--line)] bg-white">
        <div className="grid gap-4 border-b border-[var(--line)] p-[18px] md:grid-cols-2">
          <Field label="渠道名称" value={name} onChange={setName} placeholder="例如：支付宝电脑网站支付" />
          <label className="grid gap-1.5">
            <span className="text-[0.82rem] font-semibold text-ink-soft">渠道商</span>
            <div className="flex h-11 items-center rounded-xl border border-[var(--line)] bg-paper px-3.5 text-[0.9rem]">
              {selectedProvider?.name || provider}
            </div>
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
            <div className="border-b border-[var(--line)] bg-paper px-[18px] py-2.5 text-[0.78rem] font-semibold tracking-wide text-ink-mute">
              支付宝开放平台 · 电脑网站支付 alipay.trade.page.pay
            </div>
            <div className="grid gap-4 border-b border-[var(--line)] p-[18px] md:grid-cols-2">
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
                hint="密钥工具生成的应用私钥，切勿泄露"
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
            <div className="border-t border-[var(--line)] bg-[rgba(232,241,238,.45)] px-[18px] py-3.5 text-[0.8rem] leading-relaxed text-ink-soft">
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
            <div className="border-b border-[var(--line)] bg-paper px-[18px] py-2.5 text-[0.78rem] font-semibold tracking-wide text-ink-mute">
              易支付配置 · 页面跳转支付 submit.php
            </div>
            <div className="grid gap-4 border-b border-[var(--line)] p-[18px] md:grid-cols-2">
              <Field
                label="网关地址"
                value={ezpay.gateway}
                onChange={(v) => setEzpay({ ...ezpay, gateway: v })}
                placeholder="https://www.ezfpy.cn"
                hint="发起支付将请求 {网关}/submit.php"
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

        <div className="flex justify-end gap-2 bg-paper px-[18px] py-3.5">
          <button
            type="button"
            className="h-9 rounded-[10px] border border-[var(--line-strong)] bg-white px-4 text-[0.86rem] font-semibold"
            onClick={() => navigate('/admin/payment')}
          >
            取消
          </button>
          <button
            type="button"
            disabled={saving}
            className="h-9 rounded-[10px] bg-ink px-4 text-[0.86rem] font-semibold text-white disabled:opacity-60"
            onClick={save}
          >
            {saving ? '保存中…' : isNew ? '添加渠道' : '保存修改'}
          </button>
        </div>
      </div>
    </div>
  )
}
