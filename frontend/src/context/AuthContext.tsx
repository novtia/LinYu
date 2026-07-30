import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, getToken, setToken } from '../lib/api'
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
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [publicSettings, setPublicSettings] = useState<PublicSettings | null>(null)
  const [authOpen, setAuthOpen] = useState(false)
  const [authTab, setAuthTab] = useState<'login' | 'register' | 'reset'>('login')

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
      },
      logout: () => {
        setToken(null)
        setUser(null)
      },
      refreshMe,
      refreshSettings,
      openAuth: (tab = 'login') => {
        setAuthTab(tab)
        setAuthOpen(true)
      },
      closeAuth: () => setAuthOpen(false),
      authOpen,
      authTab,
      setAuthTab,
    }),
    [user, loading, publicSettings, refreshMe, refreshSettings, authOpen, authTab],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
