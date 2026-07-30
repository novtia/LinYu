import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useCart } from '../context/CartContext'
import { useToast } from '../context/ToastContext'

export function Topbar() {
  const { user, openAuth, logout } = useAuth()
  const { items, openCart } = useCart()
  const { showToast } = useToast()
  const [menuOpen, setMenuOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    const onClick = () => setMenuOpen(false)
    document.addEventListener('click', onClick)
    return () => document.removeEventListener('click', onClick)
  }, [])

  return (
    <header
      className={`sticky top-0 z-40 border-b transition-colors duration-300 ${
        scrolled ? 'border-[var(--line)] bg-[rgba(243,248,246,0.92)]' : 'border-transparent bg-[rgba(243,248,246,0.78)]'
      } backdrop-blur-[14px]`}
    >
      <div className="wrap flex h-16 items-center justify-between">
        <Link to="/" className="inline-flex items-center gap-2.5 font-[family-name:var(--font-display)] text-[1.35rem] font-extrabold tracking-[-0.03em]">
          <span className="brand-mark" aria-hidden />
          领匣
        </Link>
        <nav className="hidden items-center gap-7 md:flex" aria-label="主导航">
          <Link to="/#shop" className="text-[0.92rem] font-medium text-ink-soft hover:text-ink">商品</Link>
          <Link to="/#trust" className="text-[0.92rem] font-medium text-ink-soft hover:text-ink">交付保障</Link>
        </nav>
        <div className="relative flex items-center gap-2.5">
          <button
            type="button"
            onClick={openCart}
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-ink px-3.5 text-[0.88rem] font-semibold text-white transition hover:-translate-y-px hover:bg-teal-deep"
          >
            购物车
            <span className="inline-grid min-w-5 place-items-center rounded-md bg-mint px-1.5 text-[0.75rem] font-bold text-ink">
              {items.length}
            </span>
          </button>
          <button
            type="button"
            aria-label="用户菜单"
            onClick={(e) => {
              e.stopPropagation()
              if (user) setMenuOpen((v) => !v)
              else openAuth('login')
            }}
            className={`grid h-10 w-10 place-items-center rounded-full border-2 border-white/70 text-[0.95rem] font-bold transition hover:-translate-y-px hover:bg-teal-deep ${
              user ? 'bg-ink text-white' : 'bg-paper-2 text-ink-soft'
            }`}
          >
            {user ? (
              user.username.slice(0, 1).toUpperCase()
            ) : (
              <svg viewBox="0 0 24 24" className="h-[18px] w-[18px] fill-none stroke-current stroke-[1.8]">
                <circle cx="12" cy="8" r="4" />
                <path d="M4 21c1.5-4 5-6 8-6s6.5 2 8 6" />
              </svg>
            )}
          </button>
          {menuOpen && user && (
            <div
              ref={menuRef}
              onClick={(e) => e.stopPropagation()}
              className="absolute top-[calc(100%+10px)] right-0 z-45 w-[220px] rounded-[14px] border border-[var(--line)] bg-white p-2 shadow-[0_18px_40px_-28px_rgba(20,32,28,.35)]"
            >
              <div className="mb-1.5 border-b border-[var(--line)] px-3 py-2.5">
                <strong className="block text-[0.95rem]">{user.username}</strong>
                <span className="text-[0.78rem] text-ink-mute">{user.role === 'admin' ? '管理员' : '普通用户'}</span>
              </div>
              <MenuBtn
                onClick={() => {
                  setMenuOpen(false)
                  showToast(`${user.username} · ${user.role === 'admin' ? '管理员' : '普通用户'}`)
                }}
              >
                账号信息
              </MenuBtn>
              <MenuBtn
                onClick={() => {
                  setMenuOpen(false)
                  navigate('/orders')
                }}
              >
                我的订单
              </MenuBtn>
              {user.role === 'admin' && (
                <MenuBtn
                  onClick={() => {
                    setMenuOpen(false)
                    navigate('/admin')
                  }}
                >
                  进入控制台
                </MenuBtn>
              )}
              <MenuBtn
                danger
                onClick={() => {
                  setMenuOpen(false)
                  logout()
                  showToast('已退出登录')
                  navigate('/')
                }}
              >
                退出登录
              </MenuBtn>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}

function MenuBtn({
  children,
  onClick,
  danger,
}: {
  children: React.ReactNode
  onClick: () => void
  danger?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 rounded-[10px] px-3 py-2.5 text-left text-[0.9rem] ${
        danger ? 'text-danger hover:bg-[rgba(180,35,24,.08)]' : 'text-ink-soft hover:bg-paper hover:text-ink'
      }`}
    >
      {children}
    </button>
  )
}
