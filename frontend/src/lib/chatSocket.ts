import { getToken, notifyUnauthorized } from './api'
import type { ChatSocketEvent, CommissionMessage, CommissionThread } from '../types'

type EventHandler = (event: ChatSocketEvent) => void
type StatusHandler = (connected: boolean) => void

const eventHandlers = new Set<EventHandler>()
const statusHandlers = new Set<StatusHandler>()

let socket: WebSocket | null = null
let connected = false
let shouldRun = false
let reconnectTimer = 0
let attempt = 0

export function isChatSocketConnected() {
  return connected
}

export function subscribeChatEvent(handler: EventHandler) {
  eventHandlers.add(handler)
  return () => {
    eventHandlers.delete(handler)
  }
}

export function subscribeChatStatus(handler: StatusHandler) {
  statusHandlers.add(handler)
  handler(connected)
  return () => {
    statusHandlers.delete(handler)
  }
}

export function startChatSocket() {
  shouldRun = true
  if (!socket) connect()
}

export function stopChatSocket() {
  shouldRun = false
  window.clearTimeout(reconnectTimer)
  reconnectTimer = 0
  attempt = 0
  closeSocket()
}

export function eventThread(event: ChatSocketEvent): CommissionThread | null {
  return event.thread || null
}

export function eventMessages(event: ChatSocketEvent, viewer: 'user' | 'admin'): CommissionMessage[] {
  if (event.type === 'message') {
    return [viewer === 'admin' ? event.message_admin : event.message_user]
  }
  if (event.type === 'recall') {
    return viewer === 'admin' ? event.messages_admin : event.messages_user
  }
  return []
}

export function upsertThread(prev: CommissionThread[], thread: CommissionThread): CommissionThread[] {
  const next = prev.some((t) => t.id === thread.id)
    ? prev.map((t) => (t.id === thread.id ? { ...t, ...thread } : t))
    : [thread, ...prev]
  return next.sort((a, b) => (b.updated_at > a.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : 0))
}

function setConnected(next: boolean) {
  if (connected === next) return
  connected = next
  statusHandlers.forEach((fn) => fn(next))
}

function closeSocket() {
  const current = socket
  socket = null
  setConnected(false)
  if (!current) return
  current.onopen = null
  current.onclose = null
  current.onmessage = null
  current.onerror = null
  try {
    current.close()
  } catch {
    /* ignore */
  }
}

function connect() {
  if (!shouldRun || socket) return
  const token = getToken()
  if (!token) return
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const next = new WebSocket(`${proto}//${window.location.host}/api/ws`)
  socket = next
  next.onopen = () => {
    const live = getToken()
    if (!live) {
      stopChatSocket()
      return
    }
    next.send(JSON.stringify({ type: 'auth', token: live }))
  }
  next.onmessage = (ev) => {
    let data: { type?: string }
    try {
      data = JSON.parse(String(ev.data || ''))
    } catch {
      return
    }
    if (data.type === 'ping') {
      next.send(JSON.stringify({ type: 'pong' }))
      return
    }
    if (data.type === 'pong') return
    if (data.type === 'ready') {
      attempt = 0
      setConnected(true)
      return
    }
    if (data.type === 'error') return
    if (data.type === 'message' || data.type === 'recall' || data.type === 'read') {
      eventHandlers.forEach((fn) => fn(data as ChatSocketEvent))
    }
  }
  next.onclose = (ev) => {
    if (socket !== next) return
    socket = null
    setConnected(false)
    if (ev.code === 4401) {
      shouldRun = false
      notifyUnauthorized()
      return
    }
    scheduleReconnect()
  }
  next.onerror = () => {
    /* onclose handles retry */
  }
}

function scheduleReconnect() {
  if (!shouldRun || reconnectTimer) return
  attempt += 1
  const delay = Math.min(15000, 1000 * 2 ** Math.min(attempt - 1, 4))
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = 0
    connect()
  }, delay)
}
