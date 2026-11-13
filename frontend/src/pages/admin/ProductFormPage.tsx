import { useEffect, useRef, useState, type DragEvent, type FormEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { ApiError, api } from '../../lib/api'
import { useToast } from '../../context/ToastContext'
import { CoverCropModal } from '../../components/CoverCropModal'
import { MarkdownContent } from '../../components/MarkdownContent'
import { ProductFilePicker } from '../../components/ProductFilePicker'
import { formatYuan, splitPrice } from '../../lib/commission'
import type { Category, Product, ProductFileItem } from '../../types'

const COVERS = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6']
const MAX_COVER_BYTES = 5 * 1024 * 1024

function isImageName(name: string) {
  return /\.(png|jpe?g|gif|webp|bmp)$/i.test(name)
}

export function ProductFormPage() {
  const { id } = useParams<{ id: string }>()
  const [searchParams] = useSearchParams()
  const isEdit = Boolean(id)
  const navigate = useNavigate()
  const { showToast } = useToast()
  const coverRef = useRef<HTMLInputElement>(null)

  const [categories, setCategories] = useState<Category[]>([])
  const [form, setForm] = useState({
    name: '',
    price: '',
    cover: 'p1',
    cover_url: '' as string,
    desc: '',
    delivery_content: '',
    status: 'on',
    category_id: searchParams.get('cat') || '',
    sale_mode: 'normal' as 'normal' | 'commission',
  })
  const [files, setFiles] = useState<ProductFileItem[]>([])
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [pendingCover, setPendingCover] = useState<File | null>(null)
  const [coverPreviewUrl, setCoverPreviewUrl] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(isEdit)
  const [draggingCover, setDraggingCover] = useState(false)
  const [cropSrc, setCropSrc] = useState<string | null>(null)
  const [cropName, setCropName] = useState('cover.jpg')
  const [textTab, setTextTab] = useState<'edit' | 'preview'>('edit')

  useEffect(() => {
    return () => {
      if (cropSrc) URL.revokeObjectURL(cropSrc)
    }
  }, [cropSrc])

  useEffect(() => {
    if (!pendingCover) {
      setCoverPreviewUrl(null)
      return
    }
    const url = URL.createObjectURL(pendingCover)
    setCoverPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [pendingCover])

  useEffect(() => {
    api
      .get<Category[]>('/api/categories/admin')
      .then(setCategories)
      .catch(() => setCategories([]))
  }, [])

  useEffect(() => {
    if (!id) return
    api
      .get<Product>(`/api/products/admin/${id}`)
      .then((p) => {
        setForm({
          name: p.name,
          price: String(p.price),
          cover: p.cover || 'p1',
          cover_url: p.cover_url || '',
          desc: p.desc,
          delivery_content: p.delivery_content || '',
          status: p.status,
          category_id: p.category_id != null ? String(p.category_id) : '',
          sale_mode: p.sale_mode === 'commission' ? 'commission' : 'normal',
        })
        setFiles(p.files || [])
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : '加载失败'))
      .finally(() => setLoading(false))
  }, [id])

  function pickCover(file: File | null) {
    if (!file) return
    if (!isImageName(file.name)) {
      setError('封面仅支持 png / jpg / jpeg / gif / webp / bmp')
      return
    }
    if (file.size > MAX_COVER_BYTES) {
      setError('封面过大，最大 5MB')
      return
    }
    setError('')
    if (cropSrc) URL.revokeObjectURL(cropSrc)
    const url = URL.createObjectURL(file)
    setCropSrc(url)
    setCropName(file.name)
    if (coverRef.current) coverRef.current.value = ''
  }

  function closeCropper() {
    if (cropSrc) URL.revokeObjectURL(cropSrc)
    setCropSrc(null)
  }

  function applyCroppedCover(file: File) {
    setPendingCover(file)
    closeCropper()
    showToast('封面已裁切，保存商品后生效')
  }

  async function onSave(e: FormEvent) {
    e.preventDefault()
    const price = Number(form.price)
    if (!form.name.trim() || Number.isNaN(price) || price < 0) {
      setError('请填写完整且有效的信息')
      return
    }
    if (form.sale_mode === 'commission' && price < 0.02) {
      setError('约稿单价须至少 0.02 元/千字，以便拆分定金与尾款')
      return
    }
    setSaving(true)
    setError('')
    try {
      const body = {
        name: form.name.trim(),
        price,
        cover: form.cover,
        desc: form.desc.trim(),
        delivery_content: form.delivery_content,
        status: form.status,
        category_id: form.category_id ? Number(form.category_id) : null,
        sale_mode: form.sale_mode,
      }
      const saved = isEdit
        ? await api.put<Product>(`/api/products/${id}`, body)
        : await api.post<Product>('/api/products', body)
      if (pendingCover) {
        await api.upload(`/api/products/${saved.id}/cover`, pendingCover)
      }
      if (form.sale_mode !== 'commission') {
        for (const file of pendingFiles) {
          await api.upload(`/api/products/${saved.id}/files`, file)
        }
      }
      showToast(isEdit ? '商品已更新' : '商品已创建')
      navigate('/admin/products')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  async function removeCover() {
    if (!isEdit || !form.cover_url) {
      setPendingCover(null)
      setForm({ ...form, cover_url: '' })
      return
    }
    try {
      await api.delete(`/api/products/${id}/cover`)
      setPendingCover(null)
      setForm({ ...form, cover_url: '' })
      showToast('已删除封面')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '删除失败')
    }
  }

  async function removeSavedFile(fileId: string) {
    if (!isEdit || !id) {
      setFiles((prev) => prev.filter((f) => f.id !== fileId))
      return
    }
    try {
      await api.delete(`/api/products/${id}/files/${fileId}`)
      setFiles((prev) => prev.filter((f) => f.id !== fileId))
      showToast('已删除商品文件')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '删除失败')
    }
  }

  if (loading) return <div className="text-ink-mute">加载中…</div>

  const coverSrc = coverPreviewUrl || form.cover_url || ''
  const priceNum = Number(form.price) || 0
  const split = splitPrice(priceNum)
  const catName = categories.find((c) => String(c.id) === form.category_id)?.name || '未分类'
  const line = 'w-full border-0 border-b border-[var(--line-strong)] bg-transparent py-2 outline-none focus:border-teal'

  return (
    <div className="lx-desk -m-4 min-h-full bg-fog px-5 py-6 md:-m-6 md:px-7 md:py-7">
      <div className="desk-inner">
        <header className="form-head">
          <div>
            <div className="form-kicker">
              <span className="badge">PRODUCT EDITOR</span>
              <span>{isEdit ? `正在编辑 #${id}` : '新建商品档案'}</span>
            </div>
            <h1>{isEdit ? '编辑商品' : '新增商品'}</h1>
            <p className="lead">成品一次付清就发货。约稿先收定金，稿件在订单里交，尾款付清才能下。</p>
          </div>
          <Link className="ghost-btn" to="/admin/products">
            <ArrowLeft className="h-4 w-4" />
            返回商品与分类
          </Link>
        </header>

        <form onSubmit={onSave} className="form-layout">
          <div className="form-sections">
            <section className="f-card">
              <div className="f-card-head">
                <h2>卖什么</h2>
                <small>基础定价、分类归属与上架状态</small>
              </div>
              <label className="mt-4 grid gap-1.5">
                <span className="text-[0.76rem] font-bold text-ink-soft">商品名称</span>
                <input
                  className={line}
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="例如：《深夜维修工》全文 + 番外"
                  required
                />
              </label>

              <div className="mode-pick">
                {(
                  [
                    ['normal', '成品', '一次付清，自动发货'],
                    ['commission', '约稿', '按千字，定金开工，尾款取稿'],
                  ] as const
                ).map(([value, title, hint]) => (
                  <button
                    key={value}
                    type="button"
                    className={form.sale_mode === value ? 'on' : ''}
                    onClick={() => setForm({ ...form, sale_mode: value })}
                  >
                    <b>{title}</b>
                    <span>{hint}</span>
                  </button>
                ))}
              </div>

              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <label className="grid gap-1.5">
                  <span className="text-[0.76rem] font-bold text-ink-soft">
                    {form.sale_mode === 'commission' ? '单价（元 / 千字）' : '价格（元）'}
                  </span>
                  <input
                    className={line}
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.price}
                    placeholder="例如 38"
                    onChange={(e) => setForm({ ...form, price: e.target.value })}
                    required
                  />
                </label>
                <label className="grid gap-1.5">
                  <span className="text-[0.76rem] font-bold text-ink-soft">所属分类</span>
                  <select className={line} value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })}>
                    <option value="">未分类</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                        {c.enabled ? '' : '（已停用）'}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <p className="split-hint">
                {form.sale_mode === 'commission' ? (
                  <>
                    按千字计价。1000 字合计 <b>{formatYuan(priceNum)}</b>，定金 <b>{formatYuan(split.deposit)}</b>，尾款{' '}
                    <b>{formatYuan(split.balance)}</b>。单价至少 0.02，才拆得开定金和尾款。
                  </>
                ) : (
                  '填 0 表示免费，买家点购买后直接发货。'
                )}
              </p>

              <div className="mt-3 flex items-center justify-between gap-3 pt-2 text-[0.86rem]">
                <span>
                  上架 <small className="text-[0.75rem] text-ink-mute">关掉后前台看不到，已买的订单不受影响</small>
                </span>
                <button
                  type="button"
                  className={`switch ${form.status === 'on' ? 'on' : ''}`}
                  aria-label="上架"
                  onClick={() => setForm({ ...form, status: form.status === 'on' ? 'off' : 'on' })}
                />
              </div>
            </section>

            <section className="f-card">
              <div className="f-card-head">
                <h2>封面</h2>
                <small>没有图时用下面的色块</small>
              </div>
              <div
                role="button"
                tabIndex={0}
                onClick={() => coverRef.current?.click()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    coverRef.current?.click()
                  }
                }}
                onDragOver={(e: DragEvent) => {
                  e.preventDefault()
                  setDraggingCover(true)
                }}
                onDragLeave={(e: DragEvent) => {
                  e.preventDefault()
                  setDraggingCover(false)
                }}
                onDrop={(e: DragEvent) => {
                  e.preventDefault()
                  setDraggingCover(false)
                  pickCover(e.dataTransfer.files?.[0] || null)
                }}
                className={`relative mt-4 cursor-pointer overflow-hidden rounded-[10px] border border-[var(--line-strong)] ${
                  draggingCover ? 'ring-2 ring-teal' : ''
                }`}
              >
                {coverSrc ? (
                  <div className="relative h-[220px]">
                    <img src={coverSrc} alt="封面预览" className="absolute inset-0 h-full w-full object-cover" />
                    <div className="absolute inset-x-0 bottom-0 bg-[rgba(20,32,28,.6)] px-3 py-2 text-center text-[0.8rem] text-white">
                      拖拽或点击更换，先裁成 16:10
                    </div>
                  </div>
                ) : (
                  <div className={`product ${form.cover} relative h-[220px]`}>
                    <div className="wash absolute inset-0" />
                    <div className="pattern" />
                    <div className="absolute inset-0 grid place-items-center px-4 text-center text-white">
                      <div>
                        <div className="font-[family-name:var(--font-display)] text-[1.15rem] font-bold">拖封面到这里，或点击选择图片</div>
                        <div className="mt-1 text-[0.78rem] text-white/85">png / jpg / webp，最大 5MB。松开后先裁成 16:10。</div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
              {(coverSrc || pendingCover) && (
                <div className="mt-2 flex justify-end gap-3">
                  {pendingCover ? (
                    <button
                      type="button"
                      className="text-[0.78rem] font-bold text-teal"
                      onClick={() => {
                        const url = URL.createObjectURL(pendingCover)
                        if (cropSrc) URL.revokeObjectURL(cropSrc)
                        setCropSrc(url)
                        setCropName(pendingCover.name)
                      }}
                    >
                      重新裁切
                    </button>
                  ) : null}
                  <button type="button" className="text-[0.78rem] font-bold text-danger" onClick={removeCover}>
                    移除封面
                  </button>
                </div>
              )}
              <input
                ref={coverRef}
                type="file"
                accept="image/png,image/jpeg,image/gif,image/webp,image/bmp"
                className="hidden"
                onChange={(e) => pickCover(e.target.files?.[0] || null)}
              />
              <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6">
                {COVERS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-label={`色块 ${c}`}
                    onClick={() => setForm({ ...form, cover: c })}
                    className={`product ${c} overflow-hidden rounded-[7px] border-2 ${form.cover === c && !coverSrc ? 'border-teal' : 'border-transparent'}`}
                  >
                    <div className="product-media relative aspect-[16/10]">
                      <div className="wash absolute inset-0" />
                      <div className="pattern" />
                    </div>
                  </button>
                ))}
              </div>
            </section>

            <section className="f-card">
              <div className="f-card-head">
                <h2>前台介绍</h2>
                <small>买家下单前看得到</small>
              </div>
              <label className="mt-4 grid gap-1.5">
                <span className="text-[0.76rem] font-bold text-ink-soft">商品描述</span>
                <textarea
                  className={`${line} min-h-28 resize-y`}
                  value={form.desc}
                  onChange={(e) => setForm({ ...form, desc: e.target.value })}
                  placeholder="写给人看的介绍，不要放下载链接"
                />
              </label>
            </section>

            {form.sale_mode === 'commission' ? (
              <section className="f-card">
                <div className="f-card-head">
                  <h2>稿件交付说明</h2>
                  <small>约稿模式专用流程</small>
                </div>
                <p className="mt-3 text-[0.86rem] leading-relaxed text-ink-soft">
                  约稿不在这里传文件。买家付定金后，到对应订单里交稿。尾款付清，买家才能下载。
                </p>
              </section>
            ) : (
              <section className="f-card">
                <div className="f-card-head">
                  <h2>商品文件与发货文本</h2>
                  <small>付款后自动鉴权发放</small>
                </div>
                <div className="mt-4">
                  <ProductFilePicker
                    productId={id ? Number(id) : null}
                    files={files}
                    pending={pendingFiles}
                    onPendingChange={setPendingFiles}
                    onRemoveSaved={removeSavedFile}
                    onError={setError}
                  />
                </div>
                <div className="mt-4 flex items-end justify-between gap-3">
                  <span className="text-[0.76rem] font-bold text-ink-soft">发货文本</span>
                  <div className="flex gap-4">
                    {(['edit', 'preview'] as const).map((tab) => (
                      <button
                        key={tab}
                        type="button"
                        className={`border-b-2 pb-1 text-[0.78rem] font-bold ${
                          textTab === tab ? 'border-ink text-ink' : 'border-transparent text-ink-mute'
                        }`}
                        onClick={() => setTextTab(tab)}
                      >
                        {tab === 'edit' ? '编辑' : '预览'}
                      </button>
                    ))}
                  </div>
                </div>
                {textTab === 'edit' ? (
                  <textarea
                    className={`${line} mt-2 min-h-40 resize-y font-[family-name:var(--font-mono)] text-[0.82rem]`}
                    value={form.delivery_content}
                    onChange={(e) => setForm({ ...form, delivery_content: e.target.value })}
                    placeholder={'## 激活码\n\n`XXXX-XXXX`'}
                  />
                ) : (
                  <div className="mt-2 min-h-40 rounded-[8px] border border-[var(--line)] bg-fog p-3">
                    {form.delivery_content.trim() ? (
                      <MarkdownContent content={form.delivery_content} />
                    ) : (
                      <span className="text-[0.86rem] text-ink-mute">暂无发货文本</span>
                    )}
                  </div>
                )}
                <p className="mt-2 text-[0.75rem] text-ink-mute">支持 Markdown。文件走上面的列表，付款后鉴权下载，不要把直链写进文本。</p>
              </section>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-[var(--line-strong)] bg-white px-5 py-3.5">
              <div className="min-h-[1.2em] text-[0.82rem] text-danger">{error}</div>
              <div className="flex gap-2">
                <Link to="/admin/products" className="ghost-btn">
                  取消
                </Link>
                <button type="submit" disabled={saving} className="teal-btn disabled:opacity-60">
                  {saving ? '保存中…' : isEdit ? '保存修改' : '创建商品'}
                </button>
              </div>
            </div>
          </div>

          <aside className="preview-card">
            <div className="text-[0.72rem] font-bold tracking-[0.06em] text-ink-mute">前台会看到</div>
            <div className="mt-3 aspect-[16/10] overflow-hidden rounded-[8px]">
              {coverSrc ? (
                <img src={coverSrc} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className={`product ${form.cover} h-full`}>
                  <div className="product-media relative h-full">
                    <div className="wash absolute inset-0" />
                    <div className="pattern" />
                  </div>
                </div>
              )}
            </div>
            <h3 className="mt-3 font-[family-name:var(--font-display)] text-[1.32rem] leading-tight font-extrabold tracking-[-0.03em]">
              {form.name.trim() || '未命名商品'}
            </h3>
            <div className="mt-2 font-[family-name:var(--font-mono)] font-bold text-teal">
              {form.sale_mode === 'commission' ? `${formatYuan(priceNum)} / 千字` : formatYuan(priceNum)}
            </div>
            <p className="mt-1 text-[0.78rem] text-ink-mute">
              {catName} · {form.sale_mode === 'commission' ? '约稿' : '成品'} · {form.status === 'on' ? '在售' : '下架'}
            </p>
            <p className="mt-3 border-t border-dashed border-[var(--line-strong)] pt-3 text-[0.82rem] leading-relaxed text-ink-soft whitespace-pre-wrap">
              {form.desc.trim() || '还没有介绍。'}
            </p>
          </aside>
        </form>

        {cropSrc ? <CoverCropModal imageSrc={cropSrc} fileName={cropName} onCancel={closeCropper} onConfirm={applyCroppedCover} /> : null}
      </div>
    </div>
  )
}
