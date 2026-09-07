import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import {
  Archive,
  ArrowUpRight,
  BookOpen,
  Megaphone,
  PenLine,
  Plus,
  ShieldCheck,
  Star,
  Zap,
} from 'lucide-react'
import { api } from '../lib/api'
import { useCart } from '../context/CartContext'
import { useToast } from '../context/ToastContext'
import { useAuth } from '../context/AuthContext'
import { commissionTotal, isCommissionProduct } from '../lib/commission'
import { coverGlyph, splitMoney } from '../lib/orderDisplay'
import type { Category, Product } from '../types'

type ShopFilter = 'all' | 'commission' | number

const QUOTE_SAMPLES = [
  { label: '短篇 · 8,000 字', words: 8000 },
  { label: '中篇 · 15,000 字', words: 15000 },
  { label: '长篇 · 30,000 字', words: 30000 },
]

const FALLBACK_HERO = [
  { tone: 'p2', glyph: '匣', tag: '定制约稿' },
  { tone: 'p1', glyph: '深', tag: '作品' },
  { tone: 'p5', glyph: '雨', tag: '作品' },
]

function coverClass(p: Product) {
  return /^p[1-6]$/.test(p.cover || '') ? p.cover : 'p1'
}

function heroCovers(products: Product[]) {
  const picks: { tone: string; glyph: string; tag: string }[] = []
  const comm = products.find(isCommissionProduct)
  if (comm) picks.push({ tone: 'p2', glyph: coverGlyph(comm.name), tag: '定制约稿' })
  for (const p of products) {
    if (picks.length >= 3) break
    if (isCommissionProduct(p)) continue
    picks.push({
      tone: coverClass(p),
      glyph: coverGlyph(p.name),
      tag: p.category_name || '作品',
    })
  }
  while (picks.length < 3) picks.push(FALLBACK_HERO[picks.length])
  return picks.slice(0, 3)
}

