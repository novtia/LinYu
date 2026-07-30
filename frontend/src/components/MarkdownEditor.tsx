import { useRef, useState } from 'react'
import { ApiError, api } from '../lib/api'
import { MarkdownContent } from './MarkdownContent'

type AssetUploadOut = { url: string; file_name: string }

type MarkdownEditorProps = {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  hint?: string
  minHeightClass?: string
}

function isImageName(name: string) {
  return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(name)
}

export function MarkdownEditor({
  label,
  value,
  onChange,
  placeholder,
  hint,
  minHeightClass = 'min-h-48',
}: MarkdownEditorProps) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [tab, setTab] = useState<'edit' | 'preview'>('edit')
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')

  function insertAtCursor(snippet: string) {
    onChange(value ? `${value.replace(/\s*$/, '')}\n\n${snippet}\n` : `${snippet}\n`)
  }

  async function onUpload(file: File | null) {
    if (!file) return
    setUploading(true)
    setError('')
    try {
      const res = await api.upload<AssetUploadOut>('/api/products/assets', file)
      if (isImageName(res.file_name)) {
        insertAtCursor(`![${res.file_name}](${res.url})`)
      } else {
        insertAtCursor(`[${res.file_name}](${res.url})`)
      }
      setTab('edit')
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '上传失败')
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <div className="grid gap-1.5 md:col-span-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[0.82rem] font-semibold text-ink-soft">{label}</span>
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            className={`h-8 rounded-lg px-2.5 text-[0.78rem] font-semibold ${
              tab === 'edit' ? 'bg-ink text-white' : 'bg-paper text-ink-soft'
            }`}
            onClick={() => setTab('edit')}
          >
            编辑
          </button>
          <button
            type="button"
            className={`h-8 rounded-lg px-2.5 text-[0.78rem] font-semibold ${
              tab === 'preview' ? 'bg-ink text-white' : 'bg-paper text-ink-soft'
            }`}
            onClick={() => setTab('preview')}
          >
            预览
          </button>
          <button
            type="button"
            disabled={uploading}
            className="h-8 rounded-lg border border-[var(--line-strong)] bg-white px-2.5 text-[0.78rem] font-semibold text-teal disabled:opacity-60"
            onClick={() => fileRef.current?.click()}
          >
            {uploading ? '上传中…' : '插入附件'}
          </button>
          <input
            ref={fileRef}
            type="file"
            className="hidden"
            onChange={(e) => onUpload(e.target.files?.[0] || null)}
          />
        </div>
      </div>

      {tab === 'edit' ? (
        <textarea
          className={`${minHeightClass} rounded-xl border border-[var(--line-strong)] bg-white px-3.5 py-3 font-[family-name:var(--font-mono)] text-[0.88rem] leading-relaxed`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
        />
      ) : (
        <div className={`${minHeightClass} overflow-auto rounded-xl border border-[var(--line)] bg-paper/50 px-3.5 py-3`}>
          <MarkdownContent content={value} />
        </div>
      )}

      {hint ? <span className="text-[0.75rem] text-ink-mute">{hint}</span> : null}
      {error ? <span className="text-[0.78rem] text-danger">{error}</span> : null}
    </div>
  )
}
