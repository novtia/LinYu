import { useEffect, useState } from 'react'
import { api } from '../../lib/api'
import { useToast } from '../../context/ToastContext'
import type { PaySettings, Settings } from '../../types'

export function PaymentPage() {
  const { showToast } = useToast()
  const [pay, setPay] = useState<PaySettings | null>(null)

  useEffect(() => {
    api.get<Settings>('/api/settings').then((s) => setPay(s.pay)).catch(() => setPay(null))
  }, [])

  if (!pay) return <div className="text-ink-mute">加载中…</div>

  return (
    <div className="overflow-hidden rounded-[18px] border border-[var(--line)] bg-white">
      <SwitchRow
        title="支付宝"
        desc="开启后结算页展示支付宝选项（演示）"
        on={pay.alipay}
        onToggle={() => setPay({ ...pay, alipay: !pay.alipay })}
      />
      <div className="grid gap-4 border-b border-[var(--line)] p-[18px] md:grid-cols-2">
        <Field label="支付宝 PID" value={pay.alipayPid} onChange={(v) => setPay({ ...pay, alipayPid: v })} />
        <Field label="支付宝密钥" value={pay.alipayKey} onChange={(v) => setPay({ ...pay, alipayKey: v })} />
      </div>
      <SwitchRow
        title="微信支付"
        desc="开启后结算页展示微信选项（演示）"
        on={pay.wechat}
        onToggle={() => setPay({ ...pay, wechat: !pay.wechat })}
      />
      <div className="grid gap-4 border-b border-[var(--line)] p-[18px] md:grid-cols-2">
        <Field label="微信商户号" value={pay.wechatMch} onChange={(v) => setPay({ ...pay, wechatMch: v })} />
        <Field label="微信密钥" value={pay.wechatKey} onChange={(v) => setPay({ ...pay, wechatKey: v })} />
      </div>
      <SwitchRow
        title="USDT"
        desc="开启后展示链上收款地址（演示）"
        on={pay.usdt}
        onToggle={() => setPay({ ...pay, usdt: !pay.usdt })}
      />
      <div className="border-b border-[var(--line)] p-[18px]">
        <Field label="USDT 收款地址" value={pay.usdtAddr} onChange={(v) => setPay({ ...pay, usdtAddr: v })} />
      </div>
      <div className="flex justify-end bg-paper px-[18px] py-3.5">
        <button
          type="button"
          className="h-9 rounded-[10px] bg-ink px-4 text-[0.86rem] font-semibold text-white"
          onClick={async () => {
            await api.put('/api/settings/pay', pay)
            showToast('支付配置已保存')
          }}
        >
          保存
        </button>
      </div>
    </div>
  )
}

export function SwitchRow({
  title,
  desc,
  on,
  onToggle,
}: {
  title: string
  desc: string
  on: boolean
  onToggle: () => void
}) {
  return (
    <div className="flex items-center justify-between border-b border-[var(--line)] px-[18px] py-3.5">
      <div>
        <strong className="mb-0.5 block text-[0.95rem]">{title}</strong>
        <span className="text-[0.82rem] text-ink-mute">{desc}</span>
      </div>
      <button type="button" className={`switch ${on ? 'on' : ''}`} onClick={onToggle} aria-label={title} />
    </div>
  )
}

export function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="grid gap-1.5">
      <span className="text-[0.82rem] font-semibold text-ink-soft">{label}</span>
      <input className="h-11 rounded-xl border border-[var(--line-strong)] bg-white px-3.5" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  )
}