export function ShopPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [filter, setFilter] = useState<ShopFilter>('all')
  const [loaded, setLoaded] = useState(false)
  const { addProduct } = useCart()
  const { showToast } = useToast()
  const { publicSettings } = useAuth()
  const { hash } = useLocation()

  useEffect(() => {
    let alive = true
    Promise.all([api.get<Product[]>('/api/products'), api.get<Category[]>('/api/categories')])
      .then(([list, cats]) => {
        if (!alive) return
        setProducts(list)
        setCategories(cats)
      })
      .catch(() => {
        if (!alive) return
        setProducts([])
        setCategories([])
        showToast('商品加载失败，请稍后刷新重试')
      })
      .finally(() => {
        if (alive) setLoaded(true)
      })
    return () => {
      alive = false
    }
  }, [showToast])

  useEffect(() => {
    if (!hash) return
    const id = hash.replace('#', '')
    const jump = () => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })
    const t = window.setTimeout(jump, loaded ? 50 : 200)
    return () => window.clearTimeout(t)
  }, [hash, loaded])

  const commissionProduct = useMemo(() => products.find(isCommissionProduct) || null, [products])
  const covers = useMemo(() => heroCovers(products), [products])
  const featuredId = useMemo(() => products.find((p) => !isCommissionProduct(p))?.id ?? null, [products])
  const hasCommissionCategory = categories.some((c) => /约稿/.test(c.name))

  const counts = useMemo(() => {
    const byCat: Record<number, number> = {}
    for (const c of categories) byCat[c.id] = 0
    let commission = 0
    for (const p of products) {
      if (isCommissionProduct(p)) commission += 1
      if (p.category_id != null) byCat[p.category_id] = (byCat[p.category_id] || 0) + 1
    }
    return { all: products.length, commission, byCat }
  }, [products, categories])

  const visible = useMemo(() => {
    if (filter === 'all') return products
    if (filter === 'commission') return products.filter(isCommissionProduct)
    return products.filter((p) => p.category_id === filter)
  }, [products, filter])

  return (
    <>
      <main id="top">
        <section className="pt-12 pb-[60px] md:pt-16">
          <div className="wrap grid items-center gap-12 max-[980px]:gap-5 min-[981px]:grid-cols-[minmax(0,1.05fr)_minmax(0,.95fr)]">
            <div>
              <p className="mb-[18px] inline-flex items-center gap-2 font-[family-name:var(--font-mono)] text-[0.7rem] font-bold tracking-[0.16em] text-teal before:block before:h-[1.5px] before:w-[22px] before:bg-teal">
                DIGITAL FICTION STORE
              </p>
              <h1 className="mb-[18px] font-[family-name:var(--font-display)] text-[clamp(2.5rem,5.4vw,3.9rem)] font-extrabold leading-[1.08] tracking-[-0.05em]">
                好故事，
                <br />
                装进<span className="text-teal">匣子</span>带走。
              </h1>
              <p className="mb-7 max-w-[42ch] text-[0.96rem] leading-[1.85] text-ink-mute">
                完结长篇、短篇合集与定制约稿。支付成功即刻发货，发放内容仅你可见，随时在订单中重新下载。
              </p>
              <div className="flex flex-wrap gap-3">
                <a
                  href="#shop"
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-[13px] bg-teal px-6 text-[0.94rem] font-bold text-white transition hover:-translate-y-px hover:bg-teal-deep"
                >
                  <BookOpen className="h-[15px] w-[15px]" strokeWidth={1.8} />
                  选购作品
                </a>
                {commissionProduct ? (
                  <a
                    href="#commission"
                    className="inline-flex h-12 items-center gap-2 rounded-[13px] border border-[var(--line-strong)] bg-white/60 px-[22px] text-[0.92rem] font-semibold text-ink transition hover:border-ink hover:bg-white"
                  >
                    <PenLine className="h-[15px] w-[15px]" strokeWidth={1.8} />
                    定制约稿
                  </a>
                ) : null}
              </div>
              <div className="mt-11 flex border-t border-[var(--line)] pt-5">
                <div>
                  <b className="block font-[family-name:var(--font-display)] text-[1.65rem] font-extrabold leading-none tracking-[-0.04em]">
                    {products.length}
                  </b>
                  <span className="mt-[7px] block text-[0.74rem] text-ink-mute">在售作品</span>
                </div>
                <div className="ml-7 border-l border-[var(--line)] pl-7 max-[640px]:ml-[18px] max-[640px]:pl-[18px]">
                  {commissionProduct ? (
                    <>
                      <b className="block font-[family-name:var(--font-display)] text-[1.65rem] font-extrabold leading-none tracking-[-0.04em]">
                        50<small className="ml-0.5 text-[0.85rem] tracking-normal text-ink-mute">%</small>
                      </b>
                      <span className="mt-[7px] block text-[0.74rem] text-ink-mute">约稿定金</span>
                    </>
                  ) : (
                    <>
                      <b className="block font-[family-name:var(--font-display)] text-[1.65rem] font-extrabold leading-none tracking-[-0.04em]">
                        隐私
                      </b>
                      <span className="mt-[7px] block text-[0.74rem] text-ink-mute">仅买家可见</span>
                    </>
                  )}
                </div>
                <div className="ml-7 border-l border-[var(--line)] pl-7 max-[640px]:ml-[18px] max-[640px]:pl-[18px]">
                  <b className="block font-[family-name:var(--font-display)] text-[1.65rem] font-extrabold leading-none tracking-[-0.04em]">
                    即发
                  </b>
                  <span className="mt-[7px] block text-[0.74rem] text-ink-mute">支付成功发货</span>
                </div>
              </div>
            </div>
            <div className="hero-art" aria-hidden>
              {covers.map((c, i) => (
                <i key={`${c.glyph}-${i}`} className={`hc hc${i + 1} ${c.tone}`}>
                  <s>{c.glyph}</s>
                  <span className="hc-tag">{c.tag}</span>
                </i>
              ))}
            </div>
          </div>
        </section>

        {publicSettings?.notice ? (
          <div className="wrap">
            <a href="#shop" className="shop-notice">
              <Megaphone className="h-[15px] w-[15px] shrink-0 text-teal" strokeWidth={1.8} />
              <span className="shrink-0 rounded-md border border-[rgba(15,110,92,.35)] px-[7px] py-[3px] font-[family-name:var(--font-mono)] text-[0.66rem] font-bold tracking-[0.12em] text-teal">
                公告
              </span>
              <p>{publicSettings.notice}</p>
              <ArrowUpRight className="ml-auto h-[15px] w-[15px] shrink-0 text-ink-mute" strokeWidth={1.8} />
            </a>
          </div>
        ) : null}

        <section className="shop-section pt-16 pb-[30px]" id="shop">
          <div className="wrap">
            <div className="flex items-baseline justify-between gap-4 border-b border-[var(--line)] max-[760px]:flex-col max-[760px]:items-stretch">
              <h2 className="m-0 pb-3.5 font-[family-name:var(--font-display)] text-[clamp(1.5rem,2.6vw,1.9rem)] tracking-[-0.035em]">
                全部作品
                <small className="ml-3 font-[family-name:var(--font-body)] text-[0.78rem] font-medium text-ink-mute">
                  {visible.length} 件在售
                </small>
              </h2>
              <div className="flex gap-6 overflow-x-auto" role="tablist" aria-label="商品分类">
                <FilterTab id="all" label="全部" count={counts.all} on={filter === 'all'} onClick={() => setFilter('all')} />
                {categories.map((c) => (
                  <FilterTab
                    key={c.id}
                    id={String(c.id)}
                    label={c.name}
                    count={counts.byCat[c.id] || 0}
                    on={filter === c.id}
                    onClick={() => setFilter(c.id)}
                  />
                ))}
                {counts.commission && !hasCommissionCategory ? (
                  <FilterTab
                    id="commission"
                    label="约稿"
                    count={counts.commission}
                    on={filter === 'commission'}
                    onClick={() => setFilter('commission')}
                  />
                ) : null}
              </div>
            </div>

            {visible.length ? (
              <div className="shop-grid">
                {visible.map((p, i) => (
                  <ProductCard
                    key={p.id}
                    product={p}
                    featured={filter === 'all' && p.id === featuredId && visible.length >= 3}
                    delay={i * 50}
                    onAdd={() => {
                      addProduct(p)
                      showToast('已加入购物车：' + p.name)
                    }}
                  />
                ))}
              </div>
            ) : (
              <div className="mt-[30px] rounded-[20px] border border-dashed border-[var(--line-strong)] px-5 py-14 text-center text-[0.88rem] text-ink-mute">
                {loaded ? '该分类暂无作品，看看其他分类吧' : '加载中…'}
              </div>
            )}
          </div>
        </section>

        {commissionProduct ? (
          <section className="py-[60px]" id="commission">
            <div className="wrap">
              <div className="cm-panel">
                <div className="cm-inner">
                  <div>
                    <p className="mb-3.5 flex items-center gap-2 font-[family-name:var(--font-mono)] text-[0.68rem] font-bold tracking-[0.18em] text-mint before:block before:h-[1.5px] before:w-[22px] before:bg-mint">
                      COMMISSION STUDIO
                    </p>
                    <h2 className="mb-3.5 font-[family-name:var(--font-display)] text-[clamp(1.8rem,3.4vw,2.5rem)] font-extrabold leading-[1.15] tracking-[-0.04em]">
                      想看的剧情，
                      <br />
                      我来写。
                    </h2>
                    <p className="m-0 max-w-[44ch] text-[0.9rem] leading-[1.85] text-[rgba(238,248,244,.62)]">
                      长篇定制、番外续写、CP 点梗，按字数计价。定金开工，交稿满意后付尾款，全程一对一对话沟通。
                    </p>
                    <ol className="cm-steps">
                      <li>
                        <i>1</i>付定金
                      </li>
                      <li>
                        <i>2</i>创作交稿
                      </li>
                      <li>
                        <i>3</i>付尾款
                      </li>
                      <li>
                        <i>4</i>收稿下载
                      </li>
                    </ol>
                    <div className="mt-[30px] flex flex-wrap gap-3">
                      <Link
                        to={`/product/${commissionProduct.id}`}
                        className="inline-flex h-[46px] items-center gap-2 rounded-xl bg-mint px-[22px] text-[0.9rem] font-extrabold text-ink transition hover:-translate-y-px hover:bg-[#9be3cb]"
                      >
                        <PenLine className="h-[15px] w-[15px]" strokeWidth={1.8} />
                        发起约稿
                      </Link>
                      <Link
                        to={`/product/${commissionProduct.id}`}
                        className="inline-flex h-[46px] items-center gap-2 rounded-xl border border-[rgba(238,248,244,.3)] px-5 text-[0.88rem] font-semibold text-[rgba(238,248,244,.85)] transition hover:border-mint hover:text-white"
                      >
                        了解流程
                      </Link>
                    </div>
                  </div>
                  <div className="quote-card">
                    <p className="mb-1.5 font-[family-name:var(--font-mono)] text-[0.66rem] font-bold tracking-[0.16em] text-mint">
                      报价示例 · QUOTE
                    </p>
                    {QUOTE_SAMPLES.map((q) => (
                      <div key={q.words} className="q-row">
                        <span>{q.label}</span>
                        <b>{formatQuote(commissionTotal(commissionProduct.price, q.words))}</b>
                      </div>
                    ))}
                    <div className="mt-3 border-t border-dashed border-[rgba(238,248,244,.2)] pt-3 text-[0.72rem] text-[rgba(238,248,244,.5)]">
                      定金 50% 开工 · {formatQuote(commissionProduct.price)}/k
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>
        ) : null}

        <section className="trust pt-2.5 pb-[70px]" id="trust">
          <div className="wrap">
            <div className="trust-grid">
              <div className="t-item">
                <i className="mb-3.5 grid h-[38px] w-[38px] place-items-center rounded-[11px] bg-[rgba(15,110,92,.1)] text-teal">
                  <Zap className="h-[17px] w-[17px]" strokeWidth={1.8} />
                </i>
                <b className="block text-[0.95rem] tracking-[-0.01em]">支付即发</b>
                <span className="mt-1.5 block text-[0.8rem] leading-[1.7] text-ink-mute">
                  支付成功立即发货，无需等待人工处理，凌晨下单也能秒收。
                </span>
              </div>
              <div className="t-item">
                <i className="mb-3.5 grid h-[38px] w-[38px] place-items-center rounded-[11px] bg-[rgba(15,110,92,.1)] text-teal">
                  <ShieldCheck className="h-[17px] w-[17px]" strokeWidth={1.8} />
                </i>
                <b className="block text-[0.95rem] tracking-[-0.01em]">隐私保障</b>
                <span className="mt-1.5 block text-[0.8rem] leading-[1.7] text-ink-mute">
                  发放内容仅你本人可见，邮箱查询订单也不会泄露购买明细。
                </span>
              </div>
              <div className="t-item">
                <i className="mb-3.5 grid h-[38px] w-[38px] place-items-center rounded-[11px] bg-[rgba(15,110,92,.1)] text-teal">
                  <Archive className="h-[17px] w-[17px]" strokeWidth={1.8} />
                </i>
                <b className="block text-[0.95rem] tracking-[-0.01em]">随时取阅</b>
                <span className="mt-1.5 block text-[0.8rem] leading-[1.7] text-ink-mute">
                  已购内容永久保存在「我的订单」，换设备也能重新下载。
                </span>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-[var(--line)] py-[26px] pb-[30px]">
        <div className="wrap flex flex-wrap items-center justify-between gap-3 text-[0.8rem] text-ink-mute">
          <span className="inline-flex items-center gap-2 font-semibold text-ink-soft">
            <span className="brand-mark !h-5 !w-5 !rounded-md" aria-hidden />
            © 2026 {publicSettings?.name || '领匣'} Lingxia
          </span>
          <div className="flex gap-5">
            <a href="#shop" className="hover:text-teal">
              商品
            </a>
            {commissionProduct ? (
              <a href="#commission" className="hover:text-teal">
                约稿
              </a>
            ) : null}
            <Link to="/orders" className="hover:text-teal">
              我的订单
            </Link>
            <a href="#top" className="hover:text-teal">
              回到顶部
            </a>
          </div>
          <span className="font-[family-name:var(--font-mono)] text-[0.72rem]">xingx.shop</span>
        </div>
      </footer>
    </>
  )
}

