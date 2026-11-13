import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, Megaphone, PlusCircle } from 'lucide-react'
import { ApiError, api } from '../../lib/api'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { inSpan, moneyOf, periodRange, shortAgo } from '../../lib/desk'
import { shanghaiDay, yuanText } from '../../lib/ledger'
import type { Analytics, LedgerRow, MailSettings, PaymentChannel, Settings, SiteSettings, SysSettings, User } from '../../types'

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

function maskId(raw: string) {
  const s = raw.trim()
  if (!s || s === '—') return '—'
  if (s.length <= 8) return `${s.slice(0, 2)}••${s.slice(-2)}`
  return `${s.slice(0, 4)}••••${s.slice(-4)}`
}

function notifyPath(provider: string) {
  if (provider === 'alipay') return '/api/pay/alipay/notify'
  if (provider === 'ezpay') return '/api/pay/ezpay/notify'
  if (provider === 'usdt') return '链上自动监听'
  return '—'
}

function providerName(provider: string) {
  if (provider === 'alipay') return '支付宝官方'
  if (provider === 'ezpay') return '易支付'
  if (provider === 'usdt') return 'USDT 自托管'
  return provider
}

export function SettingsDesk({ focus }: { focus: 'payment' | 'system' | 'website' }) {
  const { showToast } = useToast()
  const { user, login, refreshSettings } = useAuth()
  const navigate = useNavigate()
  const [channels, setChannels] = useState<PaymentChannel[]>([])
  const [rows, setRows] = useState<LedgerRow[]>([])
  const [sys, setSys] = useState<SysSettings | null>(null)
  const [site, setSite] = useState<SiteSettings | null>(null)
  const [activeSec, setActiveSec] = useState<'payment' | 'system' | 'website'>(focus)
  const [account, setAccount] = useState({ username: '', email: '', current_password: '', new_password: '', confirm_password: '' })
  const [accountError, setAccountError] = useState('')
  const [accountSaving, setAccountSaving] = useState(false)

  useEffect(() => {
    api.get<PaymentChannel[]>('/api/payment-channels').then(setChannels).catch(() => setChannels([]))
    api.get<Analytics>('/api/analytics').then((a) => setRows(a.rows)).catch(() => setRows([]))
    api
      .get<Settings>('/api/settings')
      .then((s) => {
        setSys(normalizeSys(s.sys))
        setSite(s.site)
      })
      .catch((e) => showToast(e instanceof ApiError ? e.message : '设置加载失败'))
  }, [showToast])

  useEffect(() => {
    if (user) setAccount((prev) => ({ ...prev, username: user.username, email: user.email || '' }))
  }, [user])

  useEffect(() => {
    setActiveSec(focus)
    document.getElementById(focus)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [focus])

  const range = periodRange('30')
  const week = periodRange('7')
  const recent = useMemo(() => rows.filter((r) => inSpan(r.at, range.from, range.to)), [rows, range.from, range.to])
  const paid = recent.filter((r) => r.ok)
  const failed = recent.filter((r) => !r.ok)
  const rev = moneyOf(paid)
  const rate = paid.length + failed.length ? Math.round((paid.length / (paid.length + failed.length)) * 1000) / 10 : 0
  const latest = paid.slice().sort((a, b) => +new Date(b.at) - +new Date(a.at))[0]
  const weekFail = rows.filter((r) => !r.ok && inSpan(r.at, week.from, week.to)).slice(0, 8)

  function belongs(ch: PaymentChannel, row: LedgerRow) {
    if (row.payment_channel_id) return row.payment_channel_id === ch.id
    const mates = channels.filter((c) => c.provider === ch.provider)
    if (mates.length !== 1) return false
    if (ch.provider === 'alipay') return row.channel === '支付宝'
    if (ch.provider === 'ezpay') return row.channel === '易支付' || row.channel === '微信'
    if (ch.provider === 'usdt') return row.channel === 'USDT'
    return false
  }

  async function saveSys() {
    if (!sys) return
    try {
      const saved = await api.put<Settings>('/api/settings/sys', sys)
      setSys(normalizeSys(saved.sys))
      await refreshSettings()
      showToast('系统设置已保存')
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : '保存失败')
    }
  }

  async function saveSite() {
    if (!site) return
    try {
      await api.put('/api/settings/site', site)
      document.title = site.title
      await refreshSettings()
      showToast('网站设置已保存')
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : '保存失败')
    }
  }

  async function saveAccount() {
    setAccountError('')
    if (!account.current_password) return setAccountError('请输入当前密码')
    const usernameChanged = account.username.trim() !== (user?.username || '')
    const emailChanged = account.email.trim() !== (user?.email || '')
    const passwordChanged = Boolean(account.new_password)
    if (!usernameChanged && !emailChanged && !passwordChanged) return setAccountError('请修改用户名、邮箱或密码后再保存')
    if (passwordChanged && account.new_password.length < 6) return setAccountError('新密码至少 6 位')
    if (passwordChanged && account.new_password !== account.confirm_password) return setAccountError('两次输入的新密码不一致')
    setAccountSaving(true)
    try {
      const res = await api.put<TokenOut>('/api/auth/account', {
        current_password: account.current_password,
        username: usernameChanged ? account.username.trim() : undefined,
        email: emailChanged ? account.email.trim() : undefined,
        new_password: passwordChanged ? account.new_password : undefined,
      })
      login(res.access_token, res.user)
      setAccount({ username: res.user.username, email: res.user.email || '', current_password: '', new_password: '', confirm_password: '' })
      showToast('账号信息已更新')
    } catch (e) {
      setAccountError(e instanceof ApiError ? e.message : '更新失败')
    } finally {
      setAccountSaving(false)
    }
  }

  async function toggleChannel(ch: PaymentChannel) {
    try {
      const next = await api.patch<PaymentChannel>(`/api/payment-channels/${ch.id}/toggle`)
      setChannels((prev) => prev.map((c) => (c.id === next.id ? next : c)))
      showToast(next.enabled ? '渠道已启用' : '渠道已停用')
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : '操作失败')
    }
  }

  async function removeChannel(ch: PaymentChannel) {
    if (!window.confirm(`确定删除渠道「${ch.name}」？`)) return
    try {
      await api.delete(`/api/payment-channels/${ch.id}`)
      setChannels((prev) => prev.filter((c) => c.id !== ch.id))
      showToast('渠道已删除')
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : '删除失败')
    }
  }

  const mail = sys?.mail

  return (
    <div className="desk-inner">
      <header className="cfg-hero">
        <div>
          <div className="cfg-kicker">
            <span className="badge">SYSTEM &amp; GATEWAY</span>
            <span>先看这 30 天通道跑得稳不稳，再改密钥与公告</span>
          </div>
          <h1>站点配置中心</h1>
          <p className="lead">
            支付通道、发信服务与前台公告集中在这里维护；密钥不直接平铺，仅保留在渠道二级表单与服务器环境变量中。
          </p>
          <nav className="anchor-tabs" aria-label="配置分段">
            {(
              [
                ['payment', '支付接入'],
                ['system', '系统与安全'],
                ['website', '网站与公告'],
              ] as const
            ).map(([sec, label]) => (
              <a
                key={sec}
                href={`#${sec}`}
                className={activeSec === sec ? 'on' : ''}
                onClick={(e) => {
                  e.preventDefault()
                  setActiveSec(sec)
                  document.getElementById(sec)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                }}
              >
                {label}
              </a>
            ))}
          </nav>
        </div>

        <div className="health-grid">
          <div className="h-box">
            <div>
              <small>30 日通道实收</small>
              <b>{yuanText(rev)}</b>
            </div>
            <span className="h-dot" />
          </div>
          <div className="h-box">
            <div>
              <small>支付成功率</small>
              <b>
                {rate}% <span style={{ color: failed.length ? 'var(--danger)' : 'var(--ink-mute)', fontSize: '.72rem' }}>({failed.length} 笔败)</span>
              </b>
            </div>
            <span className={`h-dot ${failed.length ? 'warn' : ''}`} />
          </div>
          <div className="h-box">
            <div>
              <small>最近入账</small>
              <b>{latest ? shortAgo(latest.at) : '暂无'}</b>
            </div>
            <span className="h-dot" />
          </div>
          <div className="h-box">
            <div>
              <small>腾讯云邮件</small>
              <b>{mail?.enabled ? `正常 · ${mail.region || 'ap-guangzhou'}` : '未开启'}</b>
            </div>
            <span className={`h-dot ${mail?.enabled ? '' : 'warn'}`} />
          </div>
        </div>
      </header>

      <section className="sec-band" id="payment">
        <div className="band-head">
          <h2>
            支付渠道与异常监测
            <small>密钥留在编辑二级页，概览只看实收与成功率</small>
          </h2>
        </div>

        <div className="pay-grid">
          <div className="ch-cards">
            {channels.map((ch) => {
              const mine = recent.filter((r) => belongs(ch, r))
              const got = mine.filter((r) => r.ok)
              const bad = mine.filter((r) => !r.ok)
              const money = moneyOf(got)
              const methods = (ch.config?.methods || {}) as Record<string, boolean>
              const usdtChains =
                ch.provider === 'usdt' && ch.config?.chains
                  ? Object.entries(ch.config.chains)
                      .filter(([, v]) => v?.enabled && v?.address)
                      .map(([k]) => k.toUpperCase())
                  : []
              const methodLabels = [
                methods.alipay ? '支付宝' : null,
                methods.wxpay ? '微信' : null,
                methods.qqpay ? 'QQ' : null,
                methods.usdt ? (usdtChains.length ? `USDT (${usdtChains.join('/')})` : 'USDT') : null,
              ].filter(Boolean)
              const firstUsdtAddr =
                ch.provider === 'usdt' && ch.config?.chains
                  ? Object.values(ch.config.chains).find((v) => v?.enabled && v?.address)?.address || ''
                  : ''
              const merchant = maskId(String(ch.config?.app_id || ch.config?.pid || firstUsdtAddr || ''))
              const okRate = mine.length ? Math.round((got.length / mine.length) * 1000) / 10 : 0
              const sharePct = rev ? Math.round((money / rev) * 100) : 0
              return (
                <article className="ch-card" key={ch.id}>
                  <div>
                    <h3>
                      {ch.name}
                      <button type="button" className={ch.enabled ? 'st teal' : 'st mute'} onClick={() => void toggleChannel(ch)}>
                        <i />
                        {ch.enabled ? '启用中' : '已停用'}
                      </button>
                    </h3>
                    <p>
                      {providerName(ch.provider)}
                      {methodLabels.length ? ` · ${methodLabels.join(' + ')}` : ''} · {merchant} · 回调 {notifyPath(ch.provider)}
                    </p>
                    <div className="ch-figs">
                      <div>
                        <small>30 日实收</small>
                        <b>{yuanText(money)}</b>
                      </div>
                      <div>
                        <small>占全店</small>
                        <b>{sharePct}%</b>
                      </div>
                      <div>
                        <small>成功率</small>
                        <b style={{ color: okRate >= 95 ? 'var(--teal)' : undefined }}>{okRate}%</b>
                      </div>
                      <div>
                        <small>失败笔数</small>
                        <b style={{ color: bad.length ? 'var(--danger)' : undefined }}>{bad.length} 笔</b>
                      </div>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <button type="button" className="line-btn" style={{ height: 32 }} onClick={() => navigate(`/admin/payment/${ch.id}`)}>
                      编辑配置
                    </button>
                    <button type="button" className="text-[0.74rem] font-bold text-danger" onClick={() => void removeChannel(ch)}>
                      删除
                    </button>
                  </div>
                </article>
              )
            })}
            {!channels.length ? <p className="empty">还没有支付渠道</p> : null}

            <button type="button" className="ch-add-card" onClick={() => navigate('/admin/payment/new')}>
              <span>
                <PlusCircle className="mr-2 inline h-4 w-4 text-teal" />
                接入新的支付渠道（支付宝 / 易支付 / USDT）
              </span>
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>

          <div className="card-panel">
            <h3>
              近 7 日未入账
              <Link to="/admin/revenue?status=failed" className="font-[family-name:var(--font-body)] text-[0.75rem] font-bold text-teal">
                去营收排查
              </Link>
            </h3>
            <ul className="fail-list">
              {weekFail.map((r) => (
                <li key={`${r.order_id}-${r.at}`}>
                  <Link
                    to={`/admin/revenue?order=${encodeURIComponent(r.order_id)}`}
                    className="flex w-full items-center justify-between gap-2.5"
                  >
                    <div>
                      <b>{r.item}</b>
                      <small>
                        {r.buyer || '买家'} · {r.channel} · {shanghaiDay(r.at).slice(5)}
                      </small>
                    </div>
                    <span className="mono font-bold text-danger">{yuanText(r.amount)}</span>
                  </Link>
                </li>
              ))}
            </ul>
            {!weekFail.length ? <p className="empty" style={{ padding: '20px 0' }}>这 7 天没有失败的单</p> : null}
            <p className="funnel-note">改完网关或密钥后，可在开启调试模式时下 0.01 元测试单核验回调。</p>
          </div>
        </div>
      </section>

      <section className="sec-band" id="system">
        <div className="band-head">
          <h2>
            系统参数与账号安全
            <small>发信配置、调试开关与管理员凭据</small>
          </h2>
        </div>

        {sys && mail ? (
          <div className="two-cards">
            <div className="card-panel">
              <h3>调试与邮件推送</h3>
              <div className="mt-2">
                <Switch label="调试模式" hint="只有管理员下单时跳过真实支付" on={!!sys.debugMode} onClick={() => setSys({ ...sys, debugMode: !sys.debugMode })} />
                <Switch label="自动发货" hint="付款成功后把发货内容写入订单" on={sys.autoDeliver} onClick={() => setSys({ ...sys, autoDeliver: !sys.autoDeliver })} />
                <Switch label="开放注册" hint="关闭后新用户不能注册" on={sys.allowReg} onClick={() => setSys({ ...sys, allowReg: !sys.allowReg })} />
                <Switch label="维护模式" hint="开启后暂停下单" on={sys.maintain} onClick={() => setSys({ ...sys, maintain: !sys.maintain })} />
                <Switch label="腾讯云邮件推送" on={mail.enabled} onClick={() => setSys({ ...sys, mail: { ...mail, enabled: !mail.enabled } })} />
              </div>
              <div className="fields">
                <label className="field">
                  <span>站点名称</span>
                  <input value={sys.name} onChange={(e) => setSys({ ...sys, name: e.target.value })} />
                </label>
                <label className="field">
                  <span>客服邮箱</span>
                  <input value={sys.email} onChange={(e) => setSys({ ...sys, email: e.target.value })} />
                </label>
                <label className="field">
                  <span>通知 Webhook</span>
                  <input value={sys.notify} onChange={(e) => setSys({ ...sys, notify: e.target.value })} />
                </label>
                <label className="field">
                  <span>发信地址</span>
                  <input value={mail.from_email} onChange={(e) => setSys({ ...sys, mail: { ...mail, from_email: e.target.value } })} />
                </label>
                <label className="field">
                  <span>发信别名</span>
                  <input value={mail.from_alias} onChange={(e) => setSys({ ...sys, mail: { ...mail, from_alias: e.target.value } })} />
                </label>
                <label className="field">
                  <span>地域</span>
                  <select value={mail.region || 'ap-guangzhou'} onChange={(e) => setSys({ ...sys, mail: { ...mail, region: e.target.value } })}>
                    <option value="ap-guangzhou">ap-guangzhou</option>
                    <option value="ap-hongkong">ap-hongkong</option>
                  </select>
                </label>
                <label className="field">
                  <span>回复地址</span>
                  <input value={mail.reply_to} onChange={(e) => setSys({ ...sys, mail: { ...mail, reply_to: e.target.value } })} />
                </label>
                <label className="field">
                  <span>SecretId</span>
                  <input type="password" autoComplete="off" value={mail.secret_id} onChange={(e) => setSys({ ...sys, mail: { ...mail, secret_id: e.target.value } })} />
                  <small>掩码表示已保存，保持不变即不修改</small>
                </label>
                <label className="field">
                  <span>SecretKey</span>
                  <input type="password" autoComplete="off" value={mail.secret_key} onChange={(e) => setSys({ ...sys, mail: { ...mail, secret_key: e.target.value } })} />
                  <small>掩码表示已保存，保持不变即不修改</small>
                </label>
                <label className="field">
                  <span>发货模板 ID</span>
                  <input value={mail.template_buyer} onChange={(e) => setSys({ ...sys, mail: { ...mail, template_buyer: e.target.value } })} />
                </label>
                <label className="field">
                  <span>找回密码模板 ID</span>
                  <input value={mail.template_reset} onChange={(e) => setSys({ ...sys, mail: { ...mail, template_reset: e.target.value } })} />
                </label>
                <label className="field">
                  <span>注册验证码模板 ID</span>
                  <input value={mail.template_register} onChange={(e) => setSys({ ...sys, mail: { ...mail, template_register: e.target.value } })} />
                </label>
                <label className="field">
                  <span>登录验证码模板 ID</span>
                  <input value={mail.template_login} onChange={(e) => setSys({ ...sys, mail: { ...mail, template_login: e.target.value } })} />
                </label>
              </div>
              <button className="teal-btn" type="button" style={{ marginTop: 14 }} onClick={() => void saveSys()}>
                保存系统设置
              </button>
            </div>

            <div className="card-panel">
              <h3>管理员账号与凭据</h3>
              <div className="fields">
                <label className="field">
                  <span>用户名</span>
                  <input value={account.username} autoComplete="username" onChange={(e) => setAccount({ ...account, username: e.target.value })} />
                  <small>3-16 位字母、数字或下划线</small>
                </label>
                <label className="field">
                  <span>邮箱</span>
                  <input value={account.email} autoComplete="email" onChange={(e) => setAccount({ ...account, email: e.target.value })} />
                </label>
                <label className="field">
                  <span>当前密码</span>
                  <input
                    type="password"
                    autoComplete="current-password"
                    value={account.current_password}
                    placeholder="修改账号时才填"
                    onChange={(e) => setAccount({ ...account, current_password: e.target.value })}
                  />
                </label>
                <label className="field">
                  <span>新密码</span>
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={account.new_password}
                    placeholder="留空则不改"
                    onChange={(e) => setAccount({ ...account, new_password: e.target.value })}
                  />
                </label>
                <label className="field">
                  <span>确认新密码</span>
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={account.confirm_password}
                    onChange={(e) => setAccount({ ...account, confirm_password: e.target.value })}
                  />
                </label>
              </div>
              {accountError ? (
                <p className="funnel-note" style={{ color: 'var(--danger)' }}>
                  {accountError}
                </p>
              ) : null}
              <button className="teal-btn" type="button" style={{ marginTop: 14 }} disabled={accountSaving} onClick={() => void saveAccount()}>
                {accountSaving ? '保存中…' : '更新账号'}
              </button>
            </div>
          </div>
        ) : (
          <p className="empty">加载中…</p>
        )}
      </section>

      <section className="sec-band" id="website">
        <div className="band-head">
          <h2>
            网站信息与首页公告
            <small>右侧实时预览保存后的前台效果</small>
          </h2>
        </div>

        {site ? (
          <div className="two-cards">
            <div className="card-panel">
              <h3>站点文案设置</h3>
              <div className="fields">
                <label className="field">
                  <span>站点域名</span>
                  <input value={site.domain || ''} onChange={(e) => setSite({ ...site, domain: e.target.value })} />
                  <small>页脚展示，只写域名</small>
                </label>
                <label className="field">
                  <span>SEO 标题</span>
                  <input value={site.title} onChange={(e) => setSite({ ...site, title: e.target.value })} />
                </label>
                <label className="field">
                  <span>关键词</span>
                  <input value={site.keywords} onChange={(e) => setSite({ ...site, keywords: e.target.value })} />
                </label>
                <label className="field">
                  <span>站点描述</span>
                  <textarea rows={3} value={site.desc} onChange={(e) => setSite({ ...site, desc: e.target.value })} />
                </label>
                <label className="field">
                  <span>首页公告</span>
                  <textarea rows={3} value={site.notice} onChange={(e) => setSite({ ...site, notice: e.target.value })} />
                </label>
              </div>
              <button className="teal-btn" type="button" style={{ marginTop: 14 }} onClick={() => void saveSite()}>
                保存网站设置
              </button>
            </div>

            <div className="card-panel">
              <h3>前台实时预览</h3>
              <div className="browser-mock">
                <div className="browser-bar">
                  <span className="browser-dots">
                    <i />
                    <i />
                    <i />
                  </span>
                  <span className="browser-url">https://{site.domain || 'xinx.shop'}</span>
                </div>
                <div className="browser-body">
                  <div className="mock-notice">
                    <Megaphone className="h-3.5 w-3.5 shrink-0" />
                    <span>{site.notice || '（当前未设置首页公告）'}</span>
                  </div>
                  <h4 className="mock-title">{site.title || '未命名站点'}</h4>
                  <p className="mock-desc">{site.desc || '暂无站点描述'}</p>
                  <div className="mock-seo">
                    META: {site.keywords || '—'} · © {site.domain || 'xinx.shop'}
                  </div>
                </div>
              </div>
              <p className="funnel-note">保存前可直接核对公告条是否换行过长或遮挡首屏标题。</p>
            </div>
          </div>
        ) : (
          <p className="empty">加载中…</p>
        )}
      </section>
    </div>
  )
}

function Switch({ label, hint, on, onClick }: { label: string; hint?: string; on: boolean; onClick: () => void }) {
  return (
    <div className="switch">
      <span>
        {label}
        {hint ? <small style={{ color: 'var(--ink-mute)' }}> {hint}</small> : null}
      </span>
      <button type="button" className={on ? 'on' : ''} aria-label={label} onClick={onClick}>
        <i />
      </button>
    </div>
  )
}
