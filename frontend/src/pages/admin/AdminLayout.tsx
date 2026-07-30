import { useEffect, useRef, useState, type ComponentType } from 'react'
import { Link, Navigate, Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom'
import {
  ChevronRight,
  ClipboardList,
  CreditCard,
  FolderTree,
  Globe,
  LayoutDashboard,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  Send,
  Settings2,
  ShoppingBag,
  Users,
  type LucideProps,
} from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'

type IconComp = ComponentType<LucideProps>

type NavItem = {
  to: string
  end?: boolean
  label: string
  short: string
  icon: IconComp
}

type NavGroup = {
  id: string
  title: string
  icon: IconComp
  items: NavItem[]
}

const NAV_GROUPS: NavGroup[] = [
  {
    id: 'workspace',
    title: '工作台',
    icon: LayoutDashboard,
    items: [{ to: '/admin', end: true, label: '概览', short: '概览', icon: LayoutDashboard }],
  },
  {
    id: 'ops',
    title: '运营管理',
    icon: Package,
    items: [
      { to: '/admin/products', label: '商品管理', short: '商品', icon: Package },
      { to: '/admin/categories', label: '分类管理', short: '分类', icon: FolderTree },
      { to: '/admin/users', label: '用户管理', short: '用户', icon: Users },
    ],
  },
  {
    id: 'trade',
    title: '交易履约',
    icon: ShoppingBag,
    items: [
      { to: '/admin/orders', label: '订单管理', short: '订单', icon: ClipboardList },
      { to: '/admin/deliveries', label: '发放记录', short: '发放', icon: Send },
    ],
  },
  {
    id: 'settings',
    title: '站点配置',
    icon: Settings2,
    items: [
      { to: '/admin/payment', label: '支付接入', short: '支付', icon: CreditCard },
      { to: '/admin/system', label: '系统设置', short: '系统', icon: Settings2 },
      { to: '/admin/website', label: '网站设置', short: '网站', icon: Globe },
    ],
  },
]

const TITLES: Record<string, string> = {
  '/admin': '概览',
  '/admin/products': '商品管理',
  '/admin/products/new': '新增商品',
  '/admin/categories': '分类管理',
  '/admin/users': '用户管理',
  '/admin/orders': '订单管理',
  '/admin/deliveries': '发放记录',
  '/admin/payment': '支付接入',
  '/admin/payment/new': '添加渠道',
  '/admin/system': '系统设置',
  '/admin/website': '网站设置',
}

const SIDEBAR_KEY = 'lingxia-admin-sidebar-collapsed'

function isItemActive(path: string, item: NavItem) {
  if (item.end) return path === item.to
  if (item.to === '/admin/products') {
    return path === item.to || path.startsWith('/admin/products/')
  }
  if (item.to === '/admin/payment') {
    return path === item.to || path.startsWith('/admin/payment/')
  }
  return path === item.to || path.startsWith(item.to + '/')
}

function isGroupActive(path: string, group: NavGroup) {
  return group.items.some((item) => isItemActive(path, item))
}

function activeGroupId(path: string) {
  return NAV_GROUPS.find((g) => isGroupActive(path, g))?.id
}

function pageTitle(path: string) {
  if (TITLES[path]) return TITLES[path]
  if (path.startsWith('/admin/payment/') && path !== '/admin/payment/new') return '编辑渠道'
  if (path.includes('/edit')) return '编辑商品'
  return '控制台'
}

function breadcrumbCrumbs(path: string) {
  const group = NAV_GROUPS.find((g) => isGroupActive(path, g))
  const title = pageTitle(path)
  const crumbs: { label: string; to?: string }[] = [{ label: '控制台', to: '/admin' }]
  if (group && group.id !== 'workspace') {
    crumbs.push({ label: group.title, to: group.items[0]?.to })
  }
  if (path.startsWith('/admin/payment/') && path !== '/admin/payment') {
    crumbs.push({ label: '支付接入', to: '/admin/payment' })
    crumbs.push({ label: title })
    return crumbs
  }
  if (!(group?.id === 'workspace' && path === '/admin')) {
    crumbs.push({ label: title })
  }
  return crumbs
}

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === '1'
  } catch {
    return false
  }
}

