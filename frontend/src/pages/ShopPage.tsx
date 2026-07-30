import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { useCart } from '../context/CartContext'
import { useToast } from '../context/ToastContext'
import { useAuth } from '../context/AuthContext'
import { ProductMedia } from '../components/ProductMedia'
import type { Product, ProductType } from '../types'

const FILTERS: { id: 'all' | ProductType; label: string; full?: string; icon: ReactNode }[] = [
  {
    id: 'all',
    label: '全部',
    icon: (
      <svg viewBox="0 0 24 24">
        <rect x="4" y="4" width="7" height="7" rx="1.5" />
        <rect x="13" y="4" width="7" height="7" rx="1.5" />
        <rect x="4" y="13" width="7" height="7" rx="1.5" />
        <rect x="13" y="13" width="7" height="7" rx="1.5" />
      </svg>
    ),
  },
  {
    id: 'key',
    label: '卡密',
    full: ' / 激活码',
    icon: (
      <svg viewBox="0 0 24 24">
        <circle cx="8" cy="14" r="3.5" />
        <path d="M11 14h9v3M17 14v3" />
      </svg>
    ),
  },
  {
    id: 'file',
    label: '数字文件',
    icon: (
      <svg viewBox="0 0 24 24">
        <path d="M7 3.5h7l4 4V20.5H7z" />
        <path d="M14 3.5V8h4" />
      </svg>
    ),
  },
  {
    id: 'code',
    label: '兑换码',
    icon: (
      <svg viewBox="0 0 24 24">
        <path d="M8 8l-4 4 4 4M16 8l4 4-4 4M13 6l-2 12" />
      </svg>
    ),
  },
]

export function ShopPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [filter, setFilter] = useState<'all' | ProductType>('all')
  const { addProduct } = useCart()
  const { showToast } = useToast()
  const { publicSettings } = useAuth()

  useEffect(() => {
    api.get<Product[]>('/api/products').then(setProducts).catch(() => setProducts([]))
  }, [])

  const visible = useMemo(
    () => (filter === 'all' ? products : products.filter((p) => p.type === filter)),
    [products, filter],
  )

  const unit = (t: string) => (t === 'file' ? '包' : '码')

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
                {FILTERS.map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setFilter(f.id)}
                      className={`inline-flex h-[38px] items-center gap-2 rounded-[10px] px-3.5 text-[0.9rem] font-medium transition ${
                        filter === f.id ? 'bg-ink text-white' : 'text-ink-soft hover:bg-paper hover:text-ink'
                      }`}
                    >
                      <span className="grid h-[18px] w-[18px] place-items-center [&>svg]:h-4 [&>svg]:w-4 [&>svg]:fill-none [&>svg]:stroke-current [&>svg]:stroke-[1.8]">
                        {f.icon}
                      </span>
                      {f.label}
                      {f.full && <span className="cat-full">{f.full}</span>}
                    </button>
                ))}
              </div>
            </div>

            <div className="product-grid-responsive grid grid-cols-3 gap-5">
              {visible.map((p, i) => (
                <article
                  key={p.id}
                  className={`product ${p.cover} flex min-w-0 flex-col overflow-hidden rounded-[22px] border border-[var(--line)] bg-white transition duration-300 hover:-translate-y-1 hover:border-[rgba(15,110,92,0.35)] hover:shadow-[0_18px_40px_-28px_rgba(20,32,28,0.35)]`}
                  style={{ animation: `riseIn .7s var(--ease) both`, animationDelay: `${(i % 3) * 0.08}s` }}
                >
                  <Link to={`/product/${p.id}`} className="block overflow-hidden">
                    <ProductMedia cover={p.cover} coverUrl={p.cover_url} tag={p.tag} />
                  </Link>
                  <div className="flex flex-1 flex-col gap-2.5 p-5 pb-[18px]">
                    <Link to={`/product/${p.id}`}>
                      <h3 className="font-[family-name:var(--font-display)] text-[1.15rem] tracking-[-0.02em] hover:text-teal">{p.name}</h3>
                    </Link>
                    <p className="flex-1 text-[0.9rem] leading-relaxed text-ink-soft line-clamp-3">{p.desc}</p>
                    <div className="mt-1 flex items-center justify-between gap-3">
                      <div className="font-[family-name:var(--font-display)] text-[1.35rem] font-bold tracking-tight">
                        ¥{p.price}
                        <small className="ml-0.5 text-[0.78rem] font-medium text-ink-mute">/{unit(p.type)}</small>
                      </div>
                      <div className="flex gap-2">
                        <Link
                          to={`/product/${p.id}`}
                          className="inline-flex h-10 items-center rounded-xl border border-[var(--line-strong)] bg-white px-3 text-[0.82rem] font-semibold text-ink-soft hover:border-teal hover:text-teal"
                        >
                          详情
                        </Link>
                        <button
                          type="button"
                          className="h-10 rounded-xl bg-ink px-4 text-[0.88rem] font-semibold text-white transition hover:bg-teal-deep"
                          onClick={() => {
                            addProduct(p)
                            showToast('已加入领取匣：' + p.name)
                          }}
                        >
                          <span className="buy-full">购买</span>
                          <span className="buy-short">买</span>
                        </button>
                      </div>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="trust" className="pb-[88px]">
          <div className="wrap">
            <div className="flex flex-col gap-8 rounded-[24px] border border-[var(--line)] bg-white/70 p-8 md:flex-row md:items-center md:justify-between md:p-10">
              <div className="max-w-md">
                <h2 className="mb-3 font-[family-name:var(--font-display)] text-[clamp(1.6rem,3vw,2.1rem)] tracking-[-0.03em]">
                  虚拟货也有交付保障
                </h2>
                <p className="text-ink-soft leading-relaxed">演示页展示售卖与自动发货体验。正式环境可对接支付与库存 API。</p>
              </div>
              <ul className="grid gap-3">
                {['付款成功即锁定库存，避免超卖', '卡密脱敏展示，仅买家可见完整内容', '文件链接可设有效期与下载次数'].map((t) => (
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
          <span>© 2026 领匣 Lingxia · Demo</span>
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
