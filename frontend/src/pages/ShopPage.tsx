import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { useCart } from '../context/CartContext'
import { useToast } from '../context/ToastContext'
import { useAuth } from '../context/AuthContext'
import { ProductMedia } from '../components/ProductMedia'
import type { Category, Product } from '../types'

function useShopColumns() {
  const [cols, setCols] = useState(3)
  useEffect(() => {
    const update = () => {
      const w = window.innerWidth
      setCols(w <= 640 ? 1 : w <= 900 ? 2 : 3)
    }
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])
  return cols
}

export function ShopPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [filter, setFilter] = useState<number | 'all'>('all')
  const { addProduct } = useCart()
  const { showToast } = useToast()
  const { publicSettings } = useAuth()
  const cols = useShopColumns()

  useEffect(() => {
    api
      .get<Product[]>('/api/products')
      .then(setProducts)
      .catch(() => {
        setProducts([])
        showToast('商品加载失败，请稍后刷新重试')
      })
    api.get<Category[]>('/api/categories').then(setCategories).catch(() => setCategories([]))
  }, [])

  const visible = useMemo(
    () => (filter === 'all' ? products : products.filter((p) => p.category_id === filter)),
    [products, filter],
  )

  const fillerCount = Math.max(0, cols * 2 - visible.length)

  return (
    <>
      <main id="top">
        {publicSettings?.notice && (
          <div className="wrap pt-6">
            <div className="rounded-xl border border-[var(--line)] bg-white/70 px-4 py-3 text-[0.88rem] text-ink-soft">
              {publicSettings.notice}
            </div>
          </div>
        )}
        <section id="shop" className="py-[88px]">
          <div className="wrap">
            <div className="mb-7 flex flex-wrap items-center gap-2 rounded-[14px] border border-[var(--line)] bg-white/62 p-3">
              <div className="flex flex-1 flex-wrap gap-2" role="tablist" aria-label="商品分类">
                <button
                  type="button"
                  onClick={() => setFilter('all')}
                  className={`inline-flex h-[38px] items-center gap-2 rounded-[10px] px-3.5 text-[0.9rem] font-medium transition ${
                    filter === 'all' ? 'bg-ink text-white' : 'text-ink-soft hover:bg-paper hover:text-ink'
                  }`}
                >
                  全部
                </button>
                {categories.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setFilter(c.id)}
                    className={`inline-flex h-[38px] items-center gap-2 rounded-[10px] px-3.5 text-[0.9rem] font-medium transition ${
                      filter === c.id ? 'bg-ink text-white' : 'text-ink-soft hover:bg-paper hover:text-ink'
                    }`}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            </div>

            <div className="product-list-shell relative">
              <div className="product-grid-responsive grid grid-cols-3 gap-5">
                {visible.map((p, i) => (
                  <article
                    key={p.id}
                    className={`product ${p.cover} flex min-w-0 flex-col overflow-hidden rounded-[22px] border border-[var(--line)] bg-white transition duration-300 hover:-translate-y-1 hover:border-[rgba(15,110,92,0.35)] hover:shadow-[0_18px_40px_-28px_rgba(20,32,28,0.35)]`}
                    style={{ animation: `riseIn .7s var(--ease) both`, animationDelay: `${(i % 3) * 0.08}s` }}
                  >
                    <Link to={`/product/${p.id}`} className="block overflow-hidden">
                      <ProductMedia cover={p.cover} coverUrl={p.cover_url} tag={p.category_name || undefined} />
                    </Link>
                    <div className="flex flex-1 flex-col gap-2.5 p-5 pb-[18px]">
                      <Link to={`/product/${p.id}`}>
                        <h3 className="font-[family-name:var(--font-display)] text-[1.15rem] tracking-[-0.02em] hover:text-teal">{p.name}</h3>
                      </Link>
                      <p className="flex-1 text-[0.9rem] leading-relaxed text-ink-soft line-clamp-3">{p.desc}</p>
                      <div className="mt-1 flex items-center justify-between gap-3">
                        <div className="font-[family-name:var(--font-display)] text-[1.35rem] font-bold tracking-tight">
                          {p.sale_mode === 'commission' ? `¥${p.price}/k` : `¥${p.price}`}
                        </div>
                        <div className="flex gap-2">
                          <Link
                            to={`/product/${p.id}`}
                            className="inline-flex h-10 items-center rounded-xl border border-[var(--line-strong)] bg-white px-3 text-[0.82rem] font-semibold text-ink-soft hover:border-teal hover:text-teal"
                          >
                            详情
                          </Link>
                          {p.sale_mode === 'commission' ? (
                            <Link
                              to={`/product/${p.id}`}
                              className="inline-flex h-10 items-center rounded-xl bg-ink px-4 text-[0.88rem] font-semibold text-white transition hover:bg-teal-deep"
                            >
                              约稿
                            </Link>
                          ) : (
                            <button
                              type="button"
                              className="h-10 rounded-xl bg-ink px-4 text-[0.88rem] font-semibold text-white transition hover:bg-teal-deep"
                              onClick={() => {
                                addProduct(p)
                                showToast('已加入购物车：' + p.name)
                              }}
                            >
                              <span className="buy-full">加入购物车</span>
                              <span className="buy-short">加购</span>
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </article>
                ))}
                {Array.from({ length: fillerCount }, (_, i) => (
                  <div
                    key={`filler-${i}`}
                    className="product-slot-filler overflow-hidden rounded-[22px] border border-transparent"
                    aria-hidden
                  >
                    <div className="aspect-[16/10]" />
                    <div className="flex flex-col gap-2.5 p-5 pb-[18px]">
                      <div className="h-[1.4rem]" />
                      <div className="h-[4.4rem]" />
                      <div className="mt-1 h-10" />
                    </div>
                  </div>
                ))}
              </div>

              {!visible.length && (
                <div className="absolute inset-0 grid place-items-center text-[0.95rem] text-ink-mute">暂无商品</div>
              )}
            </div>
          </div>
        </section>

        <section id="trust" className="pb-[88px]">
          <div className="wrap">
            <div className="flex flex-col gap-8 rounded-[24px] border border-[var(--line)] bg-white/70 p-8 md:flex-row md:items-center md:justify-between md:p-10">
              <div className="max-w-md">
                <h2 className="mb-3 font-[family-name:var(--font-display)] text-[clamp(1.6rem,3vw,2.1rem)] tracking-[-0.03em]">
                  付款即发，买得放心
                </h2>
                <p className="text-ink-soft leading-relaxed">
                  虚拟商品一站选购。支付成功后内容会立刻送到你的订单，随时查看、随时下载。
                </p>
              </div>
              <ul className="grid gap-3">
                {[
                  '支付成功立即发货，无需等待人工处理',
                  '发货内容仅你可见，隐私有保障',
                  '已购内容可在「我的订单」随时查看',
                ].map((t) => (
                  <li key={t} className="flex items-center gap-3 text-[0.95rem] text-ink-soft">
                    <i className="grid h-7 w-7 place-items-center rounded-full bg-[rgba(15,110,92,.12)] text-teal">
                      <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current stroke-[2]">
                        <path d="M5 12l5 5L20 7" />
                      </svg>
                    </i>
                    <span>{t}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-[var(--line)] py-6">
        <div className="wrap flex flex-wrap items-center justify-between gap-3 text-[0.85rem] text-ink-mute">
          <span>© 2026 领匣 Lingxia</span>
          <div className="flex gap-4">
            <a href="#shop">商品</a>
            <a href="#trust">保障</a>
            <a href="#top">回到顶部</a>
          </div>
        </div>
      </footer>
    </>
  )
}
