type ProductMediaProps = {
  cover: string
  coverUrl?: string | null
  tag?: string
  className?: string
  aspectClass?: string
}

export function ProductMedia({
  cover,
  coverUrl,
  tag,
  className = '',
  aspectClass = 'aspect-[16/10]',
}: ProductMediaProps) {
  return (
    <div className={`product ${cover} ${className} relative overflow-hidden`}>
      <div className={`product-media relative ${aspectClass} overflow-hidden`}>
        {coverUrl ? (
          <img src={coverUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <>
            <div className="wash absolute inset-0" />
            <div className="pattern" />
          </>
        )}
        {tag ? (
          <span className="absolute bottom-3.5 left-3.5 rounded-lg bg-[rgba(20,32,28,0.72)] px-2.5 py-1.5 font-[family-name:var(--font-mono)] text-[0.72rem] tracking-wide text-white backdrop-blur">
            {tag}
          </span>
        ) : null}
      </div>
    </div>
  )
}
