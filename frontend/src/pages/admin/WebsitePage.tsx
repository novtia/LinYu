import { useEffect, useState } from 'react'
import { api } from '../../lib/api'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import type { Settings, SiteSettings } from '../../types'
import { Field } from './PaymentPage'

export function WebsitePage() {
  const { showToast } = useToast()
  const { refreshSettings } = useAuth()
  const [site, setSite] = useState<SiteSettings | null>(null)

  useEffect(() => {
    api.get<Settings>('/api/settings').then((s) => setSite(s.site)).catch(() => setSite(null))
  }, [])

  if (!site) return <div className="text-ink-mute">加载中…</div>

  return (
    <div className="overflow-hidden rounded-[18px] border border-[var(--line)] bg-white">
      <div className="grid gap-4 p-[18px]">
        <Field label="SEO 标题" value={site.title} onChange={(v) => setSite({ ...site, title: v })} />
        <Field label="关键词" value={site.keywords} onChange={(v) => setSite({ ...site, keywords: v })} />
        <label className="grid gap-1.5">
          <span className="text-[0.82rem] font-semibold text-ink-soft">站点描述</span>
          <textarea
            className="min-h-20 rounded-xl border border-[var(--line-strong)] bg-white px-3.5 py-3"
            value={site.desc}
            onChange={(e) => setSite({ ...site, desc: e.target.value })}
          />
        </label>
        <label className="grid gap-1.5">
          <span className="text-[0.82rem] font-semibold text-ink-soft">首页公告</span>
          <textarea
            className="min-h-20 rounded-xl border border-[var(--line-strong)] bg-white px-3.5 py-3"
            value={site.notice}
            onChange={(e) => setSite({ ...site, notice: e.target.value })}
          />
        </label>
      </div>
      <div className="flex justify-end bg-paper px-[18px] py-3.5">
        <button
          type="button"
          className="h-9 rounded-[10px] bg-ink px-4 text-[0.86rem] font-semibold text-white"
          onClick={async () => {
            await api.put('/api/settings/site', site)
            document.title = site.title
            await refreshSettings()
            showToast('网站设置已保存')
          }}
        >
          保存
        </button>
      </div>
    </div>
  )
}
