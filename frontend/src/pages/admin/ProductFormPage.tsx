import { useEffect, useRef, useState, type DragEvent, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ApiError, api } from '../../lib/api'
import { useToast } from '../../context/ToastContext'
import { CoverCropModal } from '../../components/CoverCropModal'
import type { Product, ProductType } from '../../types'

const COVERS = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6']
const TAG_HINT: Record<ProductType, string> = {
  key: 'KEY · AUTO',
  file: 'FILE · ZIP',
  code: 'CODE · REDEEM',
}
const MAX_FILE_BYTES = 50 * 1024 * 1024
const MAX_COVER_BYTES = 5 * 1024 * 1024

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function fileExt(name: string) {
  const i = name.lastIndexOf('.')
  return i >= 0 ? name.slice(i + 1).toUpperCase() : 'FILE'
}

function isImageName(name: string) {
  return /\.(png|jpe?g|gif|webp|bmp)$/i.test(name)
}

export function ProductFormPage() {
  const { id } = useParams<{ id: string }>()
  const isEdit = Boolean(id)
  const navigate = useNavigate()
  const { showToast } = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const coverRef = useRef<HTMLInputElement>(null)

  const [form, setForm] = useState({
    id: '',
    name: '',
    type: 'key' as ProductType,
    price: '',
    cover: 'p1',
    cover_url: '' as string,
    tag: '',
    desc: '',
    status: 'on',
    file_name: '',
    has_file: false,
  })
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [pendingCover, setPendingCover] = useState<File | null>(null)
  const [filePreviewUrl, setFilePreviewUrl] = useState<string | null>(null)
  const [coverPreviewUrl, setCoverPreviewUrl] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(isEdit)
  const [draggingFile, setDraggingFile] = useState(false)
  const [draggingCover, setDraggingCover] = useState(false)
  const [cropSrc, setCropSrc] = useState<string | null>(null)
  const [cropName, setCropName] = useState('cover.jpg')

  useEffect(() => {
    return () => {
      if (cropSrc) URL.revokeObjectURL(cropSrc)
    }
  }, [cropSrc])

  useEffect(() => {
    if (!pendingFile || !isImageName(pendingFile.name)) {
      setFilePreviewUrl(null)
      return
    }
    const url = URL.createObjectURL(pendingFile)
    setFilePreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [pendingFile])

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
    if (!id) return
    api
      .get<Product>(`/api/products/admin/${id}`)
      .then((p) => {
        setForm({
          id: p.id,
          name: p.name,
          type: p.type,
          price: String(p.price),
          cover: p.cover || 'p1',
          cover_url: p.cover_url || '',
          tag: p.tag,
          desc: p.desc,
          status: p.status,
          file_name: p.file_name || '',
          has_file: !!p.has_file,
        })
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : '加载失败'))
      .finally(() => setLoading(false))
  }, [id])

  function pickFile(file: File | null) {
    if (!file) return
    if (file.size > MAX_FILE_BYTES) {
      setError('文件过大，最大 50MB')
      return
    }
    setError('')
    setPendingFile(file)
    setForm((prev) => ({ ...prev, type: 'file', file_name: file.name }))
    if (fileRef.current) fileRef.current.value = ''
  }

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
    if (form.id && !/^[a-zA-Z0-9_-]{2,64}$/.test(form.id)) {
      setError('商品 ID 需为 2-64 位字母、数字、下划线或短横线')
      return
    }
    if (form.type === 'file' && !form.has_file && !pendingFile) {
      setError('数字文件商品请先选择要上传的文件')
      return
    }
    setSaving(true)
    setError('')
    try {
      const saved = await api.post<Product>('/api/products', {
        id: form.id.trim() || undefined,
        name: form.name.trim(),
        type: form.type,
        price,
        cover: form.cover,
        tag: form.tag.trim() || undefined,
        desc: form.desc.trim(),
        status: form.status,
      })
      if (pendingCover) {
        await api.upload(`/api/products/${saved.id}/cover`, pendingCover)
      }
      if (pendingFile) {
        await api.upload(`/api/products/${saved.id}/file`, pendingFile)
      }
      showToast(isEdit ? '商品已更新' : '商品已创建')
      navigate('/admin/products')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  async function removeFile() {
    if (!form.id || !isEdit) {
      setPendingFile(null)
      setForm({ ...form, has_file: false, file_name: '' })
      return
    }
    try {
      await api.delete(`/api/products/${form.id}/file`)
      setPendingFile(null)
      setForm({ ...form, has_file: false, file_name: '' })
      showToast('已删除文件')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '删除失败')
    }
  }

  async function removeCover() {
    if (!form.id || !isEdit || !form.cover_url) {
      setPendingCover(null)
      setForm({ ...form, cover_url: '' })
      return
    }
    try {
      await api.delete(`/api/products/${form.id}/cover`)
      setPendingCover(null)
      setForm({ ...form, cover_url: '' })
      showToast('已删除封面')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '删除失败')
    }
  }

  if (loading) return <div className="text-ink-mute">加载中…</div>

  const hasSelectedFile = Boolean(form.has_file || pendingFile)
  const displayName = pendingFile ? pendingFile.name : form.file_name
  const coverSrc = coverPreviewUrl || form.cover_url || ''

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-5 flex items-center justify-between gap-3">
        <div>
          <h2 className="font-[family-name:var(--font-display)] text-xl font-bold">{isEdit ? '编辑商品' : '新增商品'}</h2>
          <p className="mt-1 text-[0.85rem] text-ink-mute">支持上传封面图与数字源文件</p>
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
              placeholder="例如：Pro Suite 年卡激活码"
              required
            />
          </label>

          <label className="grid gap-1.5">
            <span className="text-[0.82rem] font-semibold text-ink-soft">商品 ID {isEdit ? '' : '（可选）'}</span>
            <input
              className="h-11 rounded-xl border border-[var(--line-strong)] bg-white px-3.5 font-[family-name:var(--font-mono)] text-[0.9rem] disabled:bg-paper"
              value={form.id}
              disabled={isEdit}
              onChange={(e) => setForm({ ...form, id: e.target.value })}
              placeholder="留空自动生成，如 ui-kit"
            />
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
          </label>

          <label className="grid gap-1.5">
            <span className="text-[0.82rem] font-semibold text-ink-soft">类型</span>
            <select
              className="h-11 rounded-xl border border-[var(--line-strong)] bg-white px-3"
              value={form.type}
              onChange={(e) => {
                const type = e.target.value as ProductType
                setForm({
                  ...form,
                  type,
                  tag: form.tag && !Object.values(TAG_HINT).includes(form.tag) ? form.tag : TAG_HINT[type],
                })
              }}
            >
              <option value="key">卡密</option>
              <option value="file">文件</option>
              <option value="code">兑换码</option>
            </select>
          </label>

          <label className="grid gap-1.5">
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

          <label className="grid gap-1.5 md:col-span-2">
            <span className="text-[0.82rem] font-semibold text-ink-soft">标签</span>
            <input
              className="h-11 rounded-xl border border-[var(--line-strong)] bg-white px-3.5 font-[family-name:var(--font-mono)] text-[0.9rem]"
              value={form.tag}
              onChange={(e) => setForm({ ...form, tag: e.target.value })}
              placeholder={TAG_HINT[form.type]}
            />
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
              placeholder="介绍交付方式、使用说明等"
            />
          </label>

          {(form.type === 'file' || form.has_file || pendingFile) && (
            <div className="md:col-span-2">
              <div className="mb-2 text-[0.82rem] font-semibold text-ink-soft">数字文件（最大 50MB）</div>
              <div
                role="button"
                tabIndex={0}
                onClick={() => fileRef.current?.click()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    fileRef.current?.click()
                  }
                }}
                onDragOver={(e: DragEvent) => {
                  e.preventDefault()
                  setDraggingFile(true)
                }}
                onDragLeave={(e: DragEvent) => {
                  e.preventDefault()
                  setDraggingFile(false)
                }}
                onDrop={(e: DragEvent) => {
                  e.preventDefault()
                  setDraggingFile(false)
                  pickFile(e.dataTransfer.files?.[0] || null)
                }}
                className={`cursor-pointer rounded-xl border-2 border-dashed px-4 py-7 text-center transition ${
                  draggingFile
                    ? 'border-teal bg-[rgba(15,110,92,.08)]'
                    : 'border-[var(--line-strong)] bg-paper/60 hover:border-teal hover:bg-[rgba(15,110,92,.04)]'
                }`}
              >
                <div className="mb-1 text-[0.95rem] font-semibold text-ink">拖拽文件到此处上传</div>
                <div className="text-[0.82rem] text-ink-mute">也可点击选择本地文件</div>
              </div>

              {hasSelectedFile && (
                <ul className="mt-3 grid gap-2">
                  <li className="flex items-center gap-3 rounded-xl border border-[var(--line)] bg-white p-3">
                    <div className="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-lg bg-paper">
                      {filePreviewUrl ? (
                        <img src={filePreviewUrl} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <div className="text-[0.65rem] font-bold tracking-wide text-teal">{fileExt(displayName)}</div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold text-ink" title={displayName}>
                        {displayName}
                      </div>
                      <div className="mt-1 text-[0.78rem] text-ink-mute">
                        {pendingFile ? formatSize(pendingFile.size) : '已保存到服务器'}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="shrink-0 rounded-lg border border-[var(--line)] px-3 py-1.5 text-[0.8rem] font-semibold text-danger hover:border-danger"
                      onClick={(e) => {
                        e.stopPropagation()
                        removeFile()
                      }}
                    >
                      移除
                    </button>
                  </li>
                </ul>
              )}

              <input
                ref={fileRef}
                type="file"
                className="hidden"
                onChange={(e) => {
                  pickFile(e.target.files?.[0] || null)
                }}
              />
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
