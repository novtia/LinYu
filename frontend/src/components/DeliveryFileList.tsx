import { useEffect, useState } from 'react'
import { BookOpen, Download, FileText, Image as ImageIcon, Lock } from 'lucide-react'
import { api } from '../lib/api'
import type { ProductFileItem } from '../types'

function fileKindIcon(name: string) {
  if (isImageName(name)) return ImageIcon
  if (/\.(epub|mobi|azw3?)$/i.test(name)) return BookOpen
  return FileText
}

export function isImageName(name: string) {
  return /\.(png|jpe?g|gif|webp|bmp)$/i.test(name)
}

export function inlineDownloadUrl(url: string) {
  return url.includes('?') ? `${url}&inline=1` : `${url}?inline=1`
}

export function FileGlyph({ className = 'h-7 w-7' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`${className} fill-none stroke-current stroke-[1.6] text-teal`} aria-hidden>
      <path d="M7 3.5h7l5 5V20a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 20V5A1.5 1.5 0 0 1 7 3.5Z" />
      <path d="M14 3.5V9h5.5" />
    </svg>
  )
}

export function AuthImage({ src, alt, className }: { src: string; alt: string; className?: string }) {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    let objectUrl: string | null = null
    let alive = true
    setUrl(null)
    api
      .blobUrl(src)
      .then((u) => {
        if (!alive) {
          URL.revokeObjectURL(u)
          return
        }
        objectUrl = u
        setUrl(u)
      })
      .catch(() => {
        if (alive) setUrl(null)
      })
    return () => {
      alive = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [src])

  if (!url) {
    return (
      <div className="grid h-full w-full place-items-center bg-paper">
        <FileGlyph />
      </div>
    )
  }
  return <img src={url} alt={alt} className={className} />
}

export function DeliveryFileList({
  files,
  onDownload,
  onDelete,
  variant = 'grid',
}: {
  files: ProductFileItem[]
  onDownload: (url: string, name: string) => Promise<void> | void
  onDelete?: (fileId: string, name: string) => void
  variant?: 'grid' | 'slip'
}) {
  if (!files.length) return null

  if (variant === 'slip') {
    return (
      <ul className="mt-3.5 border-t border-[var(--line)]">
        {files.map((f) => {
          const Icon = fileKindIcon(f.file_name)
          const locked = !f.download_url
          return (
            <li
              key={f.id || f.download_url || f.file_name}
              className={`flex items-center gap-3 border-b border-[var(--line)] py-3 last:border-b-0 ${locked ? 'opacity-55' : ''}`}
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-[rgba(15,110,92,.1)] text-teal">
                <Icon className="h-4 w-4" strokeWidth={1.8} />
              </span>
              <span className="min-w-0 flex-1">
                <b className="block truncate text-[0.86rem] font-semibold">{f.file_name}</b>
                {onDelete ? (
                  <button
                    type="button"
                    className="mt-0.5 text-[0.72rem] text-danger hover:underline"
                    onClick={() => onDelete(f.id, f.file_name)}
                  >
                    删除
                  </button>
                ) : null}
              </span>
              {locked ? (
                <span className="inline-flex shrink-0 items-center gap-1.5 text-[0.76rem] font-semibold text-ink-mute">
                  <Lock className="h-3.5 w-3.5" strokeWidth={1.8} />
                  未解锁
                </span>
              ) : (
                <button
                  type="button"
                  className="inline-flex h-[34px] shrink-0 items-center gap-1.5 rounded-[9px] border border-[var(--line-strong)] px-3 text-[0.78rem] font-bold text-ink transition hover:border-teal hover:text-teal"
                  onClick={() => onDownload(f.download_url!, f.file_name)}
                >
                  <Download className="h-3.5 w-3.5" strokeWidth={1.8} />
                  下载
                </button>
              )}
            </li>
          )
        })}
      </ul>
    )
  }

  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {files.map((f) => (
        <li
          key={f.id || f.download_url || f.file_name}
          className="flex items-center gap-3 rounded-xl border border-[var(--line)] bg-white px-3 py-2.5"
        >
          <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-paper">
            {f.is_image && f.download_url ? (
              <AuthImage src={inlineDownloadUrl(f.download_url)} alt={f.file_name} className="h-full w-full object-cover" />
            ) : (
              <div className="grid h-full w-full place-items-center">
                <FileGlyph />
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[0.86rem] font-semibold">{f.file_name}</div>
            {f.download_url ? (
              <button
                type="button"
                className="text-[0.8rem] font-semibold text-teal hover:underline"
                onClick={() => onDownload(f.download_url!, f.file_name)}
              >
                下载
              </button>
            ) : (
              <div className="text-[0.78rem] text-ink-mute">已锁定</div>
            )}
          </div>
        </li>
      ))}
    </ul>
  )
}
