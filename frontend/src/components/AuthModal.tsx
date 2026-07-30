import { useEffect, useState, type FormEvent } from 'react'
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

export function AuthModal() {
  const { authOpen, authTab, setAuthTab, closeAuth, login, publicSettings } = useAuth()
  const { showToast } = useToast()
  const navigate = useNavigate()

  const [loginUser, setLoginUser] = useState('')
  const [loginPass, setLoginPass] = useState('')
  const [loginCaptcha, setLoginCaptcha] = useState('')
  const [regUser, setRegUser] = useState('')
  const [regPass, setRegPass] = useState('')
  const [regPass2, setRegPass2] = useState('')
  const [regCaptcha, setRegCaptcha] = useState('')
  const [loginError, setLoginError] = useState('')
  const [regError, setRegError] = useState('')
  const [captcha, setCaptcha] = useState<CaptchaRes | null>(null)
  const [submitting, setSubmitting] = useState(false)

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
      setLoginError('')
      setRegError('')
    }
  }, [authOpen, authTab])

  async function onLogin(e: FormEvent) {
    e.preventDefault()
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
  }

  async function onRegister(e: FormEvent) {
    e.preventDefault()
    if (!captcha) return
    if (publicSettings && !publicSettings.allowReg) {
      setRegError('当前已关闭注册，请联系管理员')
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
        password: regPass,
        captcha_id: captcha.captcha_id,
        captcha: regCaptcha,
      })
      login(res.access_token, res.user)
      closeAuth()
      showToast('注册成功，已自动登录')
    } catch (err) {
      setRegError(err instanceof ApiError ? err.message : '注册失败')
      setRegCaptcha('')
      loadCaptcha()
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
          <div className="flex gap-1 rounded-[10px] bg-paper p-1">
            <button
              type="button"
              className={`rounded-lg px-4 py-2 text-[0.9rem] font-semibold ${
                authTab === 'login' ? 'bg-white text-ink shadow-sm' : 'text-ink-soft'
              }`}
              onClick={() => setAuthTab('login')}
            >
              登录
            </button>
            <button
              type="button"
              className={`rounded-lg px-4 py-2 text-[0.9rem] font-semibold ${
                authTab === 'register' ? 'bg-white text-ink shadow-sm' : 'text-ink-soft'
              }`}
              onClick={() => setAuthTab('register')}
            >
              注册
            </button>
          </div>
          <button
            type="button"
            onClick={closeAuth}
            className="grid h-9 w-9 place-items-center rounded-[10px] border border-[var(--line)] bg-white"
            aria-label="关闭"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M2 2l10 10M12 2L2 12" />
            </svg>
          </button>
        </div>
        <div className="p-5">
          {authTab === 'login' ? (
            <form className="grid gap-3.5" onSubmit={onLogin} autoComplete="off">
              <Field label="用户名">
                <input
                  className="field-input"
                  value={loginUser}
                  onChange={(e) => setLoginUser(e.target.value)}
                  placeholder="请输入用户名"
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
              <Field label="图形验证码">
                <div className="grid grid-cols-[1fr_110px] gap-2.5">
                  <input
                    className="field-input"
                    value={loginCaptcha}
                    onChange={(e) => setLoginCaptcha(e.target.value)}
                    placeholder="输入右侧字符"
                    required
                  />
                  <button
                    type="button"
                    onClick={loadCaptcha}
                    className="relative h-11 overflow-hidden rounded-xl border border-[var(--line-strong)] bg-paper"
                    title="点击刷新验证码"
                  >
                    {captcha ? <img src={captcha.image} alt="验证码" className="h-full w-full object-cover" /> : null}
                  </button>
                </div>
              </Field>
              <div className="min-h-[1.2em] text-[0.82rem] text-danger">{loginError}</div>
              <button
                type="submit"
                disabled={submitting}
                className="h-[46px] rounded-xl bg-teal font-semibold text-white hover:bg-teal-deep disabled:opacity-60"
              >
                登录
              </button>
              <div className="text-center text-[0.78rem] leading-relaxed text-ink-mute">还没有账号？切换到注册页创建</div>
            </form>
          ) : (
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
              <Field label="图形验证码">
                <div className="grid grid-cols-[1fr_110px] gap-2.5">
                  <input
                    className="field-input"
                    value={regCaptcha}
                    onChange={(e) => setRegCaptcha(e.target.value)}
                    placeholder="输入右侧字符"
                    required
                  />
                  <button
                    type="button"
                    onClick={loadCaptcha}
                    className="relative h-11 overflow-hidden rounded-xl border border-[var(--line-strong)] bg-paper"
                    title="点击刷新验证码"
                  >
                    {captcha ? <img src={captcha.image} alt="验证码" className="h-full w-full object-cover" /> : null}
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
