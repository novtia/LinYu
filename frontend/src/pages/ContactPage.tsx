import { useEffect, useState, type FormEvent } from 'react'
import { ApiError, api } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { PageBreadcrumb } from '../components/PageBreadcrumb'

interface CaptchaRes {
  captcha_id: string
  image: string
}

export function ContactPage() {
  const { publicSettings } = useAuth()
  const { showToast } = useToast()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [captchaInput, setCaptchaInput] = useState('')
  const [captcha, setCaptcha] = useState<CaptchaRes | null>(null)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function loadCaptcha() {
    try {
      setCaptcha(await api.get<CaptchaRes>('/api/captcha'))
    } catch {
      setCaptcha(null)
    }
  }

  useEffect(() => {
    loadCaptcha()
  }, [])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!captcha) return
    setSubmitting(true)
    setError('')
    try {
      const res = await api.post<{ message: string }>('/api/contact', {
        name: name.trim(),
        email: email.trim(),
        message: message.trim(),
        captcha_id: captcha.captcha_id,
        captcha: captchaInput,
      })
      showToast(res.message)
      setMessage('')
      setCaptchaInput('')
      loadCaptcha()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '发送失败')
      setCaptchaInput('')
      loadCaptcha()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="pb-20 pt-6 md:pt-8">
      <div className="wrap max-w-xl">
        <PageBreadcrumb items={[{ label: '商城', to: '/' }, { label: '联系我们' }]} />
        <h1 className="mb-2 font-[family-name:var(--font-display)] text-[clamp(1.6rem,3vw,2.2rem)] font-extrabold tracking-tight">
          联系我们
        </h1>
        <p className="mb-8 text-[0.92rem] text-ink-mute">
          有问题可在此留言
          {publicSettings?.name ? `，也可发邮件至客服（系统设置中的客服邮箱）` : ''}
          。
        </p>

        <form
          onSubmit={onSubmit}
          className="grid gap-4 overflow-hidden rounded-[22px] border border-[var(--line)] bg-white p-5 md:p-6"
        >
          <label className="grid gap-1.5">
            <span className="text-[0.82rem] font-semibold text-ink-soft">称呼</span>
            <input
              className="h-11 rounded-xl border border-[var(--line-strong)] px-3.5 outline-none focus:border-teal"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </label>
          <label className="grid gap-1.5">
            <span className="text-[0.82rem] font-semibold text-ink-soft">你的邮箱</span>
            <input
              type="email"
              className="h-11 rounded-xl border border-[var(--line-strong)] px-3.5 outline-none focus:border-teal"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="方便我们回复"
              required
            />
          </label>
          <label className="grid gap-1.5">
            <span className="text-[0.82rem] font-semibold text-ink-soft">留言内容</span>
            <textarea
              className="min-h-36 rounded-xl border border-[var(--line-strong)] px-3.5 py-3 outline-none focus:border-teal"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              required
            />
          </label>
          <label className="grid gap-1.5">
            <span className="text-[0.82rem] font-semibold text-ink-soft">图形验证码</span>
            <div className="grid grid-cols-[1fr_110px] gap-2.5">
              <input
                className="h-11 rounded-xl border border-[var(--line-strong)] px-3.5 outline-none focus:border-teal"
                value={captchaInput}
                onChange={(e) => setCaptchaInput(e.target.value)}
                required
              />
              <button
                type="button"
                onClick={loadCaptcha}
                className="relative h-11 overflow-hidden rounded-xl border border-[var(--line-strong)] bg-paper"
              >
                {captcha ? <img src={captcha.image} alt="验证码" className="h-full w-full object-cover" /> : null}
              </button>
            </div>
          </label>
          <div className="min-h-[1.2em] text-[0.82rem] text-danger">{error}</div>
          <button
            type="submit"
            disabled={submitting}
            className="h-12 rounded-xl bg-teal font-semibold text-white hover:bg-teal-deep disabled:opacity-60"
          >
            {submitting ? '发送中…' : '发送留言'}
          </button>
        </form>
      </div>
    </main>
  )
}
