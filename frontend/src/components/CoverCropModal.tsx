import { useCallback, useState } from 'react'
import Cropper, { type Area } from 'react-easy-crop'

const ASPECT = 16 / 10

async function getCroppedBlob(imageSrc: string, pixelCrop: Area, mime = 'image/jpeg'): Promise<Blob> {
  const image = await loadImage(imageSrc)
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建画布')

  const maxEdge = 1600
  const scale = Math.min(1, maxEdge / Math.max(pixelCrop.width, pixelCrop.height))
  canvas.width = Math.round(pixelCrop.width * scale)
  canvas.height = Math.round(pixelCrop.height * scale)

  ctx.drawImage(
    image,
    pixelCrop.x,
    pixelCrop.y,
    pixelCrop.width,
    pixelCrop.height,
    0,
    0,
    canvas.width,
    canvas.height,
  )

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) reject(new Error('裁切失败'))
        else resolve(blob)
      },
      mime,
      0.92,
    )
  })
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.addEventListener('load', () => resolve(img))
    img.addEventListener('error', () => reject(new Error('图片加载失败')))
    img.src = src
  })
}

interface CoverCropModalProps {
  imageSrc: string
  fileName: string
  onCancel: () => void
  onConfirm: (file: File) => void
}

export function CoverCropModal({ imageSrc, fileName, onCancel, onConfirm }: CoverCropModalProps) {
  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const onCropComplete = useCallback((_: Area, pixels: Area) => {
    setCroppedAreaPixels(pixels)
  }, [])

  async function handleConfirm() {
    if (!croppedAreaPixels) return
    setBusy(true)
    setError('')
    try {
      const base = fileName.replace(/\.[^.]+$/, '') || 'cover'
      const blob = await getCroppedBlob(imageSrc, croppedAreaPixels, 'image/jpeg')
      const file = new File([blob], `${base}-cover.jpg`, { type: 'image/jpeg' })
      onConfirm(file)
    } catch (e) {
      setError(e instanceof Error ? e.message : '裁切失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[120] grid place-items-center bg-[rgba(20,32,28,0.62)] p-4">
      <div className="flex max-h-[92vh] w-[min(720px,100%)] flex-col overflow-hidden rounded-[22px] border border-[var(--line)] bg-fog shadow-xl">
        <div className="flex items-center justify-between border-b border-[var(--line)] px-5 py-4">
          <div>
            <h3 className="font-[family-name:var(--font-display)] text-lg font-bold">编辑封面</h3>
            <p className="mt-0.5 text-[0.8rem] text-ink-mute">拖动选区与缩放，确认后应用 16:10 裁切</p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="grid h-9 w-9 place-items-center rounded-[10px] border border-[var(--line)] bg-white text-ink-soft hover:border-teal hover:text-teal"
            aria-label="关闭"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M2 2l10 10M12 2L2 12" />
            </svg>
          </button>
        </div>

        <div className="relative h-[min(52vh,420px)] bg-ink">
          <Cropper
            image={imageSrc}
            crop={crop}
            zoom={zoom}
            aspect={ASPECT}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={onCropComplete}
            showGrid
            objectFit="contain"
          />
        </div>

        <div className="border-t border-[var(--line)] bg-white px-5 py-4">
          <label className="mb-4 grid gap-2">
            <div className="flex items-center justify-between text-[0.82rem]">
              <span className="font-semibold text-ink-soft">缩放</span>
              <span className="font-[family-name:var(--font-mono)] text-ink-mute">{zoom.toFixed(2)}x</span>
            </div>
            <input
              type="range"
              min={1}
              max={3}
              step={0.01}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              className="w-full accent-[var(--teal)]"
            />
          </label>
          {error && <div className="mb-3 text-[0.82rem] text-danger">{error}</div>}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="h-10 rounded-[10px] border border-[var(--line-strong)] bg-paper px-4 font-semibold"
              disabled={busy}
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={busy || !croppedAreaPixels}
              className="h-10 rounded-[10px] bg-teal px-5 font-semibold text-white disabled:opacity-60"
            >
              {busy ? '处理中…' : '确认裁切'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
