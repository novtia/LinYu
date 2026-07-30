import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ApiError, api } from '../lib/api'
import { useCart } from '../context/CartContext'
import { useToast } from '../context/ToastContext'
import { ProductMedia } from '../components/ProductMedia'
import type { Product } from '../types'

const TYPE_LABEL: Record<string, string> = { key: '卡密 / 激活码', file: '数字文件', code: '兑换码' }
const unit = (t: string) => (t === 'file' ? '包' : '码')

export function ProductDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [product, setProduct] = useState<Product | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const { addProduct } = useCart()
  const { showToast } = useToast()
  const navigate = useNavigate()

  useEffect(() => {
    if (!id) return
    setLoading(true)
    api
      .get<Product>(`/api/products/${id}`)
      .then(setProduct)
      .catch((e) => setError(e instanceof ApiError ? e.message : '商品不存在'))
      .finally(() => setLoading(false))
  }, [id])

  if (loading) {
    return <div className="wrap py-20 text-center text-ink-mute">加载中…</div>
  }

  if (error || !product) {
    return (
      <div className="wrap py-20 text-center">
        <p className="mb-4 text-ink-mute">{error || '商品不存在'}</p>
        <Link to="/" className="font-semibold text-teal hover:underline">
          返回商城
        </Link>
      </div>
    )
  }

  return (
    <main className="pb-20 pt-8">
      <div className="wrap">
        <button type="button" onClick={() => navigate(-1)} className="mb-6 text-[0.9rem] text-ink-soft hover:text-teal">
          ← 返回
        </button>
        <div className="grid gap-8 md:grid-cols-[1.1fr_1fr] md:items-start">
          <div className="overflow-hidden rounded-[24px] border border-[var(--line)] bg-white">
            <ProductMedia cover={product.cover} coverUrl={product.cover_url} tag={product.tag} aspectClass="aspect-[16/10] md:aspect-[4/3]" />
          </div>
          <div>
            <div className="mb-3 inline-flex rounded-lg bg-paper px-2.5 py-1 text-[0.78rem] font-semibold text-ink-soft">
              {TYPE_LABEL[product.type] || product.type}
            </div>
            <h1 className="mb-3 font-[family-name:var(--font-display)] text-[clamp(1.8rem,3vw,2.4rem)] font-extrabold tracking-[-0.03em]">
              {product.name}
            </h1>
            <p className="mb-6 text-[1.02rem] leading-relaxed text-ink-soft">{product.desc}</p>
            <div className="mb-8 flex items-end gap-2">
              <span className="font-[family-name:var(--font-display)] text-4xl font-bold tracking-tight text-ink">¥{product.price}</span>
              <span className="pb-1 text-ink-mute">/{unit(product.type)}</span>
            </div>
            {product.type === 'file' && (
              <div className="mb-6 rounded-xl border border-[var(--line)] bg-white/80 px-4 py-3 text-[0.88rem] text-ink-soft">
                {product.has_file ? (
                  <>付款后可下载：<span className="font-[family-name:var(--font-mono)] text-teal">{product.file_name}</span></>
                ) : (
                  '该文件商品暂未上传源文件，请联系管理员。'
                )}
              </div>
            )}
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                className="h-12 rounded-xl bg-teal px-7 text-[0.95rem] font-semibold text-white transition hover:bg-teal-deep"
                onClick={() => {
                  addProduct(product)
                  showToast('已加入领取匣：' + product.name)
                }}
              >
                加入领取匣
              </button>
              <Link
                to="/#shop"
                className="inline-flex h-12 items-center rounded-xl border border-[var(--line-strong)] bg-white px-5 text-[0.95rem] font-semibold text-ink-soft hover:border-teal hover:text-teal"
              >
                继续浏览
              </Link>
            </div>
            <ul className="mt-10 grid gap-3 text-[0.9rem] text-ink-soft">
              {['付款成功自动发货', '卡密 / 文件仅买家可见', '支持在「我的订单」随时查看'].map((t) => (
                <li key={t} className="flex items-center gap-2">
                  <span className="grid h-5 w-5 place-items-center rounded-full bg-[rgba(15,110,92,.12)] text-[0.7rem] text-teal">✓</span>
                  {t}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </main>
  )
}
