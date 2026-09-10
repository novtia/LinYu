import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api } from '../lib/api'
import {
  eventThread,
  isChatSocketConnected,
  startChatSocket,
  stopChatSocket,
  subscribeChatEvent,
  subscribeChatStatus,
} from '../lib/chatSocket'
import type { ChatSocketEvent, CommissionThreadList } from '../types'
import { useAuth } from './AuthContext'

type ChatSocketContextValue = {
  connected: boolean
  unreadUser: number
  unreadAdmin: number
  subscribe: (handler: (event: ChatSocketEvent) => void) => () => void
}

const ChatSocketContext = createContext<ChatSocketContextValue | null>(null)

function sumMap(map: Map<string, number>) {
  let total = 0
  map.forEach((n) => {
    total += n
  })
  return total
}

export function ChatSocketProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [connected, setConnected] = useState(isChatSocketConnected)
  const [unreadUser, setUnreadUser] = useState(0)
  const [unreadAdmin, setUnreadAdmin] = useState(0)
  const userUnread = useRef(new Map<string, number>())
  const adminUnread = useRef(new Map<string, number>())

  function recount() {
    setUnreadUser(sumMap(userUnread.current))
    setUnreadAdmin(sumMap(adminUnread.current))
  }

  useEffect(() => {
    if (!user) {
      stopChatSocket()
      userUnread.current = new Map()
      adminUnread.current = new Map()
      setUnreadUser(0)
      setUnreadAdmin(0)
      setConnected(false)
      return
    }
    stopChatSocket()
    startChatSocket()
    const offStatus = subscribeChatStatus(setConnected)
    const offEvent = subscribeChatEvent((event) => {
      const thread = eventThread(event)
      if (!thread) return
      userUnread.current.set(thread.id, thread.unread_user || 0)
      adminUnread.current.set(thread.id, thread.unread_admin || 0)
      recount()
    })
    let alive = true
    api
      .get<CommissionThreadList>('/api/commission/threads/mine')
      .then((res) => {
        if (!alive) return
        userUnread.current = new Map(res.items.map((t) => [t.id, t.unread_user || 0]))
        recount()
      })
      .catch(() => {})
    if (user.role === 'admin') {
      api
        .get<CommissionThreadList>('/api/commission/threads?filter=unread&limit=100')
        .then((res) => {
          if (!alive) return
          adminUnread.current = new Map(res.items.map((t) => [t.id, t.unread_admin || 0]))
          recount()
        })
        .catch(() => {})
    }
    return () => {
      alive = false
      offStatus()
      offEvent()
    }
  }, [user?.id, user?.role])

  const value = useMemo<ChatSocketContextValue>(
    () => ({
      connected,
      unreadUser,
      unreadAdmin,
      subscribe: subscribeChatEvent,
    }),
    [connected, unreadUser, unreadAdmin],
  )

  return <ChatSocketContext.Provider value={value}>{children}</ChatSocketContext.Provider>
}

export function useChatSocket() {
  const ctx = useContext(ChatSocketContext)
  if (!ctx) throw new Error('useChatSocket must be used within ChatSocketProvider')
  return ctx
}
