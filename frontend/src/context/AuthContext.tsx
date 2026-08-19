import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { api, getToken, setToken, setUnauthorizedHandler } from '../lib/api'
import type { PublicSettings, User } from '../types'

interface AuthContextValue {
  user: User | null
  loading: boolean
  publicSettings: PublicSettings | null
  login: (token: string, user: User) => void
  logout: () => void
  refreshMe: () => Promise<void>
  refreshSettings: () => Promise<void>
  openAuth: (tab?: 'login' | 'register' | 'reset') => void
  closeAuth: () => void
  authOpen: boolean
  authTab: 'login' | 'register' | 'reset'
  setAuthTab: (t: 'login' | 'register' | 'reset') => void
  sessionExpired: boolean
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [publicSettings, setPublicSettings] = useState<PublicSettings | null>(null)
  const [authOpen, setAuthOpen] = useState(false)
  const [authTab, setAuthTab] = useState<'login' | 'register' | 'reset'>('login')
  const [sessionExpired, setSessionExpired] = useState(false)
  const userRef = useRef<User | null>(null)

  userRef.current = user

  const refreshSettings = useCallback(async () => {
    try {
      const s = await api.get<PublicSettings>('/api/settings/public')
      setPublicSettings(s)
      if (s.title) document.title = s.title
    } catch {
      /* ignore */
    }
  }, [])

  const refreshMe = useCallback(async () => {
    const token = getToken()
    if (!token) {
      setUser(null)
      setLoading(false)
      return
    }
    try {
      const me = await api.get<User>('/api/auth/me')
      setUser(me)
    } catch {
      setToken(null)
      setUser(null)
    } finally {
      setLoading(false)
    }
  }, [])

  // 任何请求返回 401 都统一登出，避免界面仍显示已登录
  useEffect(() => {
    setUnauthorizedHandler(() => {
      const hadSession = userRef.current !== null
      setUser(null)
      if (hadSession) {
        setSessionExpired(true)
        setAuthTab('login')
        setAuthOpen(true)
      }
    })
    return () => setUnauthorizedHandler(null)
  }, [])

  useEffect(() => {
    refreshMe()
    refreshSettings()
  }, [refreshMe, refreshSettings])

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      publicSettings,
      login: (token, u) => {
        setToken(token)
        setUser(u)
        setSessionExpired(false)
        // 调试模式等管理员可见配置需在登录后重新拉取
        refreshSettings()
      },
      logout: () => {
        setToken(null)
        setUser(null)
        setSessionExpired(false)
        refreshSettings()
      },
      refreshMe,
      refreshSettings,
      openAuth: (tab = 'login') => {
        setAuthTab(tab)
        setAuthOpen(true)
      },
      closeAuth: () => {
        setAuthOpen(false)
        setSessionExpired(false)
      },
      authOpen,
      authTab,
      setAuthTab,
      sessionExpired,
    }),
    [user, loading, publicSettings, refreshMe, refreshSettings, authOpen, authTab, sessionExpired],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
