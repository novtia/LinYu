import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { FileText, Image as ImageIcon, Paperclip, Smile } from 'lucide-react'
import { ApiError, api } from '../lib/api'
import { formatFileSize, formatYuan } from '../lib/commission'
import { useToast } from '../context/ToastContext'
import { PaymentMethodPicker } from './PaymentMethodPicker'
import type { CheckoutResult, CommissionMessage, CommissionMessagesResult, PublicPaymentMethod } from '../types'

const EMOJIS = ['😀', '😁', '😂', '🥰', '😍', '😘', '🤔', '😅', '😭', '😡', '👍', '👎', '👏', '🙏', '🔥', '✨', '❤️', '🤍', '🌸', '⭐', '🎉', '📌', '✅', '💪', '☕', '🌙', '🎵', '📎']
const RECALL_MS = 10 * 60 * 1000
const FAST_POLL = 3000
const SLOW_POLL = 12000

type PendingFile = { id: string; file: File; preview?: string }

type Props = {
  threadId: string | null
  viewer: 'user' | 'admin'
  active: boolean
  header?: ReactNode
  peerAvatar?: string
  mineAvatar?: string
  placeholder?: string
  className?: string
  orderId?: string | null
  orderStatus?: string | null
  balanceAmount?: number | null
  onUnread?: (unread: number, threadId: string) => void
  onOrderChange?: (status: string) => void
}

function chatPath(path: string, viewer: 'user' | 'admin', extra?: Record<string, string | number>) {
  const params = new URLSearchParams()
  params.set('viewer', viewer)
  if (extra) {
    for (const [k, v] of Object.entries(extra)) params.set(k, String(v))
  }
  return `${path}?${params}`
}

function isMine(msg: CommissionMessage, viewer: 'user' | 'admin') {
  return viewer === 'admin' ? msg.role === 'admin' : msg.role === 'user'
}

function parseUtc(iso: string) {
  if (!iso) return new Date(NaN)
  return /[zZ]|[+-]\d{2}:?\d{2}$/.test(iso) ? new Date(iso) : new Date(`${iso}Z`)
}

