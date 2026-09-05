import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useCart } from '../context/CartContext'
import { useToast } from '../context/ToastContext'
import { CartDropdown } from './CartDropdown'

export function Topbar() {
  const { user, openAuth, logout } = useAuth()
  const { items, open: cartOpen, closeCart, toggleCart } = useCart()
  const { showToast } = useToast()
  const [menuOpen, setMenuOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const cartRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const target = e.target as Node
      if (menuRef.current && !menuRef.current.contains(target)) setMenuOpen(false)
      if (cartRef.current && !cartRef.current.contains(target)) closeCart()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setMenuOpen(false)
        closeCart()
      }
    }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [closeCart])

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
        <div className="relative flex items-center gap-2.5">
          <Link
            to="/orders"
            className="inline-flex h-10 items-center rounded-xl px-3.5 text-[0.88rem] font-semibold text-ink-soft transition hover:-translate-y-px hover:bg-paper hover:text-ink"
          >
            我的订单
          </Link>
          <div className="relative" ref={cartRef}>
            <button
              type="button"
              aria-expanded={cartOpen}
              aria-haspopup="dialog"
              onClick={(e) => {
                e.stopPropagation()
                setMenuOpen(false)
                toggleCart()
              }}
              className={`inline-flex h-10 items-center gap-2 rounded-xl px-3.5 text-[0.88rem] font-semibold text-white transition hover:-translate-y-px hover:bg-teal-deep ${
                cartOpen ? 'bg-teal-deep' : 'bg-ink'
              }`}
            >
              购物车
              <span className="inline-grid min-w-5 place-items-center rounded-md bg-mint px-1.5 text-[0.75rem] font-bold text-ink">
                {items.length}
              </span>
            </button>
            <CartDropdown />
          </div>

          <div className="relative" ref={menuRef}>
            <button
              type="button"
              aria-label="用户菜单"
              aria-expanded={menuOpen}
              onClick={(e) => {
                e.stopPropagation()
                closeCart()
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
                onClick={(e) => e.stopPropagation()}
                className="absolute top-[calc(100%+10px)] left-1/2 z-45 w-[220px] -translate-x-1/2 rounded-[14px] border border-[var(--line)] bg-white p-2 shadow-[0_18px_40px_-28px_rgba(20,32,28,.35)]"
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
