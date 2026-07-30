import { useEffect, useState } from 'react'
import { ApiError, api } from '../../lib/api'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import type { MailSettings, Settings, SysSettings, User } from '../../types'
import { Field, SwitchRow } from './FormBits'

type TokenOut = { access_token: string; user: User }

const EMPTY_MAIL: MailSettings = {
  enabled: false,
  app_key: '',
  alias: '领匣',
  reply_to: '',
  template_buyer: '',
  template_admin_order: '',
  template_reset: '',
  template_contact: '',
}

function normalizeSys(sys: SysSettings): SysSettings {
  return { ...sys, mail: { ...EMPTY_MAIL, ...(sys.mail || {}) } }
}

export function SystemPage() {
  const { showToast } = useToast()
  const { user, login, refreshSettings } = useAuth()
  const [sys, setSys] = useState<SysSettings | null>(null)
  const [account, setAccount] = useState({
    username: '',
    email: '',
    current_password: '',
    new_password: '',
    confirm_password: '',
  })
  const [accountError, setAccountError] = useState('')
  const [accountSaving, setAccountSaving] = useState(false)

  useEffect(() => {
    api
      .get<Settings>('/api/settings')
      .then((s) => setSys(normalizeSys(s.sys)))
      .catch(() => setSys(null))
  }, [])

  useEffect(() => {
    if (user) {
      setAccount((prev) => ({
        ...prev,
        username: user.username,
        email: user.email || '',
      }))
    }
  }, [user])

  if (!sys) return <div className="text-ink-mute">加载中…</div>

  const mail = sys.mail

  function setMail(patch: Partial<MailSettings>) {
    setSys({ ...sys!, mail: { ...sys!.mail, ...patch } })
  }

  async function saveAccount() {
    setAccountError('')
    if (!account.current_password) {
      setAccountError('请输入当前密码')
      return
    }
    const usernameChanged = account.username.trim() !== (user?.username || '')
    const emailChanged = account.email.trim() !== (user?.email || '')
    const passwordChanged = Boolean(account.new_password)
    if (!usernameChanged && !emailChanged && !passwordChanged) {
      setAccountError('请修改用户名、邮箱或密码后再保存')
      return
    }
    if (passwordChanged && account.new_password.length < 6) {
      setAccountError('新密码至少 6 位')
      return
    }
    if (passwordChanged && account.new_password !== account.confirm_password) {
      setAccountError('两次输入的新密码不一致')
      return
    }
    setAccountSaving(true)
    try {
      const res = await api.put<TokenOut>('/api/auth/account', {
        current_password: account.current_password,
        username: usernameChanged ? account.username.trim() : undefined,
        email: emailChanged ? account.email.trim() : undefined,
        new_password: passwordChanged ? account.new_password : undefined,
      })
      login(res.access_token, res.user)
      setAccount({
        username: res.user.username,
        email: res.user.email || '',
        current_password: '',
        new_password: '',
        confirm_password: '',
      })
      showToast('账号信息已更新')
    } catch (e) {
      setAccountError(e instanceof ApiError ? e.message : '更新失败')
    } finally {
      setAccountSaving(false)
    }
  }

  return (
    <div className="grid gap-5">
      <div className="overflow-hidden rounded-[18px] border border-[var(--line)] bg-white">
        <div className="grid gap-4 border-b border-[var(--line)] p-[18px] md:grid-cols-2">
          <Field label="站点名称" value={sys.name} onChange={(v) => setSys({ ...sys, name: v })} />
          <Field
            label="客服邮箱"
            value={sys.email}
            onChange={(v) => setSys({ ...sys, email: v })}
            hint="接收新订单通知与联系表单留言"
          />
          <div className="md:col-span-2">
            <Field label="通知 Webhook" value={sys.notify} onChange={(v) => setSys({ ...sys, notify: v })} />
          </div>
        </div>
        <SwitchRow title="自动发货" desc="付款成功后立即将发货内容写入订单" on={sys.autoDeliver} onToggle={() => setSys({ ...sys, autoDeliver: !sys.autoDeliver })} />
        <SwitchRow title="开放注册" desc="关闭后仅管理员可登录" on={sys.allowReg} onToggle={() => setSys({ ...sys, allowReg: !sys.allowReg })} />
        <SwitchRow title="维护模式" desc="开启后暂停下单" on={sys.maintain} onToggle={() => setSys({ ...sys, maintain: !sys.maintain })} />
        <SwitchRow
          title="调试模式"
          desc="开启后购买跳过真实支付，直接标记成功并发货（仅测试用）"
          on={!!sys.debugMode}
          onToggle={() => setSys({ ...sys, debugMode: !sys.debugMode })}
        />
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

      <div className="overflow-hidden rounded-[18px] border border-[var(--line)] bg-white">
        <div className="border-b border-[var(--line)] px-[18px] py-3.5">
          <h3 className="font-[family-name:var(--font-display)] text-[1.05rem] font-bold">邮件服务（AokSend）</h3>
          <p className="mt-1 text-[0.82rem] text-ink-mute">
            接入{' '}
            <a href="https://www.aoksend.com/api.html" target="_blank" rel="noreferrer" className="text-teal hover:underline">
              AokSend API
            </a>
            ，在后台创建模板后把模板 ID 填到下方。
          </p>
        </div>
        <SwitchRow
          title="启用邮件"
          desc="关闭后不发送任何邮件（订单/找回密码/联系表单）"
          on={mail.enabled}
          onToggle={() => setMail({ enabled: !mail.enabled })}
        />
        <div className="grid items-start gap-4 border-b border-[var(--line)] p-[18px] md:grid-cols-2">
          <Field
            label="App Key"
            value={mail.app_key}
            onChange={(v) => setMail({ app_key: v })}
            type="password"
            autoComplete="off"
            hint="AokSend 后台 API 密钥"
          />
          <Field label="发件人名称 alias" value={mail.alias} onChange={(v) => setMail({ alias: v })} />
          <div className="md:col-span-2">
            <Field
              label="默认回复地址 reply_to"
              value={mail.reply_to}
              onChange={(v) => setMail({ reply_to: v })}
              placeholder="可选"
            />
          </div>
          <Field
            label="买家发货模板 ID"
            value={mail.template_buyer}
            onChange={(v) => setMail({ template_buyer: v })}
            hint="变量：site_name, order_id, username, total, products, delivery_content"
          />
          <Field
            label="管理员订单模板 ID"
            value={mail.template_admin_order}
            onChange={(v) => setMail({ template_admin_order: v })}
            hint="变量：site_name, order_id, username, total, products, status"
          />
          <Field
            label="找回密码模板 ID"
            value={mail.template_reset}
            onChange={(v) => setMail({ template_reset: v })}
            hint="变量：site_name, username, code"
          />
          <Field
            label="联系表单模板 ID"
            value={mail.template_contact}
            onChange={(v) => setMail({ template_contact: v })}
            hint="变量：site_name, name, email, message（收件人为客服邮箱）"
          />
        </div>
        <div className="flex justify-end bg-paper px-[18px] py-3.5">
          <button
            type="button"
            className="h-9 rounded-[10px] bg-ink px-4 text-[0.86rem] font-semibold text-white"
            onClick={async () => {
              await api.put('/api/settings/sys', sys)
              await refreshSettings()
              showToast('邮件设置已保存')
            }}
          >
            保存邮件设置
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-[18px] border border-[var(--line)] bg-white">
        <div className="border-b border-[var(--line)] px-[18px] py-3.5">
          <h3 className="font-[family-name:var(--font-display)] text-[1.05rem] font-bold">管理员账号</h3>
          <p className="mt-1 text-[0.82rem] text-ink-mute">修改当前登录账号的用户名、邮箱或密码</p>
        </div>
        <div className="grid items-start gap-4 p-[18px] md:grid-cols-2">
          <Field
            label="用户名"
            value={account.username}
            onChange={(v) => setAccount({ ...account, username: v })}
            hint="3-16 位字母、数字或下划线"
            autoComplete="username"
          />
          <Field
            label="邮箱"
            value={account.email}
            onChange={(v) => setAccount({ ...account, email: v })}
            placeholder="可选，用于找回密码"
            autoComplete="email"
          />
          <Field
            label="当前密码"
            type="password"
            value={account.current_password}
            onChange={(v) => setAccount({ ...account, current_password: v })}
            placeholder="验证身份必填"
            autoComplete="current-password"
          />
          <Field
            label="新密码"
            type="password"
            value={account.new_password}
            onChange={(v) => setAccount({ ...account, new_password: v })}
            placeholder="不修改请留空"
            hint="至少 6 位"
            autoComplete="new-password"
          />
          <Field
            label="确认新密码"
            type="password"
            value={account.confirm_password}
            onChange={(v) => setAccount({ ...account, confirm_password: v })}
            placeholder="再次输入新密码"
            autoComplete="new-password"
          />
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-[var(--line)] bg-paper px-[18px] py-3.5">
          <div className="min-h-[1.2em] text-[0.82rem] text-danger">{accountError}</div>
          <button
            type="button"
            disabled={accountSaving}
            className="h-9 rounded-[10px] bg-ink px-4 text-[0.86rem] font-semibold text-white disabled:opacity-60"
            onClick={saveAccount}
          >
            {accountSaving ? '保存中…' : '更新账号'}
          </button>
        </div>
      </div>
    </div>
  )
}
