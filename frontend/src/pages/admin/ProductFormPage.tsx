import { useEffect, useRef, useState, type DragEvent, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
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
    category_id: '' as string,
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
      setError('约稿商品价格须至少 0.02 元，以便拆分定金与尾款')
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

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-5 flex items-center justify-between gap-3">
        <div>
          <h2 className="font-[family-name:var(--font-display)] text-xl font-bold">{isEdit ? '编辑商品' : '新增商品'}</h2>
          <p className="mt-1 text-[0.85rem] text-ink-mute">发货文本与文件分开管理；文件付款后鉴权下载</p>
        </div>
        <Link to="/admin/products" className="text-[0.88rem] font-semibold text-teal hover:underline">
          返回列表
        </Link>
      </div>

      <form onSubmit={onSave} className="overflow-hidden rounded-[18px] border border-[var(--line)] bg-white">
        <div className="grid gap-5 p-5 md:grid-cols-2">
          <label className="grid gap-1.5 md:col-span-2">
            <span className="text-[0.82rem] font-semibold text-ink-soft">商品名称</span>
            <input
              className="h-11 rounded-xl border border-[var(--line-strong)] bg-white px-3.5"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="例如：Pro Suite 年卡"
              required
            />
          </label>

          <label className="grid gap-1.5">
            <span className="text-[0.82rem] font-semibold text-ink-soft">销售模式</span>
            <select
              className="h-11 rounded-xl border border-[var(--line-strong)] bg-white px-3"
              value={form.sale_mode}
              onChange={(e) => setForm({ ...form, sale_mode: e.target.value as 'normal' | 'commission' })}
            >
              <option value="normal">普通商品（一次付清，自动发货）</option>
              <option value="commission">约稿商品（先付定金，交稿后再付尾款）</option>
            </select>
          </label>

          <label className="grid gap-1.5">
            <span className="text-[0.82rem] font-semibold text-ink-soft">价格（元）</span>
            <input
              className="h-11 rounded-xl border border-[var(--line-strong)] bg-white px-3.5"
              type="number"
              min="0"
              step="0.01"
              value={form.price}
              onChange={(e) => setForm({ ...form, price: e.target.value })}
              required
            />
            <span className="text-[0.78rem] text-ink-mute">
              {form.sale_mode === 'commission'
                ? `约稿总价；买家先付定金 ${formatYuan(splitPrice(Number(form.price) || 0).deposit)}，交稿后再付尾款 ${formatYuan(splitPrice(Number(form.price) || 0).balance)}`
                : '填 0 表示免费，用户点击购买后直接发货'}
            </span>
          </label>

          <label className="grid gap-1.5">
            <span className="text-[0.82rem] font-semibold text-ink-soft">商品分类</span>
            <select
              className="h-11 rounded-xl border border-[var(--line-strong)] bg-white px-3"
              value={form.category_id}
              onChange={(e) => setForm({ ...form, category_id: e.target.value })}
            >
              <option value="">未分类</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}{c.enabled ? '' : '（已停用）'}
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-1.5 md:col-span-2">
            <span className="text-[0.82rem] font-semibold text-ink-soft">上架状态</span>
            <select
              className="h-11 rounded-xl border border-[var(--line-strong)] bg-white px-3"
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value })}
            >
              <option value="on">在售</option>
              <option value="off">下架</option>
            </select>
          </label>

          <div className="md:col-span-2">
            <div className="mb-2 text-[0.82rem] font-semibold text-ink-soft">商品封面</div>
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
              className={`cursor-pointer overflow-hidden rounded-xl border-2 border-dashed transition ${
                draggingCover
                  ? 'border-teal bg-[rgba(15,110,92,.08)]'
                  : 'border-[var(--line-strong)] bg-paper/60 hover:border-teal'
              }`}
            >
              {coverSrc ? (
                <div className="relative aspect-[16/10]">
                  <img src={coverSrc} alt="封面预览" className="absolute inset-0 h-full w-full object-cover" />
                  <div className="absolute inset-x-0 bottom-0 bg-[rgba(20,32,28,.55)] px-3 py-2 text-center text-[0.8rem] text-white">
                    拖拽或点击更换封面
                  </div>
                </div>
              ) : (
                <div className={`product ${form.cover} relative aspect-[16/10]`}>
                  <div className="wash absolute inset-0" />
                  <div className="pattern" />
                  <div className="absolute inset-0 grid place-items-center bg-[rgba(20,32,28,.28)] px-4 text-center text-white">
                    <div>
                      <div className="font-semibold">拖拽封面图到此处</div>
                      <div className="mt-1 text-[0.8rem] text-white/85">支持 png / jpg / webp，最大 5MB</div>
                    </div>
                  </div>
                </div>
              )}
            </div>
            {(coverSrc || pendingCover) && (
              <div className="mt-2 flex flex-wrap justify-end gap-2">
                {pendingCover && (
                  <button
                    type="button"
                    className="h-9 rounded-[10px] border border-[var(--line-strong)] bg-white px-3 text-[0.82rem] font-semibold text-teal"
                    onClick={() => {
                      const url = URL.createObjectURL(pendingCover)
                      if (cropSrc) URL.revokeObjectURL(cropSrc)
                      setCropSrc(url)
                      setCropName(pendingCover.name)
                    }}
                  >
                    重新裁切
                  </button>
                )}
                <button
                  type="button"
                  className="h-9 rounded-[10px] border border-[var(--line-strong)] bg-white px-3 text-[0.82rem] font-semibold text-danger"
                  onClick={removeCover}
                >
                  移除封面
                </button>
              </div>
            )}
            <input ref={coverRef} type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/bmp" className="hidden" onChange={(e) => pickCover(e.target.files?.[0] || null)} />

            <div className="mt-4 text-[0.82rem] font-semibold text-ink-soft">无封面图时的默认样式</div>
            <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-6">
              {COVERS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setForm({ ...form, cover: c })}
                  className={`product ${c} overflow-hidden rounded-xl border-2 transition ${
                    form.cover === c ? 'border-teal ring-2 ring-[rgba(15,110,92,.2)]' : 'border-transparent'
                  }`}
                >
                  <div className="product-media relative aspect-[16/10]">
                    <div className="wash absolute inset-0" />
                    <div className="pattern" />
                  </div>
                </button>
              ))}
            </div>
          </div>

          <label className="grid gap-1.5 md:col-span-2">
            <span className="text-[0.82rem] font-semibold text-ink-soft">商品描述</span>
            <textarea
              className="min-h-28 rounded-xl border border-[var(--line-strong)] bg-white px-3.5 py-3"
              value={form.desc}
              onChange={(e) => setForm({ ...form, desc: e.target.value })}
              placeholder="前台展示的商品介绍（支持纯文本）"
            />
          </label>

          {form.sale_mode === 'commission' ? (
            <div className="rounded-xl border border-[var(--line)] bg-paper px-3.5 py-3 text-[0.86rem] text-ink-soft md:col-span-2">
              约稿商品的稿件在买家付定金后，于对应订单详情中上传。买家付清尾款后才能下载。
            </div>
          ) : (
            <ProductFilePicker
              productId={id ? Number(id) : null}
              files={files}
              pending={pendingFiles}
              onPendingChange={setPendingFiles}
              onRemoveSaved={removeSavedFile}
              onError={setError}
            />
          )}

          {form.sale_mode !== 'commission' && (
          <div className="grid gap-1.5 md:col-span-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[0.82rem] font-semibold text-ink-soft">发货文本</span>
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  className={`h-8 rounded-lg px-2.5 text-[0.78rem] font-semibold ${
                    textTab === 'edit' ? 'bg-ink text-white' : 'bg-paper text-ink-soft'
                  }`}
                  onClick={() => setTextTab('edit')}
                >
                  编辑
                </button>
                <button
                  type="button"
                  className={`h-8 rounded-lg px-2.5 text-[0.78rem] font-semibold ${
                    textTab === 'preview' ? 'bg-ink text-white' : 'bg-paper text-ink-soft'
                  }`}
                  onClick={() => setTextTab('preview')}
                >
                  预览
                </button>
              </div>
            </div>
            {textTab === 'edit' ? (
              <textarea
                className="min-h-56 rounded-xl border border-[var(--line-strong)] bg-white px-3.5 py-3"
                value={form.delivery_content}
                onChange={(e) => setForm({ ...form, delivery_content: e.target.value })}
                placeholder={'付款成功后买家可见，例如：\n\n## 激活码\n\n`XXXX-XXXX`'}
              />
            ) : (
              <div className="min-h-56 rounded-xl border border-[var(--line-strong)] bg-paper/60 px-3.5 py-3">
                {form.delivery_content.trim() ? (
                  <MarkdownContent content={form.delivery_content} />
                ) : (
                  <span className="text-[0.86rem] text-ink-mute">暂无发货文本</span>
                )}
              </div>
            )}
            <p className="text-[0.8rem] text-ink-mute">支持 Markdown 排版；文件请在上方「商品文件」中上传，不要写入公开链接。</p>
          </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-[var(--line)] bg-paper px-5 py-4">
          <div className="min-h-[1.2em] text-[0.82rem] text-danger">{error}</div>
          <div className="flex gap-2">
            <Link to="/admin/products" className="inline-flex h-10 items-center rounded-[10px] border border-[var(--line-strong)] bg-white px-4 font-semibold">
              取消
            </Link>
            <button type="submit" disabled={saving} className="h-10 rounded-[10px] bg-teal px-5 font-semibold text-white disabled:opacity-60">
              {saving ? '保存中…' : isEdit ? '保存修改' : '创建商品'}
            </button>
          </div>
        </div>
      </form>

      {cropSrc && (
        <CoverCropModal
          imageSrc={cropSrc}
          fileName={cropName}
          onCancel={closeCropper}
          onConfirm={applyCroppedCover}
        />
      )}
    </div>
  )
}
