import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type FormEvent,
  type MutableRefObject,
  type SetStateAction,
} from 'react'
import { useNavigate } from 'react-router-dom'
import { ApiError, api } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import type { User } from '../types'

interface CaptchaRes {
  captcha_id: string
  image: string
}

interface AuthRes {
  access_token: string
  user: User
}

type LoginMode = 'password' | 'code'

export function AuthModal() {
  const { authOpen, authTab, setAuthTab, closeAuth, login, publicSettings, sessionExpired } = useAuth()
  const { showToast } = useToast()
  const navigate = useNavigate()

  const [loginMode, setLoginMode] = useState<LoginMode>('password')
  const [loginUser, setLoginUser] = useState('')
  const [loginPass, setLoginPass] = useState('')
  const [loginEmail, setLoginEmail] = useState('')
  const [loginCode, setLoginCode] = useState('')
  const [loginCaptcha, setLoginCaptcha] = useState('')
  const [loginCodeCooldown, setLoginCodeCooldown] = useState(0)
  const [sendingLoginCode, setSendingLoginCode] = useState(false)
  const [regUser, setRegUser] = useState('')
  const [regEmail, setRegEmail] = useState('')
  const [regPass, setRegPass] = useState('')
  const [regPass2, setRegPass2] = useState('')
  const [regCode, setRegCode] = useState('')
  const [regCaptcha, setRegCaptcha] = useState('')
  const [regCodeCooldown, setRegCodeCooldown] = useState(0)
  const [sendingRegCode, setSendingRegCode] = useState(false)
  const [resetAccount, setResetAccount] = useState('')
  const [resetCode, setResetCode] = useState('')
  const [resetPass, setResetPass] = useState('')
  const [resetPass2, setResetPass2] = useState('')
  const [resetCaptcha, setResetCaptcha] = useState('')
  const [resetStep, setResetStep] = useState<'send' | 'confirm'>('send')
  const [loginError, setLoginError] = useState('')
  const [regError, setRegError] = useState('')
  const [resetError, setResetError] = useState('')
  const [captcha, setCaptcha] = useState<CaptchaRes | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const regCooldownTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const loginCooldownTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  async function loadCaptcha() {
    try {
      const c = await api.get<CaptchaRes>('/api/captcha')
      setCaptcha(c)
    } catch {
      setCaptcha(null)
    }
  }

  useEffect(() => {
    if (authOpen) {
      loadCaptcha()
      setLoginError(sessionExpired ? '登录已失效，请重新登录' : '')
      setRegError('')
      setResetError('')
      if (authTab !== 'reset') setResetStep('send')
    }
  }, [authOpen, authTab, sessionExpired])

  useEffect(() => {
    return () => {
      if (regCooldownTimer.current) clearInterval(regCooldownTimer.current)
      if (loginCooldownTimer.current) clearInterval(loginCooldownTimer.current)
    }
  }, [])

  function startCooldown(
    setter: Dispatch<SetStateAction<number>>,
    timerRef: MutableRefObject<ReturnType<typeof setInterval> | null>,
    seconds = 60,
  ) {
    setter(seconds)
    if (timerRef.current) clearInterval(timerRef.current)
    timerRef.current = setInterval(() => {
      setter((n) => {
        if (n <= 1) {
          if (timerRef.current) clearInterval(timerRef.current)
          timerRef.current = null
          return 0
        }
        return n - 1
      })
    }, 1000)
  }

  function startRegCodeCooldown(seconds = 60) {
    startCooldown(setRegCodeCooldown, regCooldownTimer, seconds)
  }

  function startLoginCodeCooldown(seconds = 60) {
    startCooldown(setLoginCodeCooldown, loginCooldownTimer, seconds)
  }

  async function onSendRegisterCode() {
    if (sendingRegCode || regCodeCooldown > 0) return
    if (publicSettings && !publicSettings.allowReg) {
      setRegError('当前已关闭注册，请联系管理员')
      return
    }
    const username = regUser.trim()
    const email = regEmail.trim()
    if (!username) {
      setRegError('请先填写用户名')
      return
    }
    if (!email) {
      setRegError('请先填写邮箱')
      return
    }
    if (!captcha || !regCaptcha.trim()) {
      setRegError('请填写图形验证码')
      return
    }
    setSendingRegCode(true)
    setRegError('')
    try {
      const res = await api.post<{ message: string }>('/api/auth/send-register-code', {
        email,
        username,
        captcha_id: captcha.captcha_id,
        captcha: regCaptcha,
      })
      showToast(res.message)
      startRegCodeCooldown(60)
    } catch (err) {
      setRegError(err instanceof ApiError ? err.message : '验证码发送失败')
    } finally {
      setRegCaptcha('')
      loadCaptcha()
      setSendingRegCode(false)
    }
  }

  async function onSendLoginCode() {
    if (sendingLoginCode || loginCodeCooldown > 0) return
    if (publicSettings && publicSettings.mailEnabled === false) {
      setLoginError('邮件服务未启用，暂时无法使用验证码登录')
      return
    }
    if (!captcha) return
    const email = loginEmail.trim()
    if (!email) {
      setLoginError('请填写邮箱')
      return
    }
    if (!loginCaptcha.trim()) {
      setLoginError('请填写图形验证码')
      return
    }
    setSendingLoginCode(true)
    setLoginError('')
    try {
      const res = await api.post<{ message: string }>('/api/auth/send-login-code', {
        email,
        captcha_id: captcha.captcha_id,
        captcha: loginCaptcha,
      })
      showToast(res.message)
      startLoginCodeCooldown(60)
      setLoginCaptcha('')
      loadCaptcha()
    } catch (err) {
      setLoginError(err instanceof ApiError ? err.message : '验证码发送失败')
      setLoginCaptcha('')
      loadCaptcha()
    } finally {
      setSendingLoginCode(false)
    }
  }

  async function onLogin(e: FormEvent) {
    e.preventDefault()
    if (loginMode === 'password') {
      if (!captcha) return
      setSubmitting(true)
      setLoginError('')
      try {
        const res = await api.post<AuthRes>('/api/auth/login', {
          username: loginUser.trim(),
          password: loginPass,
          captcha_id: captcha.captcha_id,
          captcha: loginCaptcha,
        })
        login(res.access_token, res.user)
        closeAuth()
        showToast('欢迎回来，' + res.user.username)
        if (res.user.role === 'admin') navigate('/admin')
      } catch (err) {
        setLoginError(err instanceof ApiError ? err.message : '登录失败')
        setLoginCaptcha('')
        loadCaptcha()
      } finally {
        setSubmitting(false)
      }
      return
    }

    setSubmitting(true)
    setLoginError('')
    try {
      const res = await api.post<AuthRes>('/api/auth/login-by-code', {
        email: loginEmail.trim(),
        code: loginCode.trim(),
      })
      login(res.access_token, res.user)
      closeAuth()
      showToast('欢迎回来，' + res.user.username)
      if (res.user.role === 'admin') navigate('/admin')
    } catch (err) {
      setLoginError(err instanceof ApiError ? err.message : '登录失败')
    } finally {
      setSubmitting(false)
    }
  }

  async function onRegister(e: FormEvent) {
    e.preventDefault()
    if (publicSettings && !publicSettings.allowReg) {
      setRegError('当前已关闭注册，请联系管理员')
      return
    }
    if (!regEmail.trim()) {
      setRegError('请填写邮箱')
      return
    }
    if (!regCode.trim()) {
      setRegError('请填写邮箱验证码')
      return
    }
    if (regPass !== regPass2) {
      setRegError('两次输入的密码不一致')
      return
    }
    setSubmitting(true)
    setRegError('')
    try {
      const res = await api.post<AuthRes>('/api/auth/register', {
        username: regUser.trim(),
        email: regEmail.trim(),
        password: regPass,
        code: regCode.trim(),
      })
      login(res.access_token, res.user)
      closeAuth()
      showToast('注册成功，已自动登录')
    } catch (err) {
      setRegError(err instanceof ApiError ? err.message : '注册失败')
    } finally {
      setSubmitting(false)
    }
  }

  async function onSendResetCode(e: FormEvent) {
    e.preventDefault()
    if (!captcha) return
    setSubmitting(true)
    setResetError('')
    try {
      const res = await api.post<{ message: string }>('/api/auth/forgot-password', {
        account: resetAccount.trim(),
        captcha_id: captcha.captcha_id,
        captcha: resetCaptcha,
      })
      showToast(res.message)
      setResetStep('confirm')
      setResetCaptcha('')
      loadCaptcha()
    } catch (err) {
      setResetError(err instanceof ApiError ? err.message : '发送失败')
      setResetCaptcha('')
      loadCaptcha()
    } finally {
      setSubmitting(false)
    }
  }

  async function onConfirmReset(e: FormEvent) {
    e.preventDefault()
    if (resetPass !== resetPass2) {
      setResetError('两次输入的密码不一致')
      return
    }
    setSubmitting(true)
    setResetError('')
    try {
      const res = await api.post<{ message: string }>('/api/auth/reset-password', {
        account: resetAccount.trim(),
        code: resetCode.trim(),
        new_password: resetPass,
      })
      showToast(res.message)
      setAuthTab('login')
      setResetStep('send')
      setResetCode('')
      setResetPass('')
      setResetPass2('')
    } catch (err) {
      setResetError(err instanceof ApiError ? err.message : '重置失败')
    } finally {
      setSubmitting(false)
    }
  }

  if (!authOpen) return null

  return (
    <div
      className="fixed inset-0 z-[70] grid place-items-center bg-[rgba(20,32,28,0.5)] p-5"
      onClick={(e) => {
        if (e.target === e.currentTarget) closeAuth()
      }}
    >
      <div className="w-[min(420px,100%)] overflow-hidden rounded-[22px] border border-[var(--line)] bg-fog">
        <div className="flex items-center justify-between px-5 pt-5">
          <div className="flex flex-wrap gap-1 rounded-[10px] bg-paper p-1">
            {(
              [
                ['login', '登录'],
                ['register', '注册'],
                ['reset', '找回密码'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={`rounded-lg px-3 py-2 text-[0.86rem] font-semibold ${
                  authTab === id ? 'bg-white text-ink shadow-sm' : 'text-ink-soft'
                }`}
                onClick={() => setAuthTab(id)}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={closeAuth}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] border border-[var(--line)] bg-white"
            aria-label="关闭"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M2 2l10 10M12 2L2 12" />
            </svg>
          </button>
        </div>
        <div className="p-5">
          {authTab === 'login' && (
            <form className="grid gap-3.5" onSubmit={onLogin} autoComplete="off">
              <div className="flex gap-1 rounded-[10px] bg-paper p-1">
                {(
                  [
                    ['password', '密码登录'],
                    ['code', '验证码登录'],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    className={`flex-1 rounded-lg px-3 py-2 text-[0.84rem] font-semibold ${
                      loginMode === id ? 'bg-white text-ink shadow-sm' : 'text-ink-soft'
                    }`}
                    onClick={() => {
                      setLoginMode(id)
                      setLoginError('')
                      setLoginCaptcha('')
                      loadCaptcha()
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {loginMode === 'password' ? (
                <>
                  <Field label="用户名或邮箱">
                    <input
                      className="field-input"
                      value={loginUser}
                      onChange={(e) => setLoginUser(e.target.value)}
                      placeholder="用户名 / 邮箱"
                      required
                    />
                  </Field>
                  <Field label="密码">
                    <input
                      className="field-input"
                      type="password"
                      value={loginPass}
                      onChange={(e) => setLoginPass(e.target.value)}
                      placeholder="请输入密码"
                      required
                    />
                  </Field>
                  <CaptchaField
                    value={loginCaptcha}
                    onChange={setLoginCaptcha}
                    captcha={captcha}
                    onRefresh={loadCaptcha}
                  />
                </>
              ) : (
                <>
                  <Field label="邮箱">
                    <input
                      className="field-input"
                      type="email"
                      value={loginEmail}
                      onChange={(e) => setLoginEmail(e.target.value)}
                      placeholder="已绑定的邮箱"
                      required
                    />
                  </Field>
                  <CaptchaField
                    value={loginCaptcha}
                    onChange={setLoginCaptcha}
                    captcha={captcha}
                    onRefresh={loadCaptcha}
                  />
                  <Field label="邮箱验证码">
                    <div className="flex gap-2">
                      <input
                        className="field-input min-w-0 flex-1"
                        value={loginCode}
                        onChange={(e) => setLoginCode(e.target.value)}
                        placeholder="6 位验证码"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        required
                      />
                      <button
                        type="button"
                        disabled={sendingLoginCode || loginCodeCooldown > 0}
                        onClick={onSendLoginCode}
                        className="h-11 shrink-0 rounded-xl border border-[var(--line-strong)] bg-white px-3 text-[0.82rem] font-semibold text-ink hover:border-teal hover:text-teal disabled:opacity-60"
                      >
                        {loginCodeCooldown > 0
                          ? `${loginCodeCooldown}s`
                          : sendingLoginCode
                            ? '发送中…'
                            : '发送验证码'}
                      </button>
                    </div>
                  </Field>
                </>
              )}

              <div className="min-h-[1.2em] text-[0.82rem] text-danger">{loginError}</div>
              <button
                type="submit"
                disabled={submitting}
                className="h-[46px] rounded-xl bg-teal font-semibold text-white hover:bg-teal-deep disabled:opacity-60"
              >
                登录
              </button>
              <button
                type="button"
                className="text-center text-[0.78rem] text-teal hover:underline"
                onClick={() => setAuthTab('reset')}
              >
                忘记密码？
              </button>
            </form>
          )}

          {authTab === 'register' && (
            <form className="grid gap-3.5" onSubmit={onRegister} autoComplete="off">
              <Field label="用户名">
                <input
                  className="field-input"
                  value={regUser}
                  onChange={(e) => setRegUser(e.target.value)}
                  placeholder="3-16 位字母、数字或下划线"
                  required
                />
              </Field>
              <Field label="邮箱">
                <input
                  className="field-input"
                  type="email"
                  value={regEmail}
                  onChange={(e) => setRegEmail(e.target.value)}
                  placeholder="用于登录验证与发货通知"
                  required
                />
              </Field>
              <Field label="密码">
                <input
                  className="field-input"
                  type="password"
                  value={regPass}
                  onChange={(e) => setRegPass(e.target.value)}
                  placeholder="至少 6 位"
                  required
                />
              </Field>
              <Field label="确认密码">
                <input
                  className="field-input"
                  type="password"
                  value={regPass2}
                  onChange={(e) => setRegPass2(e.target.value)}
                  placeholder="再次输入密码"
                  required
                />
              </Field>
              <CaptchaField
                value={regCaptcha}
                onChange={setRegCaptcha}
                captcha={captcha}
                onRefresh={loadCaptcha}
                required={false}
                hint="发送验证码需填写"
              />
              <Field label="邮箱验证码">
                <div className="flex gap-2">
                  <input
                    className="field-input min-w-0 flex-1"
                    value={regCode}
                    onChange={(e) => setRegCode(e.target.value)}
                    placeholder="6 位验证码"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    required
                  />
                  <button
                    type="button"
                    disabled={sendingRegCode || regCodeCooldown > 0}
                    onClick={onSendRegisterCode}
                    className="h-11 shrink-0 rounded-xl border border-[var(--line-strong)] bg-white px-3 text-[0.82rem] font-semibold text-ink hover:border-teal hover:text-teal disabled:opacity-60"
                  >
                    {regCodeCooldown > 0 ? `${regCodeCooldown}s` : sendingRegCode ? '发送中…' : '发送验证码'}
                  </button>
                </div>
              </Field>
              <div className="min-h-[1.2em] text-[0.82rem] text-danger">{regError}</div>
              <button
                type="submit"
                disabled={submitting}
                className="h-[46px] rounded-xl bg-teal font-semibold text-white hover:bg-teal-deep disabled:opacity-60"
              >
                注册
              </button>
            </form>
          )}

          {authTab === 'reset' && resetStep === 'send' && (
            <form className="grid gap-3.5" onSubmit={onSendResetCode} autoComplete="off">
              <p className="text-[0.85rem] text-ink-mute">输入用户名或绑定邮箱，我们将发送 6 位验证码。</p>
              <Field label="用户名或邮箱">
                <input
                  className="field-input"
                  value={resetAccount}
                  onChange={(e) => setResetAccount(e.target.value)}
                  placeholder="用户名 / 邮箱"
                  required
                />
              </Field>
              <CaptchaField value={resetCaptcha} onChange={setResetCaptcha} captcha={captcha} onRefresh={loadCaptcha} />
              <div className="min-h-[1.2em] text-[0.82rem] text-danger">{resetError}</div>
              <button
                type="submit"
                disabled={submitting}
                className="h-[46px] rounded-xl bg-teal font-semibold text-white hover:bg-teal-deep disabled:opacity-60"
              >
                {submitting ? '发送中…' : '发送验证码'}
              </button>
            </form>
          )}

          {authTab === 'reset' && resetStep === 'confirm' && (
            <form className="grid gap-3.5" onSubmit={onConfirmReset} autoComplete="off">
              <p className="text-[0.85rem] text-ink-mute">验证码已发送至绑定邮箱（15 分钟内有效）。</p>
              <Field label="验证码">
                <input
                  className="field-input"
                  value={resetCode}
                  onChange={(e) => setResetCode(e.target.value)}
                  placeholder="6 位数字"
                  required
                />
              </Field>
              <Field label="新密码">
                <input
                  className="field-input"
                  type="password"
                  value={resetPass}
                  onChange={(e) => setResetPass(e.target.value)}
                  placeholder="至少 6 位"
                  required
                />
              </Field>
              <Field label="确认新密码">
                <input
                  className="field-input"
                  type="password"
                  value={resetPass2}
                  onChange={(e) => setResetPass2(e.target.value)}
                  placeholder="再次输入新密码"
                  required
                />
              </Field>
              <div className="min-h-[1.2em] text-[0.82rem] text-danger">{resetError}</div>
              <button
                type="submit"
                disabled={submitting}
                className="h-[46px] rounded-xl bg-teal font-semibold text-white hover:bg-teal-deep disabled:opacity-60"
              >
                {submitting ? '提交中…' : '重置密码'}
              </button>
              <button
                type="button"
                className="text-center text-[0.78rem] text-ink-mute hover:text-teal"
                onClick={() => {
                  setResetStep('send')
                  loadCaptcha()
                }}
              >
                重新发送验证码
              </button>
            </form>
          )}
        </div>
      </div>
      <style>{`
        .field-input {
          height: 44px; width: 100%; padding: 0 14px; border-radius: 12px;
          border: 1px solid var(--line-strong); background: #fff; outline: none;
        }
        .field-input:focus { border-color: var(--teal); box-shadow: 0 0 0 3px rgba(15,110,92,.12); }
      `}</style>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5">
      <span className="text-[0.82rem] font-semibold text-ink-soft">{label}</span>
      {children}
    </label>
  )
}

function CaptchaField({
  value,
  onChange,
  captcha,
  onRefresh,
  required = true,
  hint,
}: {
  value: string
  onChange: (v: string) => void
  captcha: CaptchaRes | null
  onRefresh: () => void
  required?: boolean
  hint?: string
}) {
  return (
    <Field label={hint ? `图形验证码（${hint}）` : '图形验证码'}>
      <div className="grid grid-cols-[1fr_110px] gap-2.5">
        <input
          className="field-input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="输入右侧字符"
          required={required}
        />
        <button
          type="button"
          onClick={onRefresh}
          className="relative h-11 overflow-hidden rounded-xl border border-[var(--line-strong)] bg-paper"
          title="点击刷新验证码"
        >
          {captcha ? <img src={captcha.image} alt="验证码" className="h-full w-full object-cover" /> : null}
        </button>
      </div>
    </Field>
  )
}
