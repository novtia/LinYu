import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ApiError, api } from '../../lib/api'
import { formatWords } from '../../lib/commission'
import { orderStatusLabel } from '../../lib/orderStatus'
import { useToast } from '../../context/ToastContext'
import { CommissionChat } from '../../components/CommissionChat'
import type { CommissionThread, CommissionThreadList } from '../../types'

type Filter = 'all' | 'unread' | 'deposit'

function fmtTime(iso?: string | null) {
  if (!iso) return ''
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function ConversationsPage() {
  const { showToast } = useToast()
  const [searchParams, setSearchParams] = useSearchParams()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [threads, setThreads] = useState<CommissionThread[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [visible, setVisible] = useState(typeof document === 'undefined' ? true : document.visibilityState === 'visible')

  useEffect(() => {
    const onVis = () => setVisible(document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  const loadList = useCallback(async () => {
    const params = new URLSearchParams()
    if (query.trim()) params.set('q', query.trim())
    if (filter !== 'all') params.set('filter', filter)
    params.set('limit', '50')
    const res = await api.get<CommissionThreadList>(`/api/commission/threads?${params}`)
    setThreads(res.items)
    return res.items
  }, [query, filter])

  useEffect(() => {
    let alive = true
    loadList()
      .then((items) => {
        if (!alive) return
        const user = searchParams.get('user')
        const product = searchParams.get('product')
        if (user && product) {
          const hit = items.find((t) => t.user_id === user && String(t.product_id) === product)
          if (hit) setActiveId(hit.id)
        }
      })
      .catch((e) => {
        if (alive) showToast(e instanceof ApiError ? e.message : '对话列表加载失败')
      })
    return () => {
      alive = false
    }
  }, [loadList, searchParams, showToast])

  useEffect(() => {
    if (!visible) return
    const timer = window.setInterval(() => {
      loadList().catch(() => {})
    }, 15000)
    return () => window.clearInterval(timer)
  }, [visible, loadList])

  const active = useMemo(() => threads.find((t) => t.id === activeId) || null, [threads, activeId])

  return (
    <div className="-m-4 flex min-h-[calc(100dvh-7.5rem)] overflow-hidden border border-[var(--line)] bg-white md:-m-6 md:min-h-[calc(100dvh-8.5rem)]">
      <section className="flex w-[300px] shrink-0 flex-col border-r border-[var(--line)]">
        <div className="px-[18px] pt-[18px] pb-2">
          <h3 className="mb-3 text-[0.95rem] font-bold">用户</h3>
          <input
            className="h-9 w-full border-0 border-b border-[var(--line)] bg-transparent outline-none"
            placeholder="搜索用户或篇名"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="flex gap-3 px-[18px] py-3">
          {(
            [
              ['all', '全部'],
              ['unread', '未读'],
              ['deposit', '已付定金'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={`bg-transparent text-[0.78rem] font-semibold ${filter === id ? 'text-ink' : 'text-ink-mute'}`}
              onClick={() => setFilter(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {threads.length === 0 ? (
            <p className="px-6 py-6 text-[0.86rem] text-ink-mute">没有匹配的对话</p>
          ) : (
            threads.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`grid w-full grid-cols-[36px_minmax(0,1fr)_auto] items-center gap-2.5 px-[18px] py-3 text-left hover:bg-fog ${t.id === activeId ? 'bg-fog' : ''}`}
                onClick={() => {
                  setActiveId(t.id)
                  setSearchParams({ user: t.user_id, product: String(t.product_id) }, { replace: true })
                }}
              >
                <div className="grid h-9 w-9 place-items-center rounded-full bg-ink text-[0.78rem] font-bold text-white">
                  {t.username.slice(0, 1)}
                </div>
                <div className="min-w-0">
                  <b className="block text-[0.88rem]">{t.username}</b>
                  <div className="truncate text-[0.74rem] text-ink-mute">{t.last_preview || t.product_name}</div>
                </div>
                <div className="text-right">
                  <div className="text-[0.7rem] text-ink-mute">{fmtTime(t.last_at)}</div>
                  {t.unread_admin > 0 ? (
                    <span className="mt-1 inline-grid min-w-4 place-items-center rounded-full bg-danger px-1.5 text-[0.66rem] font-extrabold text-white">
                      {t.unread_admin}
                    </span>
                  ) : (
                    <span className="text-[0.72rem] font-bold text-teal">{t.has_deposit ? '已付定金' : '沟通中'}</span>
                  )}
                </div>
              </button>
            ))
          )}
        </div>
      </section>

      <section className="flex min-w-0 min-h-0 flex-1 flex-col">
        {active ? (
          <CommissionChat
            threadId={active.id}
            viewer="admin"
            active={visible}
            mineAvatar="匣"
            peerAvatar={active.username.slice(0, 1)}
            className="h-full min-h-0 border-0 px-6 pb-5"
            header={
              <div className="mb-2 flex items-center justify-between border-b border-[var(--line)] py-[18px]">
                <div className="flex items-center gap-2.5">
                  <div className="grid h-9 w-9 place-items-center rounded-full bg-ink text-[0.78rem] font-bold text-white">
                    {active.username.slice(0, 1)}
                  </div>
                  <div>
                    <strong className="block text-[0.95rem]">{active.username}</strong>
                    <span className="text-[0.75rem] text-ink-mute">
                      {active.product_name}
                      {active.word_count ? ` · ${formatWords(active.word_count)}` : ''}
                    </span>
                  </div>
                </div>
                <span className="text-[0.78rem] font-bold text-teal">
                  {active.order_status ? orderStatusLabel(active.order_status) : '沟通中'}
                </span>
              </div>
            }
          />
        ) : (
          <div className="grid min-h-full place-items-center text-ink-mute">选择左侧用户</div>
        )}
      </section>
    </div>
  )
}
