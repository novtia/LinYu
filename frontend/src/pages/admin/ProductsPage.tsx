import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ChevronDown, ChevronUp, FolderPlus, FolderTree, LayoutGrid, Pencil, Plus, Search, Table2 } from 'lucide-react'
import { ApiError, api } from '../../lib/api'
import { addDays, isoDay, shanghaiDay, yuanText } from '../../lib/ledger'
import { useToast } from '../../context/ToastContext'
import type { Analytics, Category, Product } from '../../types'

type CatEdit = {
  mode: 'new' | 'edit'
  id?: number
  origName?: string
  name: string
  sort_order: string
  enabled: boolean
}

export function ProductsPage() {
  const { showToast } = useToast()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const focusCategories = searchParams.get('focus') === 'categories'

  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [books, setBooks] = useState<Analytics | null>(null)

  const [catScope, setCatScope] = useState<'all' | 'uncat' | number>('all')
  const [filter, setFilter] = useState<'all' | 'on' | 'off' | 'commission' | 'cold'>('all')
  const [q, setQ] = useState('')
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid')
  const [activeId, setActiveId] = useState<number | null>(null)

  const [editingCat, setEditingCat] = useState<CatEdit | null>(null)
  const [catSaving, setCatSaving] = useState(false)
  const [moving, setMoving] = useState(false)

  async function loadAll() {
    const [plist, clist] = await Promise.all([
      api.get<Product[]>('/api/products/admin'),
      api.get<Category[]>('/api/categories/admin'),
    ])
    setProducts(plist)
    setCategories([...clist].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id))
  }

  useEffect(() => {
    loadAll().catch((e) => {
      showToast(e instanceof ApiError ? e.message : '商品与分类加载失败')
    })
    api.get<Analytics>('/api/analytics').then(setBooks).catch(() => setBooks(null))
  }, [showToast])

  useEffect(() => {
    if (focusCategories) {
      document.getElementById('cat-rail')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [focusCategories])

  const since = isoDay(addDays(new Date(), -29))
  const earned = useMemo(() => {
    const map = new Map<number, number>()
    for (const row of books?.rows || []) {
      if (!row.ok || !row.product_id || shanghaiDay(row.at) < since) continue
      map.set(row.product_id, (map.get(row.product_id) || 0) + row.amount)
    }
    return map
  }, [books, since])

  const ordersN = useMemo(() => {
    const map = new Map<number, Set<string>>()
    for (const row of books?.rows || []) {
      if (!row.ok || !row.product_id || shanghaiDay(row.at) < since) continue
      const set = map.get(row.product_id) || new Set<string>()
      set.add(row.order_id)
      map.set(row.product_id, set)
    }
    return map
  }, [books, since])

  const dailyBarsByProduct = useMemo(() => {
    const days14 = Array.from({ length: 14 }, (_, i) => isoDay(addDays(new Date(), i - 13)))
    const dayIndex = new Map(days14.map((d, i) => [d, i]))
    const map = new Map<number, number[]>()
    for (const row of books?.rows || []) {
      if (!row.ok || !row.product_id) continue
      const idx = dayIndex.get(shanghaiDay(row.at))
      if (idx == null) continue
      const arr = map.get(row.product_id) || Array(14).fill(0)
      arr[idx] += 1
      map.set(row.product_id, arr)
    }
    return map
  }, [books])

  const monthRev = [...earned.values()].reduce((a, n) => a + n, 0)
  const revAll = Math.max(1, monthRev)
  const onList = products.filter((p) => p.status === 'on')
  const comN = onList.filter((p) => p.sale_mode === 'commission').length
  const coldN = onList.filter((p) => !(ordersN.get(p.id)?.size)).length
  const activeCatsCount = categories.filter((c) => c.enabled).length
  const uncatCount = products.filter((p) => !p.category_id).length

  const shown = products.filter((p) => {
    if (catScope === 'uncat' && p.category_id) return false
    if (typeof catScope === 'number' && p.category_id !== catScope) return false
    if (filter === 'on' && p.status !== 'on') return false
    if (filter === 'off' && p.status === 'on') return false
    if (filter === 'commission' && p.sale_mode !== 'commission') return false
    if (filter === 'cold' && (p.status !== 'on' || (ordersN.get(p.id)?.size || 0) > 0)) return false
    if (q && !`${p.name} ${p.category_name || ''} ${p.id}`.toLowerCase().includes(q.toLowerCase())) return false
    return true
  })
  const active = shown.find((p) => p.id === activeId) || products.find((p) => p.id === activeId) || shown[0] || null

  function catLabel(catId?: number | null, fallback?: string | null) {
    if (!catId) return '未分类'
    return categories.find((c) => c.id === catId)?.name || fallback || '未分类'
  }

  async function toggleProduct(id: number) {
    try {
      const p = await api.patch<Product>(`/api/products/${id}/toggle`)
      await loadAll()
      showToast(p.status === 'on' ? '已上架' : '已下架')
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : '操作失败')
    }
  }

  async function removeProduct(p: Product) {
    if (!window.confirm(`确定删除商品「${p.name}」？删除后无法恢复，历史订单的发货记录会保留。`)) return
    try {
      await api.delete(`/api/products/${p.id}`)
      await loadAll()
      showToast('商品已删除')
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : '删除失败')
    }
  }

  async function reassignCategory(p: Product, nextCatId: number | null) {
    try {
      const full = await api.get<Product>(`/api/products/admin/${p.id}`)
      await api.put(`/api/products/${p.id}`, {
        name: full.name,
        price: full.price,
        cover: full.cover || 'p1',
        desc: full.desc,
        delivery_content: full.delivery_content || '',
        status: full.status,
        category_id: nextCatId,
        sale_mode: full.sale_mode || 'normal',
      })
      await loadAll()
      showToast(`已调至「${catLabel(nextCatId)}」`)
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : '修改分类失败')
    }
  }

  async function moveCategory(index: number, dir: -1 | 1) {
    const target = index + dir
    if (moving || target < 0 || target >= categories.length) return
    const next = categories.slice()
    const [row] = next.splice(index, 1)
    next.splice(target, 0, row)
    setMoving(true)
    try {
      await Promise.all(
        next.map((c, idx) => {
          if (c.sort_order === idx) return Promise.resolve()
          return api.put(`/api/categories/${c.id}`, { name: c.name, sort_order: idx, enabled: c.enabled })
        }),
      )
      await loadAll()
      showToast('已调整分类前台顺序')
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : '排序失败')
    } finally {
      setMoving(false)
    }
  }

  function startNewCategory() {
    setEditingCat({
      mode: 'new',
      name: '',
      sort_order: String(categories.length),
      enabled: true,
    })
    document.getElementById('cat-rail')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }

  async function saveCategory() {
    if (!editingCat) return
    const name = editingCat.name.trim()
    const sort_order = Number(editingCat.sort_order)
    if (!name) {
      showToast('请填写分类名称')
      return
    }
    if (Number.isNaN(sort_order)) {
      showToast('排序须为数字')
      return
    }
    setCatSaving(true)
    try {
      const body = { name, sort_order, enabled: editingCat.enabled }
      if (editingCat.mode === 'new') {
        const created = await api.post<Category>('/api/categories', body)
        setCatScope(created.id)
        showToast(`已新建分类「${name}」`)
      } else if (editingCat.id != null) {
        await api.put(`/api/categories/${editingCat.id}`, body)
        showToast('分类已保存')
      }
      setEditingCat(null)
      await loadAll()
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : '保存失败')
    } finally {
      setCatSaving(false)
    }
  }

  async function deleteCategory(id: number, name: string) {
    if (!window.confirm(`删除分类「${name}」？里面的商品会变成未分类。`)) return
    try {
      await api.delete(`/api/categories/${id}`)
      if (catScope === id) setCatScope('all')
      setEditingCat(null)
      await loadAll()
      showToast('已删除分类')
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : '删除失败')
    }
  }

  const newProductHref =
    typeof catScope === 'number' ? `/admin/products/new?cat=${catScope}` : '/admin/products/new'

  return (
    <div className="lx-desk -m-4 min-h-full bg-fog px-5 py-6 md:-m-6 md:px-7 md:py-7">
      <div className="desk-inner">
        <header className="catalog-head">
          <div>
            <div className="cat-kicker">
              <span className="badge">CATALOG &amp; SHELF</span>
              <span>把前台书目分类与商品经营放到同一个工作台</span>
            </div>
            <h1>商品与分类</h1>
            <p className="lead">
              在售 <b>{onList.length}</b> 件（约稿 <b>{comN}</b> · 成品 <b>{onList.length - comN}</b>），共启用{' '}
              <b>{activeCatsCount}</b> 个前台分类。近 30 日全店商品累计实收 <b>{yuanText(monthRev)}</b>。
            </p>
          </div>
          <div className="head-right">
            <div className="head-actions">
              <button type="button" className="ghost-btn" onClick={startNewCategory}>
                <FolderPlus className="h-4 w-4" />
                新分类
              </button>
              <button type="button" className="teal-btn" onClick={() => navigate(newProductHref)}>
                <Plus className="h-4 w-4" />
                新增商品
              </button>
            </div>
            <div className="pulse-strip">
              <div className="ps">
                <small>在售书目</small>
                <b>
                  {onList.length} / {products.length}
                </b>
              </div>
              <div className="ps">
                <small>启用分类</small>
                <b>
                  {activeCatsCount} / {categories.length}
                </b>
              </div>
              <div className="ps">
                <small>30 日实收</small>
                <b>{yuanText(monthRev)}</b>
              </div>
              <div className="ps">
                <small>30 日滞销</small>
                <b className={coldN ? 'warn' : ''}>{coldN} 件</b>
              </div>
            </div>
          </div>
        </header>

        <div className="studio-grid">
          <aside className={`cat-rail ${focusCategories ? 'focus-ring' : ''}`} id="cat-rail" aria-label="分类目录管理">
            <div className="rail-head">
              <h2>
                <FolderTree className="h-4 w-4 text-teal" />
                前台分类
              </h2>
              <button type="button" className="mini-add" onClick={startNewCategory}>
                <Plus className="h-3 w-3" />
                新增
              </button>
            </div>

            <ul className="cat-list">
              <li className={`cat-item ${catScope === 'all' ? 'on' : ''}`} onClick={() => setCatScope('all')}>
                <div className="cat-top">
                  <span className="cat-name">
                    <i className="dot-st" />
                    <span>全部商品</span>
                  </span>
                  <span className="cat-count">{products.length}</span>
                </div>
                <div className="cat-bar">
                  <i style={{ width: '100%' }} />
                </div>
                <div className="cat-foot">
                  <span>全站汇总</span>
                  <span>{yuanText(monthRev)}</span>
                </div>
              </li>

              {categories.map((c, idx) => {
                const mine = products.filter((p) => p.category_id === c.id)
                const onN = mine.filter((p) => p.status === 'on').length
                const rev = mine.reduce((sum, p) => sum + (earned.get(p.id) || 0), 0)
                const pct = Math.round((rev / revAll) * 100)
                return (
                  <li
                    key={c.id}
                    className={`cat-item ${catScope === c.id ? 'on' : ''} ${c.enabled ? '' : 'off'}`}
                    onClick={() => setCatScope(c.id)}
                  >
                    <div className="cat-top">
                      <span className="cat-name">
                        <i className="dot-st" />
                        <span>{c.name}</span>
                      </span>
                      <span className="cat-count">
                        {onN}/{mine.length}
                      </span>
                    </div>
                    <div className="cat-bar">
                      <i style={{ width: `${pct}%` }} />
                    </div>
                    <div className="cat-foot">
                      <span>{c.enabled ? `占 ${pct}% · ${yuanText(rev)}` : '已停用'}</span>
                      <span className="cat-ops" onClick={(e) => e.stopPropagation()}>
                        <button type="button" disabled={idx === 0 || moving} title="上移" onClick={() => void moveCategory(idx, -1)}>
                          <ChevronUp className="h-3.5 w-3.5" />
                        </button>
                        <button type="button" disabled={idx === categories.length - 1 || moving} title="下移" onClick={() => void moveCategory(idx, 1)}>
                          <ChevronDown className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          title="编辑分类"
                          onClick={() =>
                            setEditingCat({
                              mode: 'edit',
                              id: c.id,
                              origName: c.name,
                              name: c.name,
                              sort_order: String(c.sort_order),
                              enabled: c.enabled,
                            })
                          }
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                      </span>
                    </div>
                  </li>
                )
              })}

              {uncatCount > 0 ? (
                <li className={`cat-item ${catScope === 'uncat' ? 'on' : ''}`} onClick={() => setCatScope('uncat')}>
                  <div className="cat-top">
                    <span className="cat-name">
                      <i className="dot-st" style={{ background: 'var(--gold)' }} />
                      <span>未分类</span>
                    </span>
                    <span className="cat-count">{uncatCount}</span>
                  </div>
                  <div className="cat-foot">
                    <span>暂未归类作品</span>
                    <span>待整理</span>
                  </div>
                </li>
              ) : null}
            </ul>

            {editingCat ? (
              <div className="cat-editor">
                <div className="cat-editor-head">
                  <span>{editingCat.mode === 'new' ? '新建前台分类' : `编辑 · ${editingCat.origName}`}</span>
                  <button type="button" onClick={() => setEditingCat(null)}>
                    收起
                  </button>
                </div>
                <div className="fields" style={{ marginTop: 10, gap: 10 }}>
                  <label className="field">
                    <span>分类名称</span>
                    <input
                      value={editingCat.name}
                      placeholder="如：悬疑、都市"
                      onChange={(e) => setEditingCat({ ...editingCat, name: e.target.value })}
                    />
                  </label>
                  <label className="field">
                    <span>前台排序（数字越小越靠前）</span>
                    <input
                      inputMode="numeric"
                      value={editingCat.sort_order}
                      onChange={(e) => setEditingCat({ ...editingCat, sort_order: e.target.value })}
                    />
                  </label>
                  <div className="switch" style={{ padding: '7px 0', fontSize: '.8rem' }}>
                    <span>前台展示</span>
                    <button
                      type="button"
                      className={editingCat.enabled ? 'on' : ''}
                      aria-label="前台展示"
                      onClick={() => setEditingCat({ ...editingCat, enabled: !editingCat.enabled })}
                    >
                      <i />
                    </button>
                  </div>
                </div>
                <div className="cat-editor-acts">
                  {editingCat.mode === 'edit' && editingCat.id != null ? (
                    <button
                      type="button"
                      className="del-link"
                      onClick={() => void deleteCategory(editingCat.id!, editingCat.origName || editingCat.name)}
                    >
                      删除分类
                    </button>
                  ) : (
                    <span />
                  )}
                  <button
                    type="button"
                    className="teal-btn"
                    disabled={catSaving}
                    style={{ height: 30, padding: '0 12px', fontSize: '.76rem' }}
                    onClick={() => void saveCategory()}
                  >
                    {catSaving ? '保存中…' : '保存'}
                  </button>
                </div>
              </div>
            ) : null}
          </aside>

          <section className="min-w-0" aria-label="商品经营列表">
            <div className="stage-toolbar">
              <label className="search">
                <Search className="h-3.5 w-3.5 text-ink-mute" />
                <input value={q} placeholder="搜索商品名、编号…" onChange={(e) => setQ(e.target.value)} />
              </label>
              <div className="toolbar-right">
                <div className="chips">
                  {(
                    [
                      ['all', '全部'],
                      ['on', '在售'],
                      ['off', '下架'],
                      ['commission', '约稿'],
                      ['cold', '滞销'],
                    ] as const
                  ).map(([id, label]) => (
                    <button key={id} type="button" className={filter === id ? 'on' : ''} onClick={() => setFilter(id)}>
                      {label}
                    </button>
                  ))}
                </div>
                <div className="view-toggle" role="group" aria-label="切换陈列视图">
                  <button type="button" className={viewMode === 'grid' ? 'on' : ''} title="书架卡片视图" onClick={() => setViewMode('grid')}>
                    <LayoutGrid className="h-3.5 w-3.5" />
                  </button>
                  <button type="button" className={viewMode === 'table' ? 'on' : ''} title="经营台账视图" onClick={() => setViewMode('table')}>
                    <Table2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>

            {catScope !== 'all' ? (
              <div className="active-scope">
                <span>
                  当前目录：<b>{catScope === 'uncat' ? '未分类' : catLabel(catScope)}</b>（{shown.length} 件 · 30 日实收{' '}
                  {yuanText(shown.reduce((a, p) => a + (earned.get(p.id) || 0), 0))}）
                </span>
                <button type="button" onClick={() => setCatScope('all')}>
                  查看全站商品
                </button>
              </div>
            ) : null}

            {!shown.length ? (
              <p className="empty">当前目录或筛选下没有匹配的商品</p>
            ) : viewMode === 'grid' ? (
              <div className="shelf-grid">
                {shown.map((p) => {
                  const money = earned.get(p.id) || 0
                  const n = ordersN.get(p.id)?.size || 0
                  const share = Math.round((money / revAll) * 100)
                  const cName = catLabel(p.category_id, p.category_name)
                  const isCom = p.sale_mode === 'commission'
                  const showCatTag = !(isCom && cName === '约稿')
                  return (
                    <article
                      key={p.id}
                      className={`book-card ${active?.id === p.id ? 'on' : ''} ${p.status === 'on' ? '' : 'off'}`}
                      onClick={() => setActiveId(p.id)}
                    >
                      <div className="book-top">
                        <div className={`book-cover ${p.cover_url ? '' : `product ${p.cover || 'p1'}`}`}>
                          {p.cover_url ? <img src={p.cover_url} alt="" /> : null}
                        </div>
                        <div className="book-meta">
                          <div className="book-tags">
                            {p.status !== 'on' ? (
                              <span className="tag mute">下架</span>
                            ) : isCom ? (
                              <span className="tag gold">约稿</span>
                            ) : (
                              <span className="tag">在售</span>
                            )}
                            {showCatTag ? <span className="tag mute">{cName}</span> : null}
                          </div>
                          <h3 className="book-title">{p.name}</h3>
                          <div className="book-price">{isCom ? `¥${p.price} / 千字` : `¥${p.price}`}</div>
                        </div>
                      </div>

                      <div className="book-stats">
                        <div>
                          30 日订单<b>{n} 笔</b>
                        </div>
                        <div>
                          30 日实收
                          <b>
                            {yuanText(money)} · {share}%
                          </b>
                        </div>
                      </div>

                      <div className="book-actions">
                        <span className="id-tag">#{p.id}</span>
                        <div className="ops">
                          <button type="button" onClick={(e) => { e.stopPropagation(); navigate(`/admin/products/${p.id}/edit`) }}>
                            编辑
                          </button>
                          <button type="button" onClick={(e) => { e.stopPropagation(); void toggleProduct(p.id) }}>
                            {p.status === 'on' ? '下架' : '上架'}
                          </button>
                          <button type="button" className="danger" onClick={(e) => { e.stopPropagation(); void removeProduct(p) }}>
                            删除
                          </button>
                        </div>
                      </div>
                    </article>
                  )
                })}
              </div>
            ) : (
              <div className="sheet-card">
                <table className="sheet">
                  <thead>
                    <tr>
                      <th></th>
                      <th>商品</th>
                      <th>价格</th>
                      <th>30 日订单</th>
                      <th>30 日实收</th>
                      <th>占比</th>
                      <th>状态</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((p) => {
                      const money = earned.get(p.id) || 0
                      const n = ordersN.get(p.id)?.size || 0
                      return (
                        <tr key={p.id} className={active?.id === p.id ? 'on' : ''} onClick={() => setActiveId(p.id)}>
                          <td>
                            {p.cover_url ? (
                              <img className="cover" src={p.cover_url} alt="" />
                            ) : (
                              <div className={`cover product ${p.cover || 'p1'}`} />
                            )}
                          </td>
                          <td>
                            <span className="name">{p.name}</span>
                            <span className="sub">
                              #{p.id} · {catLabel(p.category_id, p.category_name)}
                            </span>
                          </td>
                          <td className="mono">{p.sale_mode === 'commission' ? `¥${p.price}/k` : `¥${p.price}`}</td>
                          <td className="mono">{n}</td>
                          <td className="mono">{yuanText(money)}</td>
                          <td style={{ minWidth: 78 }}>
                            <div className={`share ${p.sale_mode === 'commission' ? 'gold' : ''}`}>
                              <i style={{ width: `${Math.round((money / revAll) * 100)}%` }} />
                            </div>
                          </td>
                          <td>
                            {p.status === 'on' ? (
                              <span className={`tag ${p.sale_mode === 'commission' ? 'gold' : ''}`}>
                                {p.sale_mode === 'commission' ? '约稿' : '在售'}
                              </span>
                            ) : (
                              <span className="tag mute">下架</span>
                            )}
                          </td>
                          <td className="ops">
                            <button type="button" onClick={(e) => { e.stopPropagation(); navigate(`/admin/products/${p.id}/edit`) }}>
                              编辑
                            </button>
                            <button type="button" onClick={(e) => { e.stopPropagation(); void toggleProduct(p.id) }}>
                              {p.status === 'on' ? '下架' : '上架'}
                            </button>
                            <button type="button" className="danger" onClick={(e) => { e.stopPropagation(); void removeProduct(p) }}>
                              删除
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <aside className="inspector" aria-label="选中商品详情">
            {active ? (
              (() => {
                const money = earned.get(active.id) || 0
                const n = ordersN.get(active.id)?.size || 0
                const share = Math.round((money / revAll) * 100)
                const bars = dailyBarsByProduct.get(active.id) || Array(14).fill(0)
                const maxBar = Math.max(1, ...bars)
                const isCom = active.sale_mode === 'commission'
                return (
                  <>
                    <div className="insp-hero">
                      <div className={`insp-cover ${active.cover_url ? '' : `product ${active.cover || 'p1'}`}`}>
                        {active.cover_url ? <img src={active.cover_url} alt="" /> : null}
                      </div>
                      <div className="min-w-0 flex-1">
                        <span className={`tag ${active.status !== 'on' ? 'mute' : isCom ? 'gold' : ''}`}>
                          {active.status !== 'on' ? '已下架' : isCom ? '约稿' : '成品'}
                        </span>
                        <h3>{active.name}</h3>
                        <div className="meta">
                          #{active.id} · {isCom ? `¥${active.price} / 千字` : `¥${active.price}`}
                        </div>
                      </div>
                    </div>

                    <div className="insp-kpis">
                      <div className="ik-box">
                        <small>30 日订单</small>
                        <b>{n} 笔</b>
                      </div>
                      <div className="ik-box">
                        <small>30 日实收</small>
                        <b>{yuanText(money)}</b>
                      </div>
                      <div className="ik-box">
                        <small>全店营收占比</small>
                        <b>{share}%</b>
                      </div>
                      <div className="ik-box">
                        <small>当前状态</small>
                        <b>{active.status === 'on' ? '前台上架' : '已下架'}</b>
                      </div>
                    </div>

                    <div className="insp-block">
                      <div className="lbl">
                        <span>归属分类（实时调换）</span>
                        <span>{catLabel(active.category_id, active.category_name)}</span>
                      </div>
                      <select
                        className="insp-cat-select"
                        value={active.category_id ?? ''}
                        onChange={(e) => void reassignCategory(active, e.target.value ? Number(e.target.value) : null)}
                      >
                        <option value="">未分类</option>
                        {categories.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                            {c.enabled ? '' : '（停用）'}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="insp-block">
                      <div className="lbl">
                        <span>近 14 日出单节奏</span>
                        <span>{n ? '有动销' : '暂无成交'}</span>
                      </div>
                      <div className="mini-bars">
                        {bars.map((v, idx) => (
                          <i
                            key={idx}
                            style={{
                              height: `${Math.max(6, Math.round((v / maxBar) * 100))}%`,
                              background: isCom ? 'var(--gold)' : 'var(--teal)',
                            }}
                          />
                        ))}
                      </div>
                    </div>

                    <div className="insp-acts">
                      <button type="button" className="teal-btn full" onClick={() => navigate(`/admin/products/${active.id}/edit`)}>
                        <Pencil className="h-3.5 w-3.5" />
                        编辑作品详情
                      </button>
                      <button type="button" className="ghost-btn" onClick={() => void toggleProduct(active.id)}>
                        {active.status === 'on' ? '下架作品' : '恢复上架'}
                      </button>
                      <button
                        type="button"
                        className="ghost-btn"
                        onClick={() => navigate(`/admin/revenue?q=${encodeURIComponent(active.name.replace(/[《》]/g, ''))}#orders`)}
                      >
                        看相关订单
                      </button>
                    </div>
                  </>
                )
              })()
            ) : (
              <p className="empty">还没有商品</p>
            )}
          </aside>
        </div>
      </div>
    </div>
  )
}

export function PanelTable({
  headers,
  children,
  empty,
  emptyText = '暂无数据',
}: {
  headers: string[]
  children: ReactNode
  empty?: boolean
  emptyText?: string
}) {
  return (
    <div className="overflow-hidden rounded-[18px] border border-[var(--line)] bg-white">
      <div className="overflow-x-auto">
        <table className="w-full text-[0.9rem]">
          <thead>
            <tr className="bg-paper text-left text-[0.78rem] font-semibold tracking-wide text-ink-mute">
              {headers.map((h) => (
                <th key={h} className="px-[18px] py-3.5">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {empty ? (
              <tr>
                <td colSpan={headers.length} className="px-[18px] py-7 text-center text-ink-mute">
                  {emptyText}
                </td>
              </tr>
            ) : (
              children
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function Tag({
  children,
  green,
  red,
  gold,
}: {
  children: ReactNode
  green?: boolean
  red?: boolean
  gold?: boolean
  gray?: boolean
}) {
  const cls = green
    ? 'bg-[rgba(15,110,92,.12)] text-teal'
    : red
      ? 'bg-[rgba(180,35,24,.1)] text-danger'
      : gold
        ? 'bg-[rgba(196,165,116,.2)] text-[#8b6b3d]'
        : 'bg-paper text-ink-mute'
  return <span className={`inline-flex rounded-md px-2 py-1 text-[0.75rem] font-semibold ${cls}`}>{children}</span>
}

export function IconBtn({
  children,
  onClick,
  title,
  danger,
}: {
  children: ReactNode
  onClick: () => void
  title?: string
  danger?: boolean
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`grid h-8 w-8 place-items-center rounded-lg border border-[var(--line)] bg-white text-ink-soft hover:border-teal hover:text-teal ${
        danger ? 'hover:!border-danger hover:!text-danger' : ''
      }`}
    >
      {children}
    </button>
  )
}
