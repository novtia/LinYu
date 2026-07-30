import { useEffect, useState } from 'react'
import { api } from '../../lib/api'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import type { Settings, SysSettings } from '../../types'
import { Field, SwitchRow } from './PaymentPage'

export function SystemPage() {
  const { showToast } = useToast()
  const { refreshSettings } = useAuth()
  const [sys, setSys] = useState<SysSettings | null>(null)

  useEffect(() => {
    api.get<Settings>('/api/settings').then((s) => setSys(s.sys)).catch(() => setSys(null))
  }, [])

  if (!sys) return <div className="text-ink-mute">加载中…</div>

  return (
    <div className="overflow-hidden rounded-[18px] border border-[var(--line)] bg-white">
      <div className="grid gap-4 border-b border-[var(--line)] p-[18px] md:grid-cols-2">
        <Field label="站点名称" value={sys.name} onChange={(v) => setSys({ ...sys, name: v })} />
        <Field label="客服邮箱" value={sys.email} onChange={(v) => setSys({ ...sys, email: v })} />
        <div className="md:col-span-2">
          <Field label="通知 Webhook" value={sys.notify} onChange={(v) => setSys({ ...sys, notify: v })} />
        </div>
      </div>
      <SwitchRow title="自动发货" desc="付款成功后立即写入领取匣" on={sys.autoDeliver} onToggle={() => setSys({ ...sys, autoDeliver: !sys.autoDeliver })} />
      <SwitchRow title="开放注册" desc="关闭后仅管理员可登录" on={sys.allowReg} onToggle={() => setSys({ ...sys, allowReg: !sys.allowReg })} />
      <SwitchRow title="维护模式" desc="开启后暂停下单" on={sys.maintain} onToggle={() => setSys({ ...sys, maintain: !sys.maintain })} />
      <div className="flex justify-end bg-paper px-[18px] py-3.5">
        <button
          type="button"
          className="h-9 rounded-[10px] bg-ink px-4 text-[0.86rem] font-semibold text-white"
          onClick={async () => {
            await api.put('/api/settings/sys', sys)
            await refreshSettings()
            showToast('系统设置已保存')
          }}
        >
          保存
        </button>
      </div>
    </div>
  )
}
