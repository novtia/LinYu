from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import or_
from sqlalchemy.orm import Session, joinedload, selectinload

from ..database import get_db
from ..deps import get_current_user
from ..models import Delivery, DeliveryFile, Order, Product, ReadingBookmark, ReadingProgress, User
from ..services.commission import is_commission_mode, split_price
from ..services.files import cover_public_url
from ..services.reader import (
    ReaderError,
    fmt_label,
    is_book_file,
    is_readable,
    load_book,
    load_meta,
    overall_percent,
)
from .orders import _can_access_order, _normalize_email

router = APIRouter(prefix="/api/reader", tags=["reader"])

_SHELF_STATUSES = ("paid", "completed", "deposit_paid", "awaiting_balance")
_SEARCH_LIMIT = 60


# ---------------------------------------------------------------- 输出模型


class ShelfBookOut(BaseModel):
    id: str
    title: str
    author: str
    kind: str  # text | commission
    fmt: str
    state: str  # ready | download | locked | making
    order_id: str
    product_id: int
    cover_url: Optional[str] = None
    bought_at: Optional[datetime] = None
    words: int = 0
    chapters: int = 0
    due: Optional[float] = None
    download_url: Optional[str] = None
    started: bool = False
    ch: int = 0
    ch_title: str = ""
    pct: int = 0
    last_at: Optional[datetime] = None


class ShelfOut(BaseModel):
    books: List[ShelfBookOut]


class ChapterItemOut(BaseModel):
    i: int
    title: str
    words: int


class ProgressOut(BaseModel):
    ch: int = 0
    pct: int = 0
    overall: int = 0
    updated_at: Optional[datetime] = None


class BookmarkOut(BaseModel):
    ch: int
    pct: int
    text: str
    created_at: datetime


class BookOut(BaseModel):
    id: str
    title: str
    author: str
    fmt: str
    kind: str
    order_id: str
    product_id: int
    cover_url: Optional[str] = None
    download_url: str
    words: int
    chapters: List[ChapterItemOut]
    progress: Optional[ProgressOut] = None
    bookmarks: List[BookmarkOut] = Field(default_factory=list)


class ChapterOut(BaseModel):
    index: int
    title: str
    words: int
    paragraphs: List[str]


class SearchHitOut(BaseModel):
    ch: int
    title: str
    snippet: str
    pct: int


class ProgressIn(BaseModel):
    ch: int = Field(ge=0, le=100000)
    pct: int = Field(default=0, ge=0, le=100)


class BookmarkIn(BaseModel):
    ch: int = Field(ge=0, le=100000)
    pct: int = Field(default=0, ge=0, le=100)
    text: str = Field(default="", max_length=400)


# ---------------------------------------------------------------- 工具


def _sorted_files(delivery: Delivery) -> List[DeliveryFile]:
    return sorted(list(delivery.files or []), key=lambda f: (f.sort_order, f.id))


def _book_title(delivery: Delivery, row: DeliveryFile, files: List[DeliveryFile]) -> str:
    base = (delivery.product_name or "").strip() or Path(row.file_name).stem
    book_files = [f for f in files if is_book_file(f.file_name)]
    if len(book_files) > 1:
        return f"{base} · {Path(row.file_name).stem}"
    return base


def _owner_orders(db: Session, user: User) -> List[Order]:
    cond = [Order.user_id == user.id]
    email = _normalize_email(user.email)
    if email:
        cond.append(Order.email == email)
    return (
        db.query(Order)
        .options(
            selectinload(Order.items),
            selectinload(Order.deliveries).selectinload(Delivery.files),
        )
        .filter(or_(*cond), Order.status.in_(_SHELF_STATUSES))
        .order_by(Order.created_at.desc())
        .all()
    )


def _read_gate(order: Order, user: User) -> None:
    """是否已经可以在线阅读（管理员始终可以）。"""
    if user.role == "admin":
        return
    if is_commission_mode(order.sale_mode):
        if order.status != "completed":
            raise HTTPException(status_code=403, detail="请先支付尾款后再阅读")
        return
    if order.status not in ("paid", "completed"):
        raise HTTPException(status_code=403, detail="订单未完成支付")


def _resolve_book(db: Session, user: User, file_id: str):
    row = (
        db.query(DeliveryFile)
        .options(joinedload(DeliveryFile.delivery).selectinload(Delivery.files))
        .filter(DeliveryFile.id == file_id)
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="书籍不存在")
    delivery = row.delivery
    order = db.query(Order).filter(Order.id == delivery.order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="订单不存在")
    if not _can_access_order(order, user, None):
        raise HTTPException(status_code=403, detail="无权阅读这本书")
    _read_gate(order, user)
    if not is_readable(row.file_name):
        raise HTTPException(status_code=400, detail="该格式暂不支持在线阅读，请下载后阅读")
    return row, delivery, order


