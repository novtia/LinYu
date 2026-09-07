import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { ShoppingBag } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useCart } from '../context/CartContext'
import { useToast } from '../context/ToastContext'
import { CartDropdown } from './CartDropdown'

export function Topbar() {
  const { user, openAuth, logout, publicSettings } = useAuth()
  const { count, open: cartOpen, closeCart, toggleCart } = useCart()
  const { showToast } = useToast()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const cartRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const { pathname, hash } = useLocation()
  const brand = publicSettings?.name || '领匣'
  const shopOn = pathname === '/' && hash !== '#commission'
  const commissionOn = pathname === '/' && hash === '#commission'
  const ordersOn = pathname.startsWith('/orders')

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
    <header className="shop-top">
      <div className="shop-top-inner">
        <Link
          to="/"
          className="shop-brand"
          onClick={() => {
            if (pathname === '/') window.scrollTo({ top: 0, behavior: 'smooth' })
          }}
        >
          <span className="brand-mark" aria-hidden />
          {brand}
          <small>LINGXIA</small>
        </Link>
        <nav className="shop-nav">
          <Link to="/" className={shopOn ? 'active' : undefined}>
            商城
          </Link>
          <Link to={{ pathname: '/', hash: 'commission' }} className={commissionOn ? 'active' : undefined}>
            约稿
          </Link>
          <Link to="/orders" className={ordersOn ? 'active' : undefined}>
            我的订单
          </Link>
        </nav>
        <div className="shop-right">
          <Link
            to="/orders"
            className={`inline-flex h-9 shrink-0 items-center rounded-[10px] px-2 text-[0.82rem] font-semibold text-ink-soft min-[641px]:hidden ${
              ordersOn ? 'text-ink' : ''
            }`}
          >
            订单
          </Link>
          <div className="relative" ref={cartRef}>
            <button
              type="button"
              aria-label="购物车"
              aria-expanded={cartOpen}
              aria-haspopup="dialog"
              className={`cart-btn ${cartOpen ? 'open' : ''}`}
              onClick={(e) => {
                e.stopPropagation()
                setMenuOpen(false)
                toggleCart()
              }}
            >
              <ShoppingBag className="h-[15px] w-[15px]" strokeWidth={1.8} />
              {count > 0 ? <span className="dot-n">{count > 99 ? '99+' : count}</span> : null}
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
              className={`grid h-[34px] w-[34px] shrink-0 place-items-center rounded-full text-[0.8rem] font-bold transition hover:-translate-y-px ${
                user ? 'bg-ink text-white' : 'bg-paper-2 text-ink-soft'
              }`}
            >
              {user ? (
                user.username.slice(0, 1).toUpperCase()
              ) : (
                <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current stroke-[1.8]">
                  <circle cx="12" cy="8" r="4" />
                  <path d="M4 21c1.5-4 5-6 8-6s6.5 2 8 6" />
                </svg>
              )}
            </button>
            {menuOpen && user && (
              <div
                onClick={(e) => e.stopPropagation()}
                className="absolute top-[calc(100%+10px)] right-0 z-45 w-[min(220px,calc(100vw-24px))] rounded-[14px] border border-[var(--line)] bg-white p-2 shadow-[0_18px_40px_-28px_rgba(20,32,28,.35)] md:left-1/2 md:right-auto md:-translate-x-1/2"
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
                <MenuBtn
                  onClick={() => {
                    setMenuOpen(false)
                    navigate('/commissions')
                  }}
                >
                  我的约稿
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