function formatQuote(n: number) {
  const { head, frac } = splitMoney(n)
  return `¥${head}${frac}`
}

function FilterTab({
  id,
  label,
  count,
  on,
  onClick,
}: {
  id: string
  label: string
  count: number
  on: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={on}
      id={`tab-${id}`}
      onClick={onClick}
      className={`relative inline-flex h-[46px] shrink-0 items-center gap-1.5 bg-transparent px-0.5 text-[0.86rem] font-semibold ${
        on ? 'text-ink after:absolute after:right-0 after:bottom-[-1px] after:left-0 after:h-0.5 after:bg-ink' : 'text-ink-mute hover:text-ink'
      }`}
    >
      {label}
      <span className="font-[family-name:var(--font-mono)] text-[0.7rem] opacity-55">{count}</span>
    </button>
  )
}

function ProductCard({
  product,
  featured,
  delay,
  onAdd,
}: {
  product: Product
  featured: boolean
  delay: number
  onAdd: () => void
}) {
  const commission = isCommissionProduct(product)
  const money = splitMoney(product.price)
  const tag = commission ? '定制约稿' : product.category_name || '作品'

  return (
    <article className={`shop-card ${featured ? 'feat' : ''}`} style={{ animationDelay: `${delay}ms` }}>
      <Link to={`/product/${product.id}`} className="block min-w-0">
        <ShopCover product={product} tag={tag} featured={featured} commission={commission} />
      </Link>
      <div className={`flex min-w-0 flex-1 flex-col ${featured ? 'px-[26px] py-6' : 'px-5 pt-[18px] pb-[18px]'}`}>
        {featured ? (
          <span className="mb-3 inline-flex items-center gap-1.5 font-[family-name:var(--font-mono)] text-[0.66rem] font-bold tracking-[0.14em] text-[#8a6a2f]">
            EDITOR&apos;S PICK
          </span>
        ) : null}
        <h3 className={`m-0 font-[family-name:var(--font-display)] tracking-[-0.02em] ${featured ? 'text-[1.55rem] tracking-[-0.03em]' : 'text-[1.12rem]'}`}>
          <Link to={`/product/${product.id}`} className="hover:text-teal">
            {product.name}
          </Link>
        </h3>
        <p
          className={`mt-2 mb-0 flex-1 text-ink-soft ${featured ? 'line-clamp-3 text-[0.9rem]' : 'line-clamp-2 text-[0.86rem]'} leading-[1.7]`}
        >
          {product.desc || (commission ? '长篇定制、番外续写、CP 点梗，按字数计价。定金开工，交稿后付尾款。' : '支付成功后自动发货。')}
        </p>
        <div className="meta-row mt-3.5 flex items-center gap-2 font-[family-name:var(--font-mono)] text-[0.68rem] tracking-[0.02em] text-ink-mute">
          {commission ? (
            <>
              按字计价
              <span className="sep inline-block h-[3px] w-[3px] rounded-full bg-[var(--line-strong)]" />
              全程对话沟通
            </>
          ) : (
            <>
              {tag}
              {product.cover_url ? (
                <>
                  <span className="sep inline-block h-[3px] w-[3px] rounded-full bg-[var(--line-strong)]" />
                  数字下载
                </>
              ) : (
                <>
                  <span className="sep inline-block h-[3px] w-[3px] rounded-full bg-[var(--line-strong)]" />
                  支付即发
                </>
              )}
            </>
          )}
        </div>
        <div className="mt-3 flex items-center justify-between gap-3 border-t border-[var(--line)] pt-3.5">
          <span className="font-[family-name:var(--font-display)] text-[1.35rem] font-extrabold tracking-[-0.035em]">
            ¥{money.head}
            <small className="text-[0.78rem] font-bold tracking-normal text-ink-mute">
              {money.frac}
              {commission ? '/k' : ''}
            </small>
          </span>
          <div className="flex gap-2">
            {commission ? (
              <Link
                to={`/product/${product.id}`}
                className="inline-flex h-[38px] items-center gap-1.5 rounded-[10px] bg-teal px-4 text-[0.84rem] font-bold text-white transition hover:bg-teal-deep"
              >
                <PenLine className="h-[13px] w-[13px]" strokeWidth={1.8} />
                约稿
              </Link>
            ) : (
              <>
                <Link
                  to={`/product/${product.id}`}
                  className="inline-flex h-[38px] items-center rounded-[10px] border border-[var(--line-strong)] px-3.5 text-[0.82rem] font-semibold text-ink-soft transition hover:border-teal hover:text-teal"
                >
                  详情
                </Link>
                <button
                  type="button"
                  className="inline-flex h-[38px] items-center gap-1.5 rounded-[10px] bg-ink px-4 text-[0.84rem] font-bold text-white transition hover:bg-teal-deep"
                  onClick={onAdd}
                >
                  <Plus className="h-[13px] w-[13px]" strokeWidth={1.8} />
                  加购
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </article>
  )
}

function ShopCover({
  product,
  tag,
  featured,
  commission,
}: {
  product: Product
  tag: string
  featured: boolean
  commission: boolean
}) {
  if (commission) {
    return (
      <div className="shop-cover commission-cover">
        <span className="c-ico">
          <PenLine className="h-[34px] w-[34px]" strokeWidth={1.6} />
        </span>
        <span className="c-tag">{tag}</span>
      </div>
    )
  }
  return (
    <div className={`shop-cover ${coverClass(product)} ${product.cover_url ? 'has-img' : ''}`}>
      {product.cover_url ? (
        <img src={product.cover_url} alt="" className="absolute inset-0 h-full w-full object-cover" />
      ) : null}
      {featured ? (
        <span className="feat-badge">
          <Star className="h-[11px] w-[11px]" strokeWidth={1.8} />
          本周主推
        </span>
      ) : null}
      <span className="c-tag">{tag}</span>
      {product.cover_url ? null : <span className="c-big">{coverGlyph(product.name)}</span>}
    </div>
  )
}
