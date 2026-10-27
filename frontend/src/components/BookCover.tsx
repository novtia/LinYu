import type { CSSProperties } from 'react'
import { Lock, PenLine } from 'lucide-react'
import { hueOf, type ShelfBook } from '../lib/reader'

/** 书封：优先用商品封面图，没有时按书名生成竖排封面。 */
export function BookCover({ book, onOpen }: { book: ShelfBook; onOpen?: () => void }) {
  const hue = hueOf(book.id)
  const hasImg = !!book.cover_url
  return (
    <div className="sf-cvw" onClick={onOpen}>
      <div className={`sf-cover ${hasImg ? 'img' : ''}`} style={{ '--h': hue } as CSSProperties}>
        {hasImg ? (
          <img src={book.cover_url!} alt="" loading="lazy" />
        ) : (
          <>
            <span className="sf-cv-t">{book.title}</span>
            <small className="sf-cv-a">{book.author}</small>
          </>
        )}
        {book.kind === 'commission' ? (
          <em className="sf-cv-tag">
            <PenLine width={10} height={10} strokeWidth={2.2} />
            约稿
          </em>
        ) : null}
        {book.fmt !== 'TXT' ? <em className="sf-cv-fmt">{book.fmt}</em> : null}
      </div>
      {book.state === 'locked' ? (
        <div className="sf-ov">
          <Lock width={22} height={22} strokeWidth={1.8} />
          待付尾款
        </div>
      ) : book.state === 'making' ? (
        <div className="sf-ov making">
          <span className="pulse" />
          创作中
        </div>
      ) : null}
    </div>
  )
}