function fmtTime(iso: string) {
  const d = parseUtc(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function fmtDay(iso: string) {
  return parseUtc(iso).toLocaleDateString('zh-CN')
}

function recallLeft(iso: string, now: number) {
  const left = RECALL_MS - (now - parseUtc(iso).getTime())
  if (left <= 0) return ''
  const m = Math.floor(left / 60000)
  const s = Math.floor((left % 60000) / 1000)
  return `${m}:${String(s).padStart(2, '0')}`
}

function isFollow(curr: CommissionMessage, prev?: CommissionMessage) {
  if (!prev || prev.type === 'system' || curr.type === 'system' || prev.type === 'delivery' || curr.type === 'delivery') return false
  if (prev.recalled_at || curr.recalled_at) return false
  if (prev.role !== curr.role) return false
  return parseUtc(curr.created_at).getTime() - parseUtc(prev.created_at).getTime() < 5 * 60 * 1000
}

function parseDelivery(body: string) {
  try {
    const data = JSON.parse(body) as { order_id?: string; file_count?: number; balance_amount?: number }
    return data && typeof data === 'object' ? data : {}
  } catch {
    return {}
  }
}

function DeliveryCard({
  viewer,
  unlocked,
  latest,
  orderId,
  balanceAmount,
  onUnlocked,
}: {
  viewer: 'user' | 'admin'
  unlocked: boolean
  latest: boolean
  orderId: string
  balanceAmount: number
  onUnlocked: () => void
}) {
  const { showToast } = useToast()
  const [method, setMethod] = useState<PublicPaymentMethod | null>(null)
  const [paying, setPaying] = useState(false)

  if (unlocked) {
    return (
      <div className="flex justify-center py-1">
        <Link
          to={`/orders/${encodeURIComponent(orderId)}`}
          className="bg-teal px-3 py-1 text-[0.82rem] font-extrabold text-white"
        >
          解锁
        </Link>
      </div>
    )
  }

  if (viewer === 'admin' || !latest) {
    return (
      <div className="mx-auto w-full max-w-[22rem] border border-[var(--line)] bg-fog px-4 py-3 text-center">
        <div className="text-[0.88rem] font-bold">稿件已发货</div>
        <p className="mt-1 text-[0.76rem] text-ink-mute">买家支付尾款后解锁</p>
      </div>
    )
  }

  async function pay() {
    if (!method) {
      showToast('请选择支付方式')
      return
    }
    setPaying(true)
    try {
      const res = await api.post<CheckoutResult>(`/api/orders/${encodeURIComponent(orderId)}/pay-balance`, {
        payment_method_id: method.id,
      })
      if (res.pay_url) {
        window.location.href = res.pay_url
        return
      }
      if (res.order.status === 'completed') {
        onUnlocked()
        showToast('尾款已支付，稿件已解锁')
      }
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : '发起尾款支付失败')
    } finally {
      setPaying(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-[22rem] border border-[var(--line)] bg-fog px-4 py-3">
      <div className="text-[0.88rem] font-bold">稿件已就绪</div>
      <p className="mb-3 mt-1 text-[0.76rem] text-ink-mute">支付尾款 {formatYuan(balanceAmount)} 后解锁</p>
      <PaymentMethodPicker className="mb-3" value={method?.id || null} onChange={setMethod} />
      <button
        type="button"
        disabled={paying}
        className="h-10 w-full bg-teal text-[0.88rem] font-bold text-white hover:bg-teal-deep disabled:opacity-60"
        onClick={pay}
      >
        {paying ? '跳转支付中…' : `支付尾款 ${formatYuan(balanceAmount)}`}
      </button>
    </div>
  )
}

function mergeMessages(prev: CommissionMessage[], incoming: CommissionMessage[]) {
  const map = new Map(prev.map((m) => [m.id, m]))
  for (const m of incoming) map.set(m.id, m)
  return [...map.values()].sort((a, b) => a.id - b.id)
}

function AuthImage({ src, alt, className, onClick }: { src: string; alt: string; className?: string; onClick?: () => void }) {
  const [url, setUrl] = useState('')
  useEffect(() => {
    let alive = true
    let objectUrl = ''
    api
      .blobUrl(src)
      .then((u) => {
        if (!alive) {
          URL.revokeObjectURL(u)
          return
        }
        objectUrl = u
        setUrl(u)
      })
      .catch(() => {})
    return () => {
      alive = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [src])
  if (!url) return <div className={`bg-transparent ${className || ''}`} />
  return <img src={url} alt={alt} className={className} onClick={onClick} />
}

export function CommissionChat({
  threadId,
  viewer,
  active,
  header,
  peerAvatar = '匣',
  mineAvatar = '我',
  placeholder,
  className = '',
  orderId,
  orderStatus,
  balanceAmount,
  onUnread,
  onOrderChange,
}: Props) {
  const { showToast } = useToast()
  const [messages, setMessages] = useState<CommissionMessage[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [text, setText] = useState('')
  const [pending, setPending] = useState<PendingFile[]>([])
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [sending, setSending] = useState(false)
  const [shipping, setShipping] = useState(false)
  const [dragover, setDragover] = useState(false)
  const [now, setNow] = useState(Date.now())
  const [lightbox, setLightbox] = useState<string | null>(null)
  const [localStatus, setLocalStatus] = useState(orderStatus || '')
  const [visible, setVisible] = useState(typeof document === 'undefined' ? true : document.visibilityState === 'visible')
  const listRef = useRef<HTMLDivElement>(null)
  const areaRef = useRef<HTMLTextAreaElement>(null)
  const imageRef = useRef<HTMLInputElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const shipRef = useRef<HTMLInputElement>(null)
  const onOrderChangeRef = useRef(onOrderChange)
  onOrderChangeRef.current = onOrderChange
  const emptyStreak = useRef(0)
  const lastId = useRef(0)
  const readyRef = useRef(false)
  const loadingOlder = useRef(false)
  const onUnreadRef = useRef(onUnread)
  const activeRef = useRef(active)
  onUnreadRef.current = onUnread
  activeRef.current = active

  function focused() {
    return activeRef.current && document.visibilityState === 'visible'
  }

  useEffect(() => {
    setLocalStatus(orderStatus || '')
  }, [orderStatus, threadId])

  useEffect(() => {
    const onVis = () => setVisible(document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [])

  const scrollBottom = useCallback((force = false) => {
    const el = listRef.current
    if (!el) return
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 48
    if (force || near) el.scrollTop = el.scrollHeight
  }, [])

  useEffect(() => {
    setMessages([])
    setHasMore(false)
    lastId.current = 0
    emptyStreak.current = 0
    readyRef.current = false
    if (!threadId) return
    let alive = true
    api
      .get<CommissionMessagesResult>(
        chatPath(`/api/commission/threads/${threadId}/messages`, viewer, { mark_read: focused() ? 1 : 0 }),
      )
      .then((res) => {
        if (!alive) return
        setMessages(res.messages)
        setHasMore(res.has_more)
        lastId.current = res.messages.at(-1)?.id || 0
        readyRef.current = true
        onUnreadRef.current?.(res.unread, threadId)
        requestAnimationFrame(() => scrollBottom(true))
      })
      .catch(() => {
        if (alive) {
          setMessages([])
          readyRef.current = true
        }
      })
    return () => {
      alive = false
    }
  }, [threadId, viewer, scrollBottom])

  useEffect(() => {
    if (!threadId) return
    let timer = 0
    let stopped = false

    const tick = async () => {
      if (stopped) return
      if (document.visibilityState === 'visible' && readyRef.current) {
        try {
          const extra: Record<string, string | number> = { mark_read: focused() ? 1 : 0 }
          if (lastId.current) extra.after_id = lastId.current
          const res = await api.get<CommissionMessagesResult>(
            chatPath(`/api/commission/threads/${threadId}/messages`, viewer, extra),
          )
          if (stopped) return
          onUnreadRef.current?.(res.unread, threadId)
          if (res.messages.length) {
            emptyStreak.current = 0
            setMessages((prev) => {
              const next = mergeMessages(prev, res.messages)
              lastId.current = next.at(-1)?.id || lastId.current
              return next
            })
            requestAnimationFrame(() => scrollBottom())
          } else {
            emptyStreak.current += 1
          }
        } catch {
          emptyStreak.current += 1
        }
      }
      if (!stopped) timer = window.setTimeout(tick, emptyStreak.current >= 2 ? SLOW_POLL : FAST_POLL)
    }

    timer = window.setTimeout(tick, 800)
    const onVis = () => {
      if (document.visibilityState !== 'visible' || stopped) return
      window.clearTimeout(timer)
      void tick()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      stopped = true
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [threadId, viewer, scrollBottom])

  useEffect(() => {
    if (!threadId || !active || !visible || !readyRef.current) return
    api
      .get<CommissionMessagesResult>(
        chatPath(`/api/commission/threads/${threadId}/messages`, viewer, {
          mark_read: 1,
          ...(lastId.current ? { after_id: lastId.current } : {}),
        }),
      )
      .then((res) => {
        onUnreadRef.current?.(res.unread, threadId)
        if (!res.messages.length) return
        setMessages((prev) => {
          const next = mergeMessages(prev, res.messages)
          lastId.current = next.at(-1)?.id || lastId.current
          return next
        })
        requestAnimationFrame(() => scrollBottom())
      })
      .catch(() => {})
  }, [active, visible, threadId, viewer, scrollBottom])

  async function loadOlder() {
    if (!threadId || !hasMore || loadingOlder.current || !messages.length) return
    loadingOlder.current = true
    const el = listRef.current
    const before = el ? el.scrollHeight - el.scrollTop : 0
    try {
      const res = await api.get<CommissionMessagesResult>(
        chatPath(`/api/commission/threads/${threadId}/messages`, viewer, {
          before_id: messages[0].id,
          mark_read: focused() ? 1 : 0,
        }),
      )
      setMessages((prev) => mergeMessages(res.messages, prev))
      setHasMore(res.has_more)
      requestAnimationFrame(() => {
        if (el) el.scrollTop = el.scrollHeight - before
      })
    } catch {
      /* ignore */
    } finally {
      loadingOlder.current = false
    }
  }

  function growArea() {
    const el = areaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(120, Math.max(40, el.scrollHeight))}px`
  }

  function addFiles(files: FileList | File[]) {
    const next: PendingFile[] = []
    for (const file of Array.from(files)) {
      const item: PendingFile = { id: `${file.name}-${file.size}-${Math.random()}`, file }
      if (file.type.startsWith('image/')) item.preview = URL.createObjectURL(file)
      next.push(item)
    }
    if (next.length) setPending((prev) => [...prev, ...next])
  }

  function dropPending(id: string) {
    setPending((prev) => {
      const hit = prev.find((p) => p.id === id)
      if (hit?.preview) URL.revokeObjectURL(hit.preview)
      return prev.filter((p) => p.id !== id)
    })
  }

  async function send() {
    if (!threadId || sending) return
    const body = text.trim()
    const files = pending
    if (!body && !files.length) return
    setSending(true)
    try {
      const created: CommissionMessage[] = []
      for (const item of files) {
        created.push(await api.upload<CommissionMessage>(chatPath(`/api/commission/threads/${threadId}/messages/upload`, viewer), item.file))
      }
      if (body) {
        const isEmoji = [...body].length <= 2 && /\p{Extended_Pictographic}/u.test(body)
        created.push(
          await api.post<CommissionMessage>(chatPath(`/api/commission/threads/${threadId}/messages`, viewer), {
            body,
            type: isEmoji ? 'emoji' : 'text',
          }),
        )
      }
      setMessages((prev) => {
        const next = mergeMessages(prev, created)
        lastId.current = next.at(-1)?.id || lastId.current
        return next
      })
      setText('')
      pending.forEach((p) => p.preview && URL.revokeObjectURL(p.preview))
      setPending([])
      setEmojiOpen(false)
      if (areaRef.current) {
        areaRef.current.style.height = '40px'
      }
      requestAnimationFrame(() => scrollBottom(true))
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : '发送失败')
    } finally {
      setSending(false)
    }
  }

  async function ship(files: FileList | File[]) {
    if (!threadId || shipping) return
    const list = Array.from(files)
    if (!list.length) return
    setShipping(true)
    try {
      const created = await api.uploadMany<CommissionMessage>(
        chatPath(`/api/commission/threads/${threadId}/deliver`, viewer),
        list,
      )
      setMessages((prev) => {
        const next = mergeMessages(prev, [created])
        lastId.current = next.at(-1)?.id || lastId.current
        return next
      })
      setLocalStatus('awaiting_balance')
      onOrderChangeRef.current?.('awaiting_balance')
      showToast('已发货，等待买家支付尾款')
      requestAnimationFrame(() => scrollBottom(true))
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : '发货失败')
    } finally {
      setShipping(false)
    }
  }

  async function recall(id: number) {
    try {
      const updated = await api.post<CommissionMessage>(chatPath(`/api/commission/messages/${id}/recall`, viewer))
      setMessages((prev) => prev.map((m) => (m.id === id ? updated : m)))
      showToast('已撤回')
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : '撤回失败')
    }
  }

  const daySeen = new Set<string>()

  return (
    <section
      className={`relative flex min-h-0 flex-col border border-[var(--line)] bg-white ${className} ${dragover ? 'after:absolute after:inset-2 after:z-10 after:grid after:place-items-center after:border after:border-dashed after:border-teal after:bg-[rgba(246,249,247,.94)] after:text-[0.9rem] after:font-bold after:text-teal after:content-["松开以加入图片或设定文件"]' : ''}`}
      onDragEnter={(e) => {
        e.preventDefault()
        setDragover(true)
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={(e) => {
        e.preventDefault()
        setDragover(false)
      }}
      onDrop={(e) => {
        e.preventDefault()
        setDragover(false)
        if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files)
      }}
    >
      {header}

      <div
        ref={listRef}
        className="flex min-h-0 min-w-0 flex-1 flex-col gap-2.5 overflow-x-hidden overflow-y-auto px-0.5 py-3.5"
        onScroll={(e) => {
          if (e.currentTarget.scrollTop < 40) loadOlder()
        }}
      >
        {!threadId ? (
          <p className="m-auto text-[0.86rem] text-ink-mute">登录后即可与作者沟通</p>
        ) : !messages.length ? (
          <p className="m-auto text-[0.86rem] text-ink-mute">还没有消息，先说说人设和尺度。</p>
        ) : (
          messages.map((msg, i) => {
            const day = fmtDay(msg.created_at)
            const stamp = daySeen.has(day) || msg.type === 'system' ? null : day
            daySeen.add(day)
            if (msg.type === 'system') {
              return (
                <div key={msg.id}>
                  {stamp ? <div className="mb-2 self-center text-center text-[0.72rem] text-ink-mute">{stamp}</div> : null}
                  <div className="self-center bg-fog px-2 py-0.5 text-center text-[0.72rem] text-ink-mute">{msg.body}</div>
                </div>
              )
            }
            if (msg.type === 'delivery') {
              const meta = parseDelivery(msg.body)
              const cardOrder = orderId || meta.order_id || ''
              const latestDeliveryId = [...messages].reverse().find((m) => m.type === 'delivery' && !m.recalled_at)?.id
              const unlocked = (localStatus || orderStatus) === 'completed'
              return (
                <div key={msg.id}>
                  {stamp ? <div className="mb-2 text-center text-[0.72rem] text-ink-mute">{stamp}</div> : null}
                  {msg.recalled_at ? (
                    <div className="text-center text-[0.8rem] text-ink-mute">已撤回发货</div>
                  ) : (
                    <DeliveryCard
                      viewer={viewer}
                      unlocked={unlocked}
                      latest={msg.id === latestDeliveryId}
                      orderId={cardOrder}
                      balanceAmount={Number(balanceAmount || meta.balance_amount || 0)}
                      onUnlocked={() => {
                        setLocalStatus('completed')
                        onOrderChangeRef.current?.('completed')
                      }}
                    />
                  )}
                </div>
              )
            }
            const mine = isMine(msg, viewer)
            const follow = isFollow(msg, messages[i - 1])
            const left = mine && !msg.recalled_at ? recallLeft(msg.created_at, now) : ''
            const showRecall = Boolean(left || (mine && !msg.recalled_at && msg.can_recall))
            return (
              <div key={msg.id} className="w-full min-w-0">
                {stamp ? <div className="mb-2 text-center text-[0.72rem] text-ink-mute">{stamp}</div> : null}
                <div className={`flex w-full min-w-0 ${mine ? 'justify-end' : 'justify-start'} ${follow ? '-mt-1' : ''}`}>
                  <div className={`flex min-w-0 max-w-[min(26rem,100%)] items-start gap-2 ${mine ? 'flex-row-reverse' : ''}`}>
                  <div
                    className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-[0.7rem] font-bold text-white ${mine ? 'bg-teal' : 'bg-ink'} ${follow ? 'invisible' : ''}`}
                  >
                    {mine ? mineAvatar : peerAvatar}
                  </div>
                  <div className="min-w-0 max-w-[calc(100%-2.25rem)]">
                    {!follow && (
                      <span className="mb-0.5 block text-[0.68rem] text-ink-mute">{mine ? '我' : viewer === 'admin' ? '买家' : '作者'}</span>
                    )}
                    {msg.recalled_at ? (
                      <div className="text-[0.8rem] text-ink-mute">{mine ? '你撤回了一条消息' : '对方撤回了一条消息'}</div>
                    ) : msg.type === 'image' && msg.file_url ? (
                      <button
                        type="button"
                        className="block w-full max-w-full border-0 bg-transparent p-0"
                        onClick={() => setLightbox(msg.file_url || null)}
                      >
                        <AuthImage
                          src={msg.file_url}
                          alt={msg.file_name || '图片'}
                          className="block h-auto max-h-[min(70vh,32rem)] w-auto max-w-full cursor-zoom-in object-contain"
                        />
                      </button>
                    ) : (
                      <div
                        className={`chat-bubble text-[0.88rem] leading-relaxed ${
                          msg.type === 'file' ? 'p-1.5' : 'px-2.5 py-2'
                        } ${mine ? 'bg-ink text-white' : 'bg-fog text-ink'}`}
                      >
                        {msg.type === 'file' ? (
                          <button
                            type="button"
                            className="flex w-[200px] items-center gap-2 text-left"
                            onClick={() => msg.file_url && api.download(msg.file_url, msg.file_name || undefined)}
                          >
                            <span className={`grid h-[30px] w-[30px] shrink-0 place-items-center ${mine ? 'bg-white/12 text-white' : 'bg-[rgba(15,110,92,.1)] text-teal'}`}>
                              <FileText className="h-4 w-4" />
                            </span>
                            <span className="min-w-0">
                              <b className="block truncate text-[0.78rem]">{msg.file_name || '文件'}</b>
                              <small className={mine ? 'text-white/65' : 'text-ink-mute'}>{formatFileSize(msg.file_size)}</small>
                            </span>
                          </button>
                        ) : msg.type === 'emoji' ? (
                          <span className="text-[1.8rem] leading-none">{msg.body}</span>
                        ) : (
                          msg.body
                        )}
                      </div>
                    )}
                    <div className={`mt-1 flex items-center gap-2 text-[0.68rem] text-ink-mute ${mine ? 'justify-end' : ''}`}>
                      <span>{fmtTime(msg.created_at)}</span>
                      {showRecall ? (
                        <button type="button" className={`font-bold ${mine ? 'text-[#8aa39a]' : 'text-teal'}`} onClick={() => recall(msg.id)}>
                          {left ? `撤回 ${left}` : '撤回'}
                        </button>
                      ) : null}
                    </div>
                  </div>
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>

      {emojiOpen && (
        <div className="absolute bottom-[108px] left-[18px] z-5 grid w-[276px] grid-cols-8 gap-0.5 border border-[var(--line)] bg-white p-2">
          {EMOJIS.map((e) => (
            <button
              key={e}
              type="button"
              className="h-[30px] text-[1.05rem] hover:bg-fog"
              onClick={() => {
                setText((prev) => prev + e)
                setEmojiOpen(false)
                areaRef.current?.focus()
              }}
            >
              {e}
            </button>
          ))}
        </div>
      )}

      <div className="mt-auto border-t border-[var(--line)] pt-2.5">
        <div className="border border-[var(--line)] bg-fog focus-within:border-ink focus-within:bg-white">
          {pending.length > 0 && (
            <div className="flex flex-wrap gap-2 px-2.5 pt-2">
              {pending.map((p) => (
                <div key={p.id} className="flex items-center gap-2 border border-[var(--line)] bg-white px-2 py-1 text-[0.76rem]">
                  {p.preview ? <img src={p.preview} alt="" className="h-7 w-7 object-cover" /> : null}
                  <span>{p.file.type.startsWith('image/') ? '图片' : p.file.name}</span>
                  <button type="button" className="font-bold text-danger" onClick={() => dropPending(p.id)}>
                    移除
                  </button>
                </div>
              ))}
            </div>
          )}
          <textarea
            ref={areaRef}
            rows={1}
            value={text}
            disabled={!threadId}
            placeholder={placeholder || (viewer === 'admin' ? '回复设定、大纲或样章…' : '写人设、尺度、禁触，或把设定文件拖进来…')}
            className="block max-h-[120px] min-h-10 w-full resize-none bg-transparent px-3 pt-2.5 leading-normal outline-none"
            onChange={(e) => {
              setText(e.target.value)
              growArea()
            }}
            onPaste={(e) => {
              const item = [...(e.clipboardData?.items || [])].find((x) => x.type.startsWith('image/'))
              const file = item?.getAsFile()
              if (file) {
                e.preventDefault()
                addFiles([file])
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send()
              }
            }}
          />
          <div className="flex items-center justify-between gap-2 px-1.5 pb-1.5 pt-1">
            <div className="flex gap-0.5">
              <button type="button" className="grid h-[30px] w-[30px] place-items-center text-ink-mute hover:text-teal" title="表情" onClick={() => setEmojiOpen((v) => !v)}>
                <Smile className="h-4 w-4" />
              </button>
              <button type="button" className="grid h-[30px] w-[30px] place-items-center text-ink-mute hover:text-teal" title="图片" onClick={() => imageRef.current?.click()}>
                <ImageIcon className="h-4 w-4" />
              </button>
              <button type="button" className="grid h-[30px] w-[30px] place-items-center text-ink-mute hover:text-teal" title="文件" onClick={() => fileRef.current?.click()}>
                <Paperclip className="h-4 w-4" />
              </button>
            </div>
            <div className="flex gap-1.5">
              {viewer === 'admin' && orderId && (localStatus === 'deposit_paid' || localStatus === 'awaiting_balance' || orderStatus === 'deposit_paid' || orderStatus === 'awaiting_balance') ? (
                <button
                  type="button"
                  disabled={!threadId || shipping}
                  className="h-[34px] border border-ink px-3 text-[0.88rem] font-bold text-ink hover:bg-ink hover:text-white disabled:opacity-60"
                  onClick={() => shipRef.current?.click()}
                >
                  {shipping ? '发货中…' : '发货'}
                </button>
              ) : null}
              <button
                type="button"
                disabled={!threadId || sending}
                className="h-[34px] bg-teal px-4 text-[0.88rem] font-bold text-white hover:bg-teal-deep disabled:opacity-60"
                onClick={send}
              >
                {sending ? '发送中…' : '发送'}
              </button>
            </div>
          </div>
        </div>
      </div>

      <input
        ref={imageRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          if (e.target.files) addFiles(e.target.files)
          e.target.value = ''
        }}
      />
      <input
        ref={fileRef}
        type="file"
        hidden
        onChange={(e) => {
          if (e.target.files) addFiles(e.target.files)
          e.target.value = ''
        }}
      />
      <input
        ref={shipRef}
        type="file"
        hidden
        multiple
        onChange={(e) => {
          if (e.target.files) ship(e.target.files)
          e.target.value = ''
        }}
      />

      {lightbox
        ? createPortal(
            <div
              className="fixed inset-0 z-[120] flex items-center justify-center bg-black"
              onClick={() => setLightbox(null)}
            >
              <AuthImage src={lightbox} alt="预览" className="max-h-full max-w-full object-contain" />
            </div>,
            document.body,
          )
        : null}
    </section>
  )
}
