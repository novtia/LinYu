import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import type { ProductFileItem } from '../types'

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
}: {
  files: ProductFileItem[]
  onDownload: (url: string, name: string) => Promise<void> | void
}) {
  if (!files.length) return null
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
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  )
}
