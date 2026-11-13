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
    <div
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
    >
      <div className="flex items-baseline justify-between gap-3 border-b border-[var(--line)] pb-2">
        <h2 className="font-[family-name:var(--font-display)] text-[1.05rem] font-bold tracking-[-0.02em]">
          付款后给买家
          <small className="ml-2 font-[family-name:var(--font-body)] text-[0.74rem] font-medium tracking-normal text-ink-mute">文本和文件分开</small>
        </h2>
        <button
          type="button"
          className="inline-flex h-8 items-center rounded-[10px] border border-[var(--line-strong)] px-2.5 text-[0.78rem] font-semibold"
          onClick={() => inputRef.current?.click()}
        >
          添加文件
        </button>
      </div>
      <input ref={inputRef} type="file" multiple className="hidden" onChange={(e) => addFiles(e.target.files)} />
      <ul className={`mt-1 ${dragging ? 'bg-[rgba(15,110,92,.06)]' : ''}`}>
        {files.map((f) => (
          <li key={f.id} className="flex items-center gap-3 border-b border-[var(--line)] py-2.5 text-[0.84rem]">
            <div className="h-9 w-9 shrink-0 overflow-hidden bg-paper">
              {f.is_image && productId ? (
                <AuthImage src={`/api/products/${productId}/files/${f.id}/preview`} alt={f.file_name} className="h-full w-full object-cover" />
              ) : (
                <div className="grid h-full w-full place-items-center">
                  <FileGlyph />
                </div>
              )}
            </div>
            <span className="min-w-0 flex-1 truncate font-semibold">{f.file_name}</span>
            <button type="button" className="shrink-0 text-[0.75rem] font-bold text-danger" onClick={() => onRemoveSaved(f.id)}>
              移除
            </button>
          </li>
        ))}
        {pending.map((file, i) => (
          <li key={`pending-${file.name}-${file.size}-${file.lastModified}-${i}`} className="flex items-center gap-3 border-b border-[var(--line)] py-2.5 text-[0.84rem]">
            <div className="h-9 w-9 shrink-0 overflow-hidden bg-paper">
              {isImageName(file.name) ? <LocalThumb file={file} /> : <div className="grid h-full w-full place-items-center"><FileGlyph /></div>}
            </div>
            <span className="min-w-0 flex-1 truncate">
              <b>{file.name}</b>
              <em className="ml-2 text-[0.72rem] font-medium text-ink-mute not-italic">保存后上传</em>
            </span>
            <button type="button" className="shrink-0 text-[0.75rem] font-bold text-danger" onClick={() => onPendingChange(pending.filter((_, idx) => idx !== i))}>
              移除
            </button>
          </li>
        ))}
        {!files.length && !pending.length ? (
          <li className="border-b border-[var(--line)] py-3 text-[0.84rem] text-ink-mute">还没有文件。买家付款后只能看到发货文本。可拖文件到这里，最大 50MB。</li>
        ) : null}
      </ul>
    </div>
  )
}
