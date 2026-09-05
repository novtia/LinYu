import { useEffect, useRef, useState, type DragEvent } from 'react'
import type { ProductFileItem } from '../types'
import { AuthImage, FileGlyph, isImageName } from './DeliveryFileList'

const MAX_FILE_BYTES = 50 * 1024 * 1024

function LocalThumb({ file }: { file: File }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    const u = URL.createObjectURL(file)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [file])
  if (!url) return <FileGlyph />
  return <img src={url} alt={file.name} className="h-full w-full object-cover" />
}

type ProductFilePickerProps = {
  productId?: number | null
  files: ProductFileItem[]
  pending: File[]
  onPendingChange: (files: File[]) => void
  onRemoveSaved: (id: string) => void
  onError: (msg: string) => void
}

export function ProductFilePicker({
  productId,
  files,
  pending,
  onPendingChange,
  onRemoveSaved,
  onError,
}: ProductFilePickerProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  function addFiles(list: FileList | File[] | null) {
    if (!list || !list.length) return
    const next = [...pending]
    let err = ''
    for (const file of Array.from(list)) {
      if (file.size > MAX_FILE_BYTES) {
        err = `「${file.name}」过大，最大 50MB`
        continue
      }
      next.push(file)
    }
    onError(err)
    onPendingChange(next)
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <div className="md:col-span-2">
      <div className="mb-2 text-[0.82rem] font-semibold text-ink-soft">商品文件</div>
      <div
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            inputRef.current?.click()
          }
        }}
        onDragOver={(e: DragEvent) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={(e: DragEvent) => {
          e.preventDefault()
          setDragging(false)
        }}
        onDrop={(e: DragEvent) => {
          e.preventDefault()
          setDragging(false)
          addFiles(e.dataTransfer.files)
        }}
        className={`cursor-pointer rounded-xl border-2 border-dashed px-4 py-8 text-center transition ${
          dragging ? 'border-teal bg-[rgba(15,110,92,.08)]' : 'border-[var(--line-strong)] bg-paper/60 hover:border-teal'
        }`}
      >
        <div className="font-semibold text-ink">拖拽文件到此处，或点击选择</div>
        <div className="mt-1 text-[0.8rem] text-ink-mute">可一次选择多个；图片显示缩略图，其它文件显示图标。最大 50MB</div>
      </div>
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => addFiles(e.target.files)}
      />

      {files.length + pending.length > 0 ? (
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {files.map((f) => (
            <li key={f.id} className="flex items-center gap-3 rounded-xl border border-[var(--line)] bg-white px-3 py-2.5">
              <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-paper">
                {f.is_image && productId ? (
                  <AuthImage
                    src={`/api/products/${productId}/files/${f.id}/preview`}
                    alt={f.file_name}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="grid h-full w-full place-items-center">
                    <FileGlyph />
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1 truncate text-[0.86rem] font-semibold">{f.file_name}</div>
              <button
                type="button"
                className="shrink-0 text-[0.8rem] font-semibold text-danger hover:underline"
                onClick={() => onRemoveSaved(f.id)}
              >
                移除
              </button>
            </li>
          ))}
          {pending.map((file, i) => (
            <li key={`pending-${file.name}-${file.size}-${file.lastModified}-${i}`} className="flex items-center gap-3 rounded-xl border border-dashed border-teal/40 bg-[rgba(15,110,92,.04)] px-3 py-2.5">
              <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-paper">
                {isImageName(file.name) ? (
                  <LocalThumb file={file} />
                ) : (
                  <div className="grid h-full w-full place-items-center">
                    <FileGlyph />
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[0.86rem] font-semibold">{file.name}</div>
                <div className="text-[0.75rem] text-ink-mute">待保存后上传</div>
              </div>
              <button
                type="button"
                className="shrink-0 text-[0.8rem] font-semibold text-danger hover:underline"
                onClick={() => onPendingChange(pending.filter((_, idx) => idx !== i))}
              >
                移除
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="mt-1.5 text-[0.8rem] text-ink-mute">付款完成后随订单发放，通过鉴权接口下载，不会生成公开直链。</p>
    </div>
  )
}
