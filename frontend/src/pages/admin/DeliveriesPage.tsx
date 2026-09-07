import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  ClipboardList,
  Copy,
  Download,
  FileText,
  Image as ImageIcon,
  Mail,
  Paperclip,
  Search,
  Type,
} from 'lucide-react'
import { ApiError, api } from '../../lib/api'
import { useToast } from '../../context/ToastContext'
import type { Delivery, ProductFileItem } from '../../types'

type Filter = 'all' | 'text' | 'file' | 'commission'

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'text', label: '文本' },
  { id: 'file', label: '文件' },
  { id: 'commission', label: '约稿稿件' },
]

function pad(n: number) {
  return String(n).padStart(2, '0')
}

function fmtClock(d: Date) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function fmtListTime(iso?: string | null) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const now = new Date()
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (d.toDateString() === now.toDateString()) return fmtClock(d)
  if (d.toDateString() === yesterday.toDateString()) return `昨天 ${fmtClock(d)}`
  return `${d.getMonth() + 1}/${d.getDate()} ${fmtClock(d)}`
}

function fmtFullTime(iso?: string | null) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${fmtClock(d)}`
}

function deliveryFiles(d: Delivery): ProductFileItem[] {
  if (d.files && d.files.length) return d.files
  if (d.download_url || d.file_name) {
    return [
      {
        id: d.download_url || d.file_name || d.id,
        file_name: d.file_name || '已购文件',
        is_image: /\.(png|jpe?g|gif|webp|bmp)$/i.test(d.file_name || ''),
        download_url: d.download_url,
      },
    ]
  }
  return []
}

function hasFiles(d: Delivery) {
  return deliveryFiles(d).length > 0
}

function hasText(d: Delivery) {
  return Boolean((d.payload || '').trim())
}

function isCommission(d: Delivery) {
  return d.sale_mode === 'commission'
}

function kindOf(d: Delivery): 'file' | 'text' {
  return hasFiles(d) ? 'file' : 'text'
}

function previewLine(d: Delivery) {
  const text = (d.payload || '').trim().split('\n')[0]
  if (text) return text
  const n = deliveryFiles(d).length
  return n ? `${n} 个文件` : '—'
}

function matchFilter(d: Delivery, filter: Filter) {
  if (filter === 'all') return true
  if (filter === 'commission') return isCommission(d)
  if (filter === 'file') return hasFiles(d)
  return hasText(d) && !hasFiles(d)
}

function matchQuery(d: Delivery, q: string) {
  if (!q) return true
  const files = deliveryFiles(d)
    .map((f) => f.file_name)
    .join(' ')
  const hay = [d.order_id, d.product_name, d.username, d.email, d.payload, files].join(' ').toLowerCase()
  return hay.includes(q)
}

function parseFilter(raw: string | null): Filter {
  return FILTERS.some((f) => f.id === raw) ? (raw as Filter) : 'all'
}

function isToday(iso: string) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return false
  return d.toDateString() === new Date().toDateString()
}

function csvEscape(v: string) {
  if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`
  return v
}