def _parsed(row: DeliveryFile):
    try:
        return load_book(row.file_path)
    except ReaderError as e:
        raise HTTPException(status_code=422, detail=str(e))


def _progress_out(p: Optional[ReadingProgress]) -> Optional[ProgressOut]:
    if not p:
        return None
    return ProgressOut(ch=p.ch, pct=p.pct, overall=p.overall, updated_at=p.updated_at)


# ---------------------------------------------------------------- 书架


@router.get("/shelf", response_model=ShelfOut)
def get_shelf(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    orders = _owner_orders(db, user)
    product_ids = {it.product_id for o in orders for it in o.items}
    covers: Dict[int, Optional[str]] = {}
    if product_ids:
        for pid, cover in db.query(Product.id, Product.cover_image).filter(Product.id.in_(product_ids)).all():
            covers[pid] = cover_public_url(cover)

    books: List[ShelfBookOut] = []
    paths: Dict[str, str] = {}  # file_id -> 存储路径（仅可在线阅读的）

    for order in orders:
        commission = is_commission_mode(order.sale_mode)
        item = order.items[0] if order.items else None
        product_id = item.product_id if item else 0
        base = dict(
            order_id=order.id,
            product_id=product_id,
            cover_url=covers.get(product_id),
            bought_at=order.paid_at or order.created_at,
            kind="commission" if commission else "text",
        )
        word_count = int(order.word_count or 0)

        # (文件, 所属发放记录)
        targets: List[tuple] = []
        if commission:
            title = item.name if item else "专属约稿"
            delivery = order.deliveries[0] if order.deliveries else None
            files = _sorted_files(delivery) if delivery else []
            if order.status == "deposit_paid" or not files:
                books.append(
                    ShelfBookOut(
                        id=f"order:{order.id}",
                        title=title,
                        author="专属约稿",
                        fmt="TXT",
                        state="making",
                        words=word_count,
                        **base,
                    )
                )
                continue
            if order.status == "awaiting_balance":
                first = next((f for f in files if is_book_file(f.file_name)), files[0])
                _deposit, balance = split_price(order.total)
                books.append(
                    ShelfBookOut(
                        id=first.id,
                        title=title,
                        author="专属约稿",
                        fmt=fmt_label(first.file_name),
                        state="locked",
                        words=word_count,
                        due=balance,
                        **base,
                    )
                )
                continue
            picked = [f for f in files if is_book_file(f.file_name)] or files[:1]
            targets = [(f, delivery) for f in picked]
        else:
            if order.status not in ("paid", "completed"):
                continue
            for delivery in order.deliveries:
                targets.extend((f, delivery) for f in _sorted_files(delivery) if is_book_file(f.file_name))

        for row, delivery in targets:
            title = _book_title(delivery, row, _sorted_files(delivery))
            state = "ready" if is_readable(row.file_name) else "download"
            chapters = 0
            words = word_count if commission else 0
            author = "专属约稿" if commission else "佚名"
            if state == "ready":
                try:
                    meta = load_meta(row.file_path)
                    chapters = len(meta.titles)
                    words = meta.total_words
                    if meta.author and not commission:
                        author = meta.author
                    paths[row.id] = row.file_path
                except ReaderError:
                    state = "download"
            books.append(
                ShelfBookOut(
                    id=row.id,
                    title=title,
                    author=author,
                    fmt=fmt_label(row.file_name),
                    state=state,
                    words=words,
                    chapters=chapters,
                    download_url=f"/api/downloads/files/{row.id}",
                    **base,
                )
            )

    if paths:
        progress = {
            p.file_id: p
            for p in db.query(ReadingProgress)
            .filter(ReadingProgress.user_id == user.id, ReadingProgress.file_id.in_(list(paths)))
            .all()
        }
        for b in books:
            p = progress.get(b.id)
            if not p or b.id not in paths:
                continue
            b.started = True
            b.ch = p.ch
            b.pct = p.overall
            b.last_at = p.updated_at
            try:
                titles = load_meta(paths[b.id]).titles
                b.ch_title = titles[p.ch] if 0 <= p.ch < len(titles) else ""
            except ReaderError:
                b.ch_title = ""

    return ShelfOut(books=books)


# ---------------------------------------------------------------- 阅读


@router.get("/books/{file_id}", response_model=BookOut)
def get_book(file_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    row, delivery, order = _resolve_book(db, user, file_id)
    book = _parsed(row)
    commission = is_commission_mode(order.sale_mode)
    product = db.query(Product).filter(Product.id == delivery.product_id).first()
    progress = (
        db.query(ReadingProgress)
        .filter(ReadingProgress.user_id == user.id, ReadingProgress.file_id == file_id)
        .first()
    )
    marks = (
        db.query(ReadingBookmark)
        .filter(ReadingBookmark.user_id == user.id, ReadingBookmark.file_id == file_id)
        .order_by(ReadingBookmark.ch)
        .all()
    )
    return BookOut(
        id=row.id,
        title=_book_title(delivery, row, _sorted_files(delivery)),
        author="专属约稿" if commission else (book.author or "佚名"),
        fmt=fmt_label(row.file_name),
        kind="commission" if commission else "text",
        order_id=order.id,
        product_id=delivery.product_id,
        cover_url=cover_public_url(getattr(product, "cover_image", None)) if product else None,
        download_url=f"/api/downloads/files/{row.id}",
        words=book.words,
        chapters=[ChapterItemOut(i=i, title=c.title, words=c.words) for i, c in enumerate(book.chapters)],
        progress=_progress_out(progress),
        bookmarks=[BookmarkOut(ch=m.ch, pct=m.pct, text=m.text or "", created_at=m.created_at) for m in marks],
    )


@router.get("/books/{file_id}/chapters/{index}", response_model=ChapterOut)
def get_chapter(file_id: str, index: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    row, _delivery, _order = _resolve_book(db, user, file_id)
    book = _parsed(row)
    if index < 0 or index >= len(book.chapters):
        raise HTTPException(status_code=404, detail="章节不存在")
    c = book.chapters[index]
    return ChapterOut(index=index, title=c.title, words=c.words, paragraphs=c.paras)


@router.get("/books/{file_id}/search", response_model=List[SearchHitOut])
def search_book(
    file_id: str,
    q: str = Query(min_length=1, max_length=30),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row, _delivery, _order = _resolve_book(db, user, file_id)
    book = _parsed(row)
    needle = q.strip().lower()
    if not needle:
        return []
    hits: List[SearchHitOut] = []
    for ci, chapter in enumerate(book.chapters):
        total = max(1, sum(len(p) for p in chapter.paras))
        before = 0
        for para in chapter.paras:
            pos = para.lower().find(needle)
            if pos >= 0:
                start = max(0, pos - 18)
                end = min(len(para), pos + len(needle) + 28)
                snippet = ("…" if start else "") + para[start:end] + ("…" if end < len(para) else "")
                hits.append(
                    SearchHitOut(
                        ch=ci,
                        title=chapter.title,
                        snippet=snippet,
                        pct=min(100, round(before / total * 100)),
                    )
                )
                if len(hits) >= _SEARCH_LIMIT:
                    return hits
            before += len(para)
    return hits


@router.put("/books/{file_id}/progress", response_model=ProgressOut)
def save_progress(
    file_id: str,
    body: ProgressIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row, _delivery, _order = _resolve_book(db, user, file_id)
    total = len(_parsed(row).chapters)
    ch = min(body.ch, max(0, total - 1))
    overall = overall_percent(ch, body.pct, total)
    p = (
        db.query(ReadingProgress)
        .filter(ReadingProgress.user_id == user.id, ReadingProgress.file_id == file_id)
        .first()
    )
    if not p:
        p = ReadingProgress(user_id=user.id, file_id=file_id)
        db.add(p)
    p.ch, p.pct, p.overall, p.updated_at = ch, body.pct, overall, datetime.utcnow()
    db.commit()
    return _progress_out(p)  # type: ignore[return-value]


@router.post("/books/{file_id}/bookmarks", response_model=BookmarkOut)
def add_bookmark(
    file_id: str,
    body: BookmarkIn,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row, _delivery, _order = _resolve_book(db, user, file_id)
    total = len(_parsed(row).chapters)
    if body.ch >= total:
        raise HTTPException(status_code=400, detail="章节不存在")
    m = (
        db.query(ReadingBookmark)
        .filter(
            ReadingBookmark.user_id == user.id,
            ReadingBookmark.file_id == file_id,
            ReadingBookmark.ch == body.ch,
        )
        .first()
    )
    if not m:
        m = ReadingBookmark(user_id=user.id, file_id=file_id, ch=body.ch)
        db.add(m)
    m.pct = body.pct
    m.text = body.text.strip()[:250]
    m.created_at = datetime.utcnow()
    db.commit()
    db.refresh(m)
    return BookmarkOut(ch=m.ch, pct=m.pct, text=m.text or "", created_at=m.created_at)


@router.delete("/books/{file_id}/bookmarks/{ch}")
def delete_bookmark(
    file_id: str,
    ch: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _resolve_book(db, user, file_id)
    db.query(ReadingBookmark).filter(
        ReadingBookmark.user_id == user.id,
        ReadingBookmark.file_id == file_id,
        ReadingBookmark.ch == ch,
    ).delete()
    db.commit()
    return {"message": "已取消书签"}