export function AdminLayout() {
  const { user, loading, logout } = useAuth()
  const { showToast } = useToast()
  const navigate = useNavigate()
  const { pathname: path } = useLocation()
  const currentGroupId = activeGroupId(path)

  const [collapsed, setCollapsed] = useState(readCollapsed)
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {}
    for (const g of NAV_GROUPS) initial[g.id] = true
    return initial
  })
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const crumbs = breadcrumbCrumbs(path)

  useEffect(() => {
    if (!currentGroupId) return
    setOpenGroups((prev) => (prev[currentGroupId] ? prev : { ...prev, [currentGroupId]: true }))
  }, [currentGroupId])

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_KEY, collapsed ? '1' : '0')
    } catch {
      /* ignore */
    }
  }, [collapsed])

  useEffect(() => {
    if (!menuOpen) return
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  function toggleGroup(id: string) {
    setOpenGroups((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  if (loading) return <div className="grid min-h-screen place-items-center text-ink-mute">加载中…</div>
  if (!user || user.role !== 'admin') return <Navigate to="/" replace />

  return (
    <div className="fixed inset-0 z-[90] overflow-hidden bg-fog">
      <div
        className={`grid h-full min-h-0 transition-[grid-template-columns] duration-300 ease-out md:grid-cols-[var(--admin-sidebar)_1fr]`}
        style={{ ['--admin-sidebar' as string]: collapsed ? '76px' : '248px' }}
      >
        <aside className="hidden min-h-0 flex-col bg-ink text-[#eef8f4] md:flex">
          <div
            className={`flex shrink-0 items-center border-b border-white/12 ${
              collapsed ? 'justify-center px-2 py-4' : 'gap-2.5 px-4 py-4'
            }`}
          >
            <span className="brand-mark !h-[26px] !w-[26px] shrink-0" />
            {!collapsed && (
              <span className="truncate font-[family-name:var(--font-display)] text-[1.15rem] font-extrabold tracking-tight">
                领匣控制台
              </span>
            )}
          </div>

          <nav
            className={`flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto py-3 ${collapsed ? 'px-2' : 'px-3'}`}
            aria-label="控制台导航"
          >
            {collapsed
              ? NAV_GROUPS.flatMap((group) =>
                  group.items.map((item) => {
                    const active = isItemActive(path, item)
                    const Icon = item.icon
                    return (
                      <NavLink
                        key={item.to}
                        to={item.to}
                        end={item.end}
                        title={item.label}
                        className={`group relative grid h-11 w-full place-items-center rounded-[12px] transition ${
                          active
                            ? 'bg-teal text-white shadow-[0_8px_18px_-14px_rgba(15,110,92,.9)]'
                            : 'text-[rgba(238,248,244,.68)] hover:bg-white/8 hover:text-white'
                        }`}
                      >
                        <Icon className="h-[18px] w-[18px]" strokeWidth={1.9} />
                        <span className="pointer-events-none absolute left-[calc(100%+10px)] z-50 hidden whitespace-nowrap rounded-lg bg-ink px-2.5 py-1.5 text-[0.78rem] font-medium text-white shadow-lg ring-1 ring-white/10 group-hover:block">
                          {item.label}
                        </span>
                      </NavLink>
                    )
                  }),
                )
              : NAV_GROUPS.map((group) => {
                  const open = !!openGroups[group.id]
                  const groupActive = isGroupActive(path, group)
                  const GroupIcon = group.icon
                  return (
                    <div
                      key={group.id}
                      className={`rounded-[12px] ${groupActive ? 'bg-white/[0.05]' : 'bg-white/[0.02]'}`}
                    >
                      <button
                        type="button"
                        aria-expanded={open}
                        onClick={() => toggleGroup(group.id)}
                        className={`flex w-full items-center gap-2.5 rounded-[12px] px-3 py-2.5 text-left transition ${
                          groupActive
                            ? 'text-white'
                            : 'text-[rgba(238,248,244,.78)] hover:bg-white/6 hover:text-white'
                        }`}
                      >
                        <GroupIcon className="h-4 w-4 shrink-0 opacity-80" strokeWidth={1.9} />
                        <span className="min-w-0 flex-1 truncate text-[0.9rem] font-semibold tracking-wide">
                          {group.title}
                        </span>
                        <ChevronRight
                          className={`h-3.5 w-3.5 shrink-0 text-white/40 transition-transform duration-200 ${
                            open ? 'rotate-90' : ''
                          }`}
                          strokeWidth={2.2}
                        />
                      </button>

                      <div
                        className={`grid transition-[grid-template-rows] duration-200 ease-out ${
                          open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
                        }`}
                      >
                        <div className="overflow-hidden">
                          <div className="flex flex-col gap-0.5 px-1 pb-1.5">
                            {group.items.map((item) => {
                              const active = isItemActive(path, item)
                              const Icon = item.icon
                              return (
                                <NavLink
                                  key={item.to}
                                  to={item.to}
                                  end={item.end}
                                  className={`flex items-center gap-2.5 rounded-[10px] px-3 py-2 text-left text-[0.88rem] transition ${
                                    active
                                      ? 'bg-teal font-semibold text-white shadow-[0_8px_18px_-14px_rgba(15,110,92,.9)]'
                                      : 'text-[rgba(238,248,244,.68)] hover:bg-white/8 hover:text-white'
                                  }`}
                                >
                                  <Icon className="h-4 w-4 shrink-0" strokeWidth={1.9} />
                                  <span className="truncate">{item.label}</span>
                                </NavLink>
                              )
                            })}
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
          </nav>

          <div className={`shrink-0 border-t border-white/12 py-3 ${collapsed ? 'px-2' : 'px-3'}`}>
            <button
              type="button"
              onClick={() => setCollapsed((v) => !v)}
              title={collapsed ? '展开侧边栏' : '收起侧边栏'}
              aria-label={collapsed ? '展开侧边栏' : '收起侧边栏'}
              className={`flex h-11 w-full items-center rounded-[12px] text-[rgba(238,248,244,.72)] transition hover:bg-white/8 hover:text-white ${
                collapsed ? 'justify-center' : 'gap-2.5 px-3'
              }`}
            >
              {collapsed ? (
                <PanelLeftOpen className="h-[18px] w-[18px]" strokeWidth={1.9} />
              ) : (
                <>
                  <PanelLeftClose className="h-4 w-4 shrink-0" strokeWidth={1.9} />
                  <span className="text-[0.88rem] font-medium">收起侧边栏</span>
                </>
              )}
            </button>
          </div>
        </aside>

        <div className="flex min-h-0 min-w-0 flex-col">
          <div className="flex shrink-0 items-center justify-between gap-4 border-b border-[var(--line)] bg-white/70 px-4 py-3 backdrop-blur md:px-6">
            <nav aria-label="面包屑" className="min-w-0">
              <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[0.9rem]">
                {crumbs.map((crumb, i) => {
                  const last = i === crumbs.length - 1
                  return (
                    <li key={`${crumb.label}-${i}`} className="flex min-w-0 items-center gap-1.5">
                      {i > 0 && (
                        <span className="text-ink-mute/50 select-none" aria-hidden>
                          /
                        </span>
                      )}
                      {last || !crumb.to ? (
                        <span
                          className={`truncate ${
                            last
                              ? 'font-[family-name:var(--font-display)] font-bold tracking-tight text-ink'
                              : 'text-ink-mute'
                          }`}
                        >
                          {crumb.label}
                        </span>
                      ) : (
                        <Link to={crumb.to} className="truncate text-ink-mute transition hover:text-ink">
                          {crumb.label}
                        </Link>
                      )}
                    </li>
                  )
                })}
              </ol>
            </nav>

            <div className="relative shrink-0" ref={menuRef}>
              <button
                type="button"
                aria-label="用户菜单"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((v) => !v)}
                className="grid h-10 w-10 place-items-center rounded-full border-2 border-white bg-ink text-[0.95rem] font-bold text-white shadow-[0_8px_18px_-14px_rgba(20,32,28,.55)] transition hover:-translate-y-px hover:bg-teal-deep"
              >
                {user.username.slice(0, 1).toUpperCase()}
              </button>
              {menuOpen && (
                <div className="absolute top-[calc(100%+10px)] left-1/2 z-50 w-[220px] -translate-x-1/2 rounded-[14px] border border-[var(--line)] bg-white p-2 shadow-[0_18px_40px_-28px_rgba(20,32,28,.35)]">
                  <div className="mb-1.5 border-b border-[var(--line)] px-3 py-2.5">
                    <strong className="block text-[0.95rem]">{user.username}</strong>
                    <span className="text-[0.78rem] text-ink-mute">管理员</span>
                  </div>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2.5 rounded-[10px] px-3 py-2.5 text-left text-[0.9rem] text-ink-soft hover:bg-paper hover:text-ink"
                    onClick={() => {
                      setMenuOpen(false)
                      navigate('/')
                    }}
                  >
                    返回商城
                  </button>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2.5 rounded-[10px] px-3 py-2.5 text-left text-[0.9rem] text-danger hover:bg-[rgba(180,35,24,.08)]"
                    onClick={() => {
                      setMenuOpen(false)
                      logout()
                      showToast('已退出登录')
                      navigate('/')
                    }}
                  >
                    退出登录
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="flex shrink-0 gap-2 overflow-x-auto border-b border-[var(--line)] bg-white px-3 py-2.5 md:hidden">
            {NAV_GROUPS.map((group) => (
              <div key={group.id} className="flex shrink-0 items-center gap-1 rounded-xl bg-paper p-1">
                <span className="px-1.5 text-[0.68rem] font-semibold text-ink-mute">{group.title}</span>
                {group.items.map((item) => {
                  const active = isItemActive(path, item)
                  const Icon = item.icon
                  return (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.end}
                      className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[0.78rem] font-medium ${
                        active ? 'bg-ink text-white' : 'text-ink-soft'
                      }`}
                    >
                      <Icon className="h-3.5 w-3.5" strokeWidth={1.9} />
                      {item.short}
                    </NavLink>
                  )
                })}
              </div>
            ))}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 md:p-6">
            <Outlet />
          </div>
        </div>
      </div>
    </div>
  )
}