function exportCsv(rows: Delivery[]) {
  const head = ['订单号', '买家', '邮箱', '商品', '方式', '约稿', '发放时间', '内容']
  const body = rows.map((d) =>
    [
      d.order_id,
      d.username || '',
      d.email || '',
      d.product_name,
      kindOf(d) === 'file' ? '文件' : '文本',
      isCommission(d) ? '是' : '否',
      fmtFullTime(d.created_at),
      (d.payload || '').replace(/\s+/g, ' ').slice(0, 200),
    ]
      .map(csvEscape)
      .join(','),
  )
  const blob = new Blob(['\uFEFF' + [head.join(','), ...body].join('\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `deliveries-${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export function DeliveriesPage() {
  const { showToast } = useToast()
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const filter = parseFilter(searchParams.get('kind'))
  const [rows, setRows] = useState<Delivery[]>([])
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(true)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return rows.filter((d) => matchFilter(d, filter) && matchQuery(d, q))
  }, [rows, filter, query])

  const stats = useMemo(() => {
    const today = rows.filter((d) => isToday(d.created_at)).length
    const text = rows.filter((d) => hasText(d) && !hasFiles(d)).length
    const file = rows.filter(hasFiles).length
    const buyers = new Set(rows.map((d) => d.email || d.username || d.order_id)).size
    const yesterday = rows.filter((d) => {
      const dt = new Date(d.created_at)
      const y = new Date()
      y.setDate(y.getDate() - 1)
      return dt.toDateString() === y.toDateString()
    }).length
    return { today, text, file, buyers, yesterday }
  }, [rows])

  useEffect(() => {
    api
      .get<Delivery[]>('/api/deliveries')
      .then(setRows)
      .catch((e) => {
        setRows([])
        showToast(e instanceof ApiError ? e.message : '发放记录加载失败')
      })
      .finally(() => setBusy(false))
  }, [showToast])

  useEffect(() => {
    if (id || busy || !rows.length) return
    const pick = rows.find((d) => matchFilter(d, filter)) || rows[0]
    if (!pick) return
    const qs = searchParams.toString()
    navigate(`/admin/deliveries/${encodeURIComponent(pick.id)}${qs ? `?${qs}` : ''}`, { replace: true })
  }, [id, busy, rows, filter, navigate, searchParams])

  function setFilter(next: Filter) {
    const sp = new URLSearchParams(searchParams)
    if (next === 'all') sp.delete('kind')
    else sp.set('kind', next)
    setSearchParams(sp, { replace: true })
  }

  function openRow(rowId: string) {
    const qs = searchParams.toString()
    navigate(`/admin/deliveries/${encodeURIComponent(rowId)}${qs ? `?${qs}` : ''}`)
  }

  async function copyText(text: string, ok = '已复制') {
    try {
      await navigator.clipboard.writeText(text)
      showToast(ok)
    } catch {
      showToast('复制失败')
    }
  }

  const active = rows.find((d) => d.id === id) || null
  const todayDelta = stats.today - stats.yesterday

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-white">
      <header className="shrink-0 px-5 pt-6 md:px-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="font-[family-name:var(--font-display)] text-[clamp(1.7rem,2.6vw,2.1rem)] leading-[1.1] font-extrabold tracking-[-0.04em]">
              发放记录
            </h1>
            <p className="mt-1 text-[0.86rem] text-ink-mute">
              {busy ? (
                '加载中…'
              ) : (
                <>
                  当前筛选 <b className="font-bold text-teal">{filtered.length}</b> 次，今日{' '}
                  <b className="font-bold text-teal">{stats.today}</b> 次。
                </>
              )}
            </p>
          </div>
          <button
            type="button"
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[10px] border border-[var(--line-strong)] px-3.5 text-[0.82rem] font-semibold text-ink transition hover:border-ink"
            onClick={() => {
              exportCsv(filtered)
              showToast(filtered.length ? `已导出 ${filtered.length} 条` : '没有可导出的记录')
            }}
          >
            <Download className="h-3.5 w-3.5" strokeWidth={1.9} />
            导出 CSV
          </button>
        </div>

        <dl className="mt-[22px] grid grid-cols-2 border-y border-[var(--line)] md:grid-cols-4">
          <BillCell
            label="今日发放"
            value={String(stats.today)}
            hint={todayDelta > 0 ? `较昨日 +${todayDelta}` : todayDelta < 0 ? `较昨日 ${todayDelta}` : '与昨日持平'}
          />
          <BillCell label="文本发放" value={String(stats.text)} hint="卡密 / 链接" />
          <BillCell label="文件发放" value={String(stats.file)} hint="含约稿稿件" />
          <BillCell label="涉及买家" value={String(stats.buyers)} hint="去重" />
        </dl>

        <div className="mt-[22px] flex flex-wrap items-center gap-x-5 gap-y-3">
          <label className="flex min-w-[220px] max-w-[380px] flex-1 items-center gap-2 border-b border-[var(--line-strong)] pb-1.5 focus-within:border-teal">
            <Search className="h-3.5 w-3.5 shrink-0 text-ink-mute" strokeWidth={1.9} />
            <input
              className="min-w-0 flex-1 border-0 bg-transparent text-[0.88rem] outline-none placeholder:text-ink-mute"
              placeholder="搜索订单号、商品或发放内容"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <div className="flex flex-wrap gap-1">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFilter(f.id)}
                className={`inline-flex h-[30px] items-center rounded-lg px-3 text-[0.8rem] font-semibold ${
                  filter === f.id
                    ? 'border border-[var(--line-strong)] bg-white text-ink'
                    : 'border border-transparent bg-transparent text-ink-mute hover:bg-paper hover:text-ink'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="mt-6 grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(0,1fr)_minmax(0,1.15fr)] border-t border-[var(--line)] xl:grid-cols-[minmax(0,1fr)_400px] xl:grid-rows-[minmax(0,1fr)]">
        <section className="min-h-0 overflow-y-auto overscroll-contain px-2 pb-8 md:px-4">
          {busy ? (
            <p className="px-4 py-12 text-[0.86rem] text-ink-mute">加载中…</p>
          ) : filtered.length ? (
            filtered.map((d) => {
              const on = d.id === id
              const kind = kindOf(d)
              return (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => openRow(d.id)}
                  className={`relative grid w-full grid-cols-[minmax(0,1fr)_auto] gap-x-[18px] gap-y-1 border-b border-[var(--line)] py-4 pr-3 pl-4 text-left transition hover:bg-[rgba(232,241,238,.45)] ${
                    on ? 'bg-paper before:bg-teal' : 'before:bg-transparent'
                  } before:absolute before:top-0 before:bottom-0 before:left-0 before:w-0.5`}
                >
                  <div className="min-w-0">
                    <div className="flex items-baseline gap-2.5">
                      <span className="font-[family-name:var(--font-mono)] text-[0.74rem] tracking-[-0.01em] text-ink-mute">
                        {d.order_id}
                      </span>
                      <span
                        className={`inline-flex shrink-0 items-center gap-0.5 text-[0.68rem] font-bold ${
                          kind === 'file' ? 'text-[#8a6a2f]' : 'text-teal'
                        }`}
                      >
                        {kind === 'file' ? (
                          <Paperclip className="h-3 w-3" strokeWidth={2} />
                        ) : (
                          <Type className="h-3 w-3" strokeWidth={2} />
                        )}
                        {kind === 'file' ? '文件' : '文本'}
                        {isCommission(d) ? ' · 约稿' : ''}
                      </span>
                    </div>
                    <div className="mt-1 truncate text-[0.92rem] font-bold">{d.product_name}</div>
                    <div className="mt-0.5 flex min-w-0 flex-wrap gap-2.5 text-[0.76rem] text-ink-mute">
                      <span>{d.username || '买家'}</span>
                      <span className="max-w-[280px] truncate font-[family-name:var(--font-mono)] text-[0.72rem]">
                        {previewLine(d)}
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-col items-end justify-center gap-1 self-center">
                    <span className="inline-flex items-center gap-1.5 text-[0.76rem] font-semibold text-teal">
                      <i className="h-1.5 w-1.5 rounded-full bg-teal" />
                      已发放
                    </span>
                    <span className="font-[family-name:var(--font-mono)] text-[0.68rem] text-ink-mute">
                      {fmtListTime(d.created_at)}
                    </span>
                  </div>
                </button>
              )
            })
          ) : (
            <p className="px-4 py-16 text-center text-[0.86rem] text-ink-mute">没有匹配的发放记录</p>
          )}
        </section>

        <aside className="hover-scroll min-h-0 overflow-y-auto overscroll-contain border-t border-[var(--line)] px-5 py-6 md:px-8 xl:border-t-0 xl:border-l xl:px-7">
          {active ? (
            <DeliveryDetail
              row={active}
              onCopy={copyText}
              onDownload={async (url, name) => {
                try {
                  await api.download(url, name)
                } catch (e) {
                  showToast(e instanceof ApiError ? e.message : '下载失败')
                }
              }}
            />
          ) : (
            <div className="px-2 py-16 text-center text-[0.86rem] text-ink-mute">选择左侧记录查看详情</div>
          )}
        </aside>
      </div>
    </div>
  )
}

function BillCell({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="border-[var(--line)] py-4 pr-4 max-md:even:border-l max-md:even:pl-5 max-md:[&:nth-child(n+3)]:border-t md:[&:not(:first-child)]:border-l md:[&:not(:first-child)]:pl-5">
      <dt className="mb-2 text-[0.72rem] tracking-[0.05em] text-ink-mute">{label}</dt>
      <dd className="m-0 flex items-baseline gap-2">
        <b className="font-[family-name:var(--font-display)] text-[1.9rem] leading-none font-extrabold tracking-[-0.045em]">
          {value}
        </b>
        <span className="text-[0.72rem] font-semibold text-ink-mute">{hint}</span>
      </dd>
    </div>
  )
}

function DeliveryDetail({
  row,
  onCopy,
  onDownload,
}: {
  row: Delivery
  onCopy: (text: string, ok?: string) => void
  onDownload: (url: string, name: string) => void
}) {
  const files = deliveryFiles(row)
  const kind = kindOf(row)
  const payload = (row.payload || '').trim()

  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 font-[family-name:var(--font-mono)] text-[0.78rem] text-ink-mute">
            {row.order_id}
            <button type="button" title="复制订单号" className="grid p-0.5 text-ink-mute hover:text-teal" onClick={() => onCopy(row.order_id)}>
              <Copy className="h-3.5 w-3.5" strokeWidth={1.8} />
            </button>
          </div>
          <h2 className="mt-2.5 font-[family-name:var(--font-display)] text-[1.4rem] leading-snug tracking-[-0.03em] break-words">
            {row.product_name}
          </h2>
          <div className="mt-1.5 text-[0.8rem] text-ink-mute">
            {row.username || '买家'}
            {row.email ? (
              <>
                {' · '}
                <a className="font-semibold text-teal hover:underline" href={`mailto:${row.email}`}>
                  {row.email}
                </a>
              </>
            ) : null}
            {' · '}
            <Link to={`/admin/orders/${encodeURIComponent(row.order_id)}`} className="font-semibold text-teal hover:underline">
              查看订单
            </Link>
          </div>
        </div>
        <span className="mt-0.5 inline-flex shrink-0 items-center gap-1.5 text-[0.8rem] font-semibold text-teal">
          <i className="h-1.5 w-1.5 rounded-full bg-teal" />
          已发放
        </span>
      </div>

      <section className="mt-7">
        <h3 className="m-0 border-b border-[var(--line)] pb-2.5 text-[0.76rem] font-bold tracking-[0.08em] text-ink-soft">
          发放信息
        </h3>
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
          <dt className="whitespace-nowrap text-[0.8rem] text-ink-mute">发放时间</dt>
          <dd className="m-0 text-right font-[family-name:var(--font-mono)] text-[0.78rem] font-semibold tracking-[-0.01em]">
            {fmtFullTime(row.created_at)}
          </dd>
          <dt className="whitespace-nowrap text-[0.8rem] text-ink-mute">发放方式</dt>
          <dd className="m-0 text-right text-[0.84rem] font-semibold">
            {kind === 'file' ? '文件下载' : '文本内容'}
            {isCommission(row) ? ' · 约稿' : ''}
          </dd>
          <dt className="whitespace-nowrap text-[0.8rem] text-ink-mute">关联订单</dt>
          <dd className="m-0 text-right font-[family-name:var(--font-mono)] text-[0.78rem] font-semibold tracking-[-0.01em]">
            {row.order_id}
          </dd>
          <dt className="whitespace-nowrap text-[0.8rem] text-ink-mute">买家</dt>
          <dd className="m-0 text-right text-[0.84rem] font-semibold break-all">
            {row.username || '买家'}
            {row.email ? <span className="font-medium text-ink-mute"> {row.email}</span> : null}
          </dd>
        </dl>
      </section>

      {payload ? (
        <section className="mt-7">
          <h3 className="m-0 flex items-baseline justify-between border-b border-[var(--line)] pb-2.5 text-[0.76rem] font-bold tracking-[0.08em] text-ink-soft">
            发放内容 <small className="font-medium tracking-normal text-ink-mute">文本</small>
          </h3>
          <pre className="mt-3 max-h-[200px] overflow-y-auto border border-[var(--line)] bg-fog px-3.5 py-3 font-[family-name:var(--font-mono)] text-[0.8rem] leading-relaxed break-all whitespace-pre-wrap text-ink-soft">
            {payload}
          </pre>
          <div className="mt-2 flex items-center justify-between">
            <small className="text-[0.72rem] text-ink-mute">{payload.length} 字符</small>
            <button
              type="button"
              className="inline-flex h-[30px] items-center gap-1.5 rounded-[10px] border border-[var(--line-strong)] px-2.5 text-[0.74rem] font-semibold hover:border-ink"
              onClick={() => onCopy(payload, '已复制发放内容')}
            >
              <Copy className="h-3 w-3" strokeWidth={1.8} />
              复制文本
            </button>
          </div>
        </section>
      ) : null}

      {files.length ? (
        <section className="mt-7">
          <h3 className="m-0 flex items-baseline justify-between border-b border-[var(--line)] pb-2.5 text-[0.76rem] font-bold tracking-[0.08em] text-ink-soft">
            交付文件 <small className="font-medium tracking-normal text-ink-mute">{files.length} 个</small>
          </h3>
          <ul className="m-0 mt-2 list-none p-0">
            {files.map((f) => (
              <li key={f.id} className="flex items-center gap-2.5 border-b border-[var(--line)] py-2.5 last:border-b-0">
                <div className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-sm bg-[rgba(15,110,92,.1)] text-teal">
                  {f.is_image ? <ImageIcon className="h-3.5 w-3.5" strokeWidth={1.8} /> : <FileText className="h-3.5 w-3.5" strokeWidth={1.8} />}
                </div>
                <div className="min-w-0 flex-1">
                  <b className="block truncate text-[0.8rem]">{f.file_name}</b>
                </div>
                {f.download_url ? (
                  <button
                    type="button"
                    className="shrink-0 border-0 bg-transparent p-0 text-[0.74rem] font-bold text-teal hover:underline"
                    onClick={() => onDownload(f.download_url!, f.file_name)}
                  >
                    下载
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {!payload && !files.length ? <p className="mt-7 mb-0 text-[0.8rem] text-ink-mute">没有可展示的发放内容</p> : null}

      <div className="mt-7 flex flex-wrap gap-2">
        <Link
          to={`/admin/orders/${encodeURIComponent(row.order_id)}`}
          className="inline-flex h-[38px] items-center gap-1.5 rounded-[10px] bg-teal px-4 text-[0.84rem] font-bold text-white hover:bg-teal-deep"
        >
          <ClipboardList className="h-3.5 w-3.5" strokeWidth={1.9} />
          查看订单
        </Link>
        <button
          type="button"
          className="inline-flex h-[38px] items-center gap-1.5 rounded-[10px] border border-[var(--line-strong)] px-3.5 text-[0.82rem] font-semibold hover:border-ink"
          onClick={() => onCopy(row.order_id, '已复制订单号')}
        >
          <Copy className="h-3.5 w-3.5" strokeWidth={1.8} />
          复制单号
        </button>
        {row.email ? (
          <a
            href={`mailto:${row.email}`}
            className="inline-flex h-[38px] items-center gap-1.5 rounded-[10px] border border-[var(--line-strong)] px-3.5 text-[0.82rem] font-semibold hover:border-ink"
          >
            <Mail className="h-3.5 w-3.5" strokeWidth={1.8} />
            发邮件
          </a>
        ) : null}
      </div>
    </div>
  )
}
