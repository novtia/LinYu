import { useEffect, useState } from 'react'
import { ApiError, api } from '../../lib/api'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import type { MailSettings, Settings, SysSettings, User } from '../../types'
import { Field, SwitchRow } from './FormBits'

type TokenOut = { access_token: string; user: User }

const EMPTY_MAIL: MailSettings = {
  enabled: false,
  secret_id: '',
  secret_key: '',
  region: 'ap-guangzhou',
  from_email: '',
  from_alias: '领匣',
  reply_to: '',
  template_buyer: '',
  template_reset: '',
  template_register: '',
  template_login: '',
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
      .catch((e) => {
        setSys(null)
        showToast(e instanceof ApiError ? e.message : '设置加载失败')
      })
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

  async function saveSys(successMessage: string) {
    try {
      // 返回值中的密钥为掩码，直接回写保持与后端一致
      const saved = await api.put<Settings>('/api/settings/sys', sys)
      setSys(normalizeSys(saved.sys))
      await refreshSettings()
      showToast(successMessage)
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : '保存失败')
    }
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
          <Field label="客服邮箱" value={sys.email} onChange={(v) => setSys({ ...sys, email: v })} />
          <div className="md:col-span-2">
            <Field label="通知 Webhook" value={sys.notify} onChange={(v) => setSys({ ...sys, notify: v })} />
          </div>
        </div>
        <SwitchRow title="自动发货" desc="付款成功后立即将发货内容写入订单" on={sys.autoDeliver} onToggle={() => setSys({ ...sys, autoDeliver: !sys.autoDeliver })} />
        <SwitchRow title="开放注册" desc="关闭后仅管理员可登录" on={sys.allowReg} onToggle={() => setSys({ ...sys, allowReg: !sys.allowReg })} />
        <SwitchRow title="维护模式" desc="开启后暂停下单" on={sys.maintain} onToggle={() => setSys({ ...sys, maintain: !sys.maintain })} />
        <SwitchRow
          title="调试模式"
          desc="仅管理员账号生效：跳过真实支付直接发货，普通买家不受影响（仅测试用）"
          on={!!sys.debugMode}
          onToggle={() => setSys({ ...sys, debugMode: !sys.debugMode })}
        />
        <div className="flex justify-end bg-paper px-[18px] py-3.5">
          <button
            type="button"
            className="h-9 rounded-[10px] bg-ink px-4 text-[0.86rem] font-semibold text-white"
            onClick={() => saveSys('系统设置已保存')}
          >
            保存
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-[18px] border border-[var(--line)] bg-white">
        <div className="border-b border-[var(--line)] px-[18px] py-3.5">
          <h3 className="font-[family-name:var(--font-display)] text-[1.05rem] font-bold">邮件服务（腾讯云 SES）</h3>
          <p className="mt-1 text-[0.82rem] text-ink-mute">
            接入{' '}
            <a
              href="https://cloud.tencent.com/document/product/1288/51034"
              target="_blank"
              rel="noreferrer"
              className="text-teal hover:underline"
            >
              腾讯云邮件推送
            </a>
            ：先验证发信域名、创建模板并审核通过，再填写下方配置。
          </p>
        </div>
        <SwitchRow
          title="启用邮件"
          desc="关闭后不发送任何邮件（发货通知 / 注册验证 / 登录验证 / 找回密码）"
          on={mail.enabled}
          onToggle={() => setMail({ enabled: !mail.enabled })}
        />
        <div className="grid items-start gap-4 border-b border-[var(--line)] p-[18px] md:grid-cols-2">
          <Field
            label="SecretId"
            value={mail.secret_id}
            onChange={(v) => setMail({ secret_id: v })}
            type="password"
            autoComplete="off"
            hint="访问管理 CAM 密钥；掩码表示已保存，保持不变即不修改"
          />
          <Field
            label="SecretKey"
            value={mail.secret_key}
            onChange={(v) => setMail({ secret_key: v })}
            type="password"
            autoComplete="off"
            hint="掩码表示已保存，保持不变即不修改"
          />
          <label className="grid grid-rows-[auto_auto_1.1em] gap-1.5 content-start">
            <span className="text-[0.82rem] font-semibold text-ink-soft">地域 Region</span>
            <select
              className="box-border h-11 w-full rounded-xl border border-[var(--line-strong)] bg-white px-3.5 outline-none focus:border-teal"
              value={mail.region || 'ap-guangzhou'}
              onChange={(e) => setMail({ region: e.target.value })}
            >
              <option value="ap-guangzhou">ap-guangzhou（广州）</option>
              <option value="ap-hongkong">ap-hongkong（香港）</option>
            </select>
            <span className="text-[0.75rem] leading-[1.1em] text-ink-mute">与控制台邮件推送地域一致</span>
          </label>
          <Field
            label="发信地址"
            value={mail.from_email}
            onChange={(v) => setMail({ from_email: v })}
            placeholder="noreply@your-domain.com"
            hint="须为已验证发信域名下的地址"
          />
          <Field label="发件人显示名" value={mail.from_alias} onChange={(v) => setMail({ from_alias: v })} placeholder="领匣" />
          <Field
            label="回复地址 reply_to"
            value={mail.reply_to}
            onChange={(v) => setMail({ reply_to: v })}
            placeholder="可选，建议填客服邮箱"
          />
          <Field
            label="买家发货模板 ID"
            value={mail.template_buyer}
            onChange={(v) => setMail({ template_buyer: v })}
            hint="数字 ID；变量 {{site_name}} {{order_id}} {{username}} {{total}} {{products}}"
          />
          <Field
            label="找回密码模板 ID"
            value={mail.template_reset}
            onChange={(v) => setMail({ template_reset: v })}
            hint="数字 ID；变量 {{site_name}} {{username}} {{code}}"
          />
          <Field
            label="注册验证码模板 ID"
            value={mail.template_register}
            onChange={(v) => setMail({ template_register: v })}
            hint="数字 ID；变量 {{site_name}} {{username}} {{email}} {{code}} {{expire_minutes}}"
          />
          <Field
            label="登录验证码模板 ID"
            value={mail.template_login}
            onChange={(v) => setMail({ template_login: v })}
            hint="数字 ID；变量 {{site_name}} {{username}} {{email}} {{code}} {{expire_minutes}}"
          />
        </div>
        <div className="flex justify-end bg-paper px-[18px] py-3.5">
          <button
            type="button"
            className="h-9 rounded-[10px] bg-ink px-4 text-[0.86rem] font-semibold text-white"
            onClick={() => saveSys('邮件设置已保存')}
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
