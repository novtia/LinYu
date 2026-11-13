import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { ApiError, api } from '../../lib/api'
import { addDays, isoDay, shanghaiDay, yuanText } from '../../lib/ledger'
import { useToast } from '../../context/ToastContext'
import { StatStrip } from '../../components/StatStrip'
import type { Analytics, Category, Product } from '../../types'

export function CategoriesPage() {
  const { showToast } = useToast()
  const [categories, setCategories] = useState<Category[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [rows, setRows] = useState<Analytics['rows']>([])
  const [creating, setCreating] = useState(false)
  const [activeId, setActiveId] = useState<number | null>(null)
  const [form, setForm] = useState({ name: '', sort_order: '0', enabled: true })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [moving, setMoving] = useState(false)

  async function load() {
    const list = await api.get<Category[]>('/api/categories/admin')
    const sorted = [...list].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id)
    setCategories(sorted)
    return sorted
  }

  useEffect(() => {
    load()
      .then((sorted) => {
        const first = sorted[0]
        if (first) {
          setActiveId(first.id)
          setForm({ name: first.name, sort_order: String(first.sort_order), enabled: first.enabled })
        }
      })
      .catch((e) => {
        setCategories([])
        showToast(e instanceof ApiError ? e.message : '分类加载失败')
      })
    api.get<Product[]>('/api/products/admin').then(setProducts).catch(() => setProducts([]))
    api.get<Analytics>('/api/analytics').then((a) => setRows(a.rows)).catch(() => setRows([]))
  }, [])

  const since = isoDay(addDays(new Date(), -29))
  const revByProduct = useMemo(() => {
    const map = new Map<number, number>()
    for (const row of rows) {
      if (!row.ok || !row.product_id || shanghaiDay(row.at) < since) continue
      map.set(row.product_id, (map.get(row.product_id) || 0) + row.amount)
    }
    return map
  }, [rows, since])

  const stats = useMemo(() => {
    return categories.map((c) => {
      const mine = products.filter((p) => p.category_id === c.id)
      const onGoods = mine.filter((p) => p.status === 'on').length
      const rev = mine.reduce((sum, p) => sum + (revByProduct.get(p.id) || 0), 0)
      return { ...c, goods: mine.length, onGoods, rev }
    })
  }, [categories, products, revByProduct])

  const revAll = stats.reduce((sum, c) => sum + c.rev, 0)
  const maxRev = Math.max(1, ...stats.map((c) => c.rev))
  const top = stats.slice().sort((a, b) => b.rev - a.rev)[0]
  const active = stats.find((c) => c.id === activeId) || null

  function select(c: Category) {
    setCreating(false)
    setActiveId(c.id)
    setForm({ name: c.name, sort_order: String(c.sort_order), enabled: c.enabled })
    setError('')
  }

  function startCreate() {
    setCreating(true)
    setError('')
    setForm({ name: '', sort_order: String(categories.length), enabled: true })
  }

  async function onSave(e?: FormEvent) {
    e?.preventDefault()
    const name = form.name.trim()
    const sort_order = Number(form.sort_order)
    if (!name) {
      setError('请填写分类名称')
      return
    }
    if (Number.isNaN(sort_order)) {
      setError('排序需为数字')
      return
    }
    setSaving(true)
    setError('')
    try {
      const body = { name, sort_order, enabled: form.enabled }
      if (creating) {
        const created = await api.post<Category>('/api/categories', body)
        showToast('分类已创建')
        const sorted = await load()
        const hit = sorted.find((c) => c.id === created.id) || sorted[sorted.length - 1]
        if (hit) select(hit)
      } else if (active) {
        await api.put(`/api/categories/${active.id}`, body)
        showToast('分类已更新')
        await load()
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  async function onDelete(c: Category) {
    if (!confirm(`删除分类「${c.name}」？里面的商品会变成未分类。`)) return
    try {
      await api.delete(`/api/categories/${c.id}`)
      showToast('已删除')
      const sorted = await load()
      setCreating(false)
      const next = sorted[0]
      if (next) select(next)
      else {
        setActiveId(null)
        setForm({ name: '', sort_order: '0', enabled: true })
      }
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : '删除失败')
    }
  }

  async function move(index: number, dir: -1 | 1) {
    const j = index + dir
    if (moving || j < 0 || j >= stats.length) return
    const next = stats.slice()
    const [row] = next.splice(index, 1)
    next.splice(j, 0, row)
    setMoving(true)
    try {
      await Promise.all(
        next.map((c, n) => {
          if (c.sort_order === n) return Promise.resolve()
          return api.put(`/api/categories/${c.id}`, { name: c.name, sort_order: n, enabled: c.enabled })
        }),
      )
      await load()
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : '排序失败')
    } finally {
      setMoving(false)
    }
  }

  return (
    <div className="lx-desk -m-4 min-h-full bg-white px-6 py-7 md:-m-6 md:px-8">
      <div className="desk-inner">
      <header className="page-head">
        <div>
          <h1>分类</h1>
          <p className="lead">
            启用 <b className="text-teal">{stats.filter((c) => c.enabled).length}</b> 个。停用后前台不再按它筛选，商品还在。近 30 日这些分类合计实收 <b className="text-teal">{yuanText(revAll)}</b>。
          </p>
        </div>
        <div className="flex gap-2">
          <Link className="ghost-btn" to="/admin/products">商品列表</Link>
          <button type="button" className="teal-btn" onClick={startCreate}>新分类</button>
        </div>
      </header>

      <div className="mt-4">
        <StatStrip
          items={[
            { label: '分类', value: String(stats.length), hint: `${stats.filter((c) => c.enabled).length} 个启用` },
            { label: '商品', value: String(products.length), hint: '含下架' },
            { label: '近 30 日实收', value: yuanText(revAll), to: '/admin/revenue' },
            { label: '空分类', value: String(stats.filter((c) => !c.goods).length), hint: top ? `实收最多 ${top.name}` : '还没有分类' },
          ]}
        />
      </div>

      <div className="grid items-start gap-8 xl:grid-cols-[minmax(0,1fr)_280px]">
        <section>
          <h2 className="flex items-baseline justify-between border-b border-[var(--line)] pb-2 font-[family-name:var(--font-display)] text-[1.05rem] font-bold">
            前台顺序
            <small className="font-[family-name:var(--font-body)] text-[0.74rem] font-medium text-ink-mute">上面的先出现</small>
          </h2>
          {!stats.length ? <p className="py-8 text-[0.86rem] text-ink-mute">还没有分类</p> : null}
          {stats.map((c, i) => (
            <div
              key={c.id}
              className={`grid cursor-pointer grid-cols-[28px_minmax(0,1.2fr)_minmax(80px,.7fr)_88px_64px_28px] items-center gap-2 border-b border-[var(--line)] py-3 ${!creating && c.id === activeId ? 'bg-paper' : ''}`}
              onClick={() => select(c)}
            >
              <div className="flex flex-col">
                <button type="button" className="text-[0.72rem] text-ink-mute disabled:opacity-30" disabled={i === 0 || moving} aria-label="上移" onClick={(e) => { e.stopPropagation(); void move(i, -1) }}>↑</button>
                <button type="button" className="text-[0.72rem] text-ink-mute disabled:opacity-30" disabled={i === stats.length - 1 || moving} aria-label="下移" onClick={(e) => { e.stopPropagation(); void move(i, 1) }}>↓</button>
              </div>
              <div className="min-w-0">
                <b className="block truncate text-[0.9rem]">{c.name}</b>
                <span className="text-[0.72rem] text-ink-mute">#{c.id} · 排序 {c.sort_order}</span>
              </div>
              <div className="h-[3px] bg-[rgba(20,32,28,.06)]"><i className="block h-full bg-teal" style={{ width: `${Math.round((c.rev / maxRev) * 100)}%` }} /></div>
              <span className="text-right font-[family-name:var(--font-mono)] text-[0.78rem]">{yuanText(c.rev)}</span>
              <span className={`text-[0.72rem] font-bold ${c.enabled ? 'text-teal' : 'text-ink-mute'}`}>{c.enabled ? `${c.onGoods} 在售` : '停用'}</span>
              <button type="button" className="text-[0.75rem] font-bold text-danger" aria-label="删除" onClick={(e) => { e.stopPropagation(); void onDelete(c) }}>✕</button>
            </div>
          ))}
        </section>

        <aside className="xl:sticky xl:top-0 xl:border-l xl:border-[var(--line)] xl:pl-5">
          <div className="text-[0.72rem] tracking-[0.06em] text-ink-mute">{creating ? '新分类' : '编辑分类'}</div>
          <form className="mt-3" onSubmit={onSave}>
            <label className="grid gap-1.5">
              <span className="text-[0.76rem] font-bold text-ink-soft">名称</span>
              <input className="border-0 border-b border-[var(--line-strong)] bg-transparent py-2 outline-none focus:border-teal" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus={creating} />
            </label>
            <label className="mt-4 grid gap-1.5">
              <span className="text-[0.76rem] font-bold text-ink-soft">排序</span>
              <input className="border-0 border-b border-[var(--line-strong)] bg-transparent py-2 outline-none focus:border-teal" inputMode="numeric" value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: e.target.value })} />
            </label>
            <div className="mt-3 flex items-center justify-between gap-3 border-b border-[var(--line)] py-3 text-[0.86rem]">
              <span>启用 <small className="text-[0.75rem] text-ink-mute">停用后前台筛选里不再出现</small></span>
              <button type="button" className={`switch ${form.enabled ? 'on' : ''}`} aria-label="启用" onClick={() => setForm({ ...form, enabled: !form.enabled })} />
            </div>
            <p className="mt-3 text-[0.78rem] leading-relaxed text-ink-mute">
              {creating || !active
                ? '保存后出现在前台筛选里。排序数字越小越靠前。'
                : `${active.goods} 件商品，其中 ${active.onGoods} 件在售。删分类不会删商品，商品会变成未分类。`}
            </p>
            {error ? <p className="mt-2 text-[0.82rem] text-danger">{error}</p> : null}
            <div className="mt-4 flex gap-2">
              <button type="submit" disabled={saving} className="h-9 rounded-[10px] bg-teal px-3 text-[0.84rem] font-bold text-white disabled:opacity-60">
                {saving ? '保存中…' : '保存'}
              </button>
              {!creating && active ? (
                <button type="button" className="h-9 rounded-[10px] border border-[var(--line-strong)] px-3 text-[0.84rem] font-semibold text-danger" onClick={() => onDelete(active)}>
                  删除
                </button>
              ) : null}
            </div>
          </form>
        </aside>
      </div>
      </div>
    </div>
  )
}
