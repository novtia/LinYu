"""在线阅读：TXT / EPUB 解析为章节，并做内存缓存。只依赖标准库。"""

from __future__ import annotations

import posixpath
import re
import threading
import zipfile
from collections import OrderedDict
from dataclasses import dataclass, field
from html.parser import HTMLParser
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from urllib.parse import unquote
from xml.etree import ElementTree as ET

from .files import resolve_stored_path

READABLE_EXTS = {".txt", ".epub"}
DOWNLOAD_ONLY_EXTS = {".pdf", ".mobi", ".azw3", ".azw", ".doc", ".docx", ".rtf"}

_MAX_ENTRY_BYTES = 30 * 1024 * 1024  # 单个 epub 内文件上限
_MAX_BOOK_BYTES = 50 * 1024 * 1024
_CACHE_BUDGET_CHARS = 36_000_000  # 内存中缓存的正文总字数上限
_META_LIMIT = 800


class ReaderError(Exception):
    """文件无法解析为可阅读的书。"""


def ext_of(name: str) -> str:
    return Path(name or "").suffix.lower()


def is_readable(name: str) -> bool:
    return ext_of(name) in READABLE_EXTS


def is_book_file(name: str) -> bool:
    e = ext_of(name)
    return e in READABLE_EXTS or e in DOWNLOAD_ONLY_EXTS


def fmt_label(name: str) -> str:
    return ext_of(name).lstrip(".").upper() or "FILE"


@dataclass
class Chapter:
    title: str
    paras: List[str]
    words: int


@dataclass
class ParsedBook:
    fmt: str
    author: str = ""
    chapters: List[Chapter] = field(default_factory=list)

    @property
    def chars(self) -> int:
        return sum(c.words for c in self.chapters)

    @property
    def words(self) -> int:
        return self.chars


@dataclass
class BookMeta:
    author: str
    titles: List[str]
    words: List[int]

    @property
    def total_words(self) -> int:
        return sum(self.words)


# ---------------------------------------------------------------- 工具


def _count_words(paras: List[str]) -> int:
    return sum(len(re.sub(r"\s+", "", p)) for p in paras)


def _make_chapter(title: str, paras: List[str]) -> Chapter:
    return Chapter(title=title, paras=paras, words=_count_words(paras))


_CJK = "\u3000-\u303f\u3040-\u30ff\u3400-\u9fff\uff00-\uffef\u2014\u2018\u2019\u201c\u201d\u2026"
_CJK_GAP = re.compile(rf"(?<=[{_CJK}])\s+(?=[{_CJK}])")


def _tidy(text: str) -> str:
    s = re.sub(r"\s+", " ", text).strip()
    return _CJK_GAP.sub("", s)


# ---------------------------------------------------------------- TXT

_NUM = "0-9０-９零〇一二两三四五六七八九十百千万壹贰叁肆伍陆柒捌玖拾佰仟"
_SPECIAL = (
    "序章|序言|楔子|引子|前言|后记|尾声|终章|大结局|完结感言|番外[0-9０-９一二三四五六七八九十]*"
    "|Chapter\\s*\\d+|CHAPTER\\s*\\d+|Prologue|Epilogue"
)
_WS = " \\t\\u3000"
# 第1章 / 第一章 / 第 12 章 / 【第三章】/ # 第五回 …… 行首可有空格、#、【
_CH_LINE = re.compile(
    rf"^[{_WS}#*【\[]*("
    rf"第[{_WS}]*[{_NUM}]+[{_WS}]*[章节回卷集部篇幕话][^\n]{{0,40}}"
    rf"|(?:{_SPECIAL})(?:[{_WS}:：、.．\-—·][^\n]{{0,40}})?"
    rf")[{_WS}\r]*$",
    re.M,
)
# 没有“第x章”时的备选：整行只有一个序号，如「1」「12.」「一」「三、」
_BARE_LINE = re.compile(
    rf"^[{_WS}]*([0-9０-９]{{1,4}}|[零〇一二两三四五六七八九十百]{{1,6}})[{_WS}]*[、.．:：]?[{_WS}\r]*$",
    re.M,
)
_END_PUNCT = "。！？，；,!?;"
_CHUNK_CHARS = 3000


def _decode_text(raw: bytes) -> str:
    if raw[:2] in (b"\xff\xfe", b"\xfe\xff"):
        try:
            return raw.decode("utf-16")
        except UnicodeDecodeError:
            pass
    for enc in ("utf-8-sig", "gb18030"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def _split_paras(body: str) -> List[str]:
    out: List[str] = []
    for line in body.split("\n"):
        s = line.strip(" \t\u3000\r")
        if s:
            out.append(s)
    return out


def _parse_txt(raw: bytes) -> ParsedBook:
    text = _decode_text(raw).replace("\r\n", "\n").replace("\r", "\n")
    marks: List[Tuple[int, int, str]] = []
    for m in _CH_LINE.finditer(text):
        title = m.group(1).strip(" \t\u3000\r#*】]")
        if not title or title[-1] in _END_PUNCT:
            continue
        marks.append((m.start(), m.end(), title))
    if len(marks) < 2:
        bare = [(m.start(), m.end(), m.group(1)) for m in _BARE_LINE.finditer(text)]
        if len(bare) >= 3 and bare[0][2] in ("1", "01", "１", "一", "零"):
            marks = [(s, e, f"第{t}章") for s, e, t in bare]

    chapters: List[Chapter] = []
    if marks:
        head = _split_paras(text[: marks[0][0]])
        if _count_words(head) >= 200:
            chapters.append(_make_chapter("前言", head))
        for i, (_s, end, title) in enumerate(marks):
            stop = marks[i + 1][0] if i + 1 < len(marks) else len(text)
            paras = _split_paras(text[end:stop])
            if paras:
                chapters.append(_make_chapter(title, paras))
    else:
        buf: List[str] = []
        size = 0
        n = 0
        for p in _split_paras(text):
            buf.append(p)
            size += len(p)
            if size >= _CHUNK_CHARS:
                n += 1
                chapters.append(_make_chapter(f"第 {n} 节", buf))
                buf, size = [], 0
        if buf:
            n += 1
            chapters.append(_make_chapter(f"第 {n} 节", buf))

    if not chapters:
        raise ReaderError("文件内容为空，无法阅读")
    return ParsedBook(fmt="TXT", chapters=chapters)


# ---------------------------------------------------------------- EPUB


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1] if isinstance(tag, str) else ""


class _HtmlText(HTMLParser):
    BLOCK = {
        "p", "div", "br", "h1", "h2", "h3", "h4", "h5", "h6", "li", "tr", "blockquote",
        "section", "article", "pre", "dt", "dd", "hr", "table", "ul", "ol",
    }
    SKIP = {"script", "style", "head", "title"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.paras: List[str] = []
        self.heading: Optional[str] = None
        self._buf: List[str] = []
        self._skip = 0
        self._in_h: Optional[str] = None
        self._hbuf: List[str] = []

    def _flush(self) -> None:
        s = _tidy("".join(self._buf))
        self._buf = []
        if s:
            self.paras.append(s)

    def handle_starttag(self, tag, attrs):  # noqa: ANN001
        if tag in self.SKIP:
            self._skip += 1
            return
        if tag in self.BLOCK:
            self._flush()
        if tag in ("h1", "h2", "h3") and self.heading is None and self._in_h is None:
            self._in_h = tag
            self._hbuf = []

    def handle_endtag(self, tag):  # noqa: ANN001
        if tag in self.SKIP:
            self._skip = max(0, self._skip - 1)
            return
        if tag in self.BLOCK:
            self._flush()
        if self._in_h and tag == self._in_h:
            self.heading = _tidy("".join(self._hbuf)) or None
            self._in_h = None

    def handle_data(self, data):  # noqa: ANN001
        if self._skip:
            return
        self._buf.append(data)
        if self._in_h:
            self._hbuf.append(data)

    def close(self) -> None:
        super().close()
        self._flush()


def _html_to_paras(raw: bytes) -> Tuple[List[str], Optional[str]]:
    text = raw.decode("utf-8", errors="replace")
    parser = _HtmlText()
    parser.feed(text)
    parser.close()
    return parser.paras, parser.heading


class _NavLinks(HTMLParser):
    """EPUB3 nav 文档：收集 toc 导航里的 (href, 文字)。"""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.links: List[Tuple[str, str]] = []
        self._nav_depth = 0
        self._found_toc = False
        self._href: Optional[str] = None
        self._text: List[str] = []

    def handle_starttag(self, tag, attrs):  # noqa: ANN001
        d = dict(attrs)
        if tag == "nav":
            kind = d.get("epub:type") or d.get("type") or ""
            if "toc" in kind and not self._found_toc:
                self._nav_depth = 1
                self._found_toc = True
            elif self._nav_depth:
                self._nav_depth += 1
        elif tag == "a" and self._nav_depth and d.get("href"):
            self._href = d["href"]
            self._text = []

    def handle_endtag(self, tag):  # noqa: ANN001
        if tag == "nav" and self._nav_depth:
            self._nav_depth -= 1
        elif tag == "a" and self._href is not None:
            title = _tidy("".join(self._text))
            if title:
                self.links.append((self._href, title))
            self._href = None

    def handle_data(self, data):  # noqa: ANN001
        if self._href is not None:
            self._text.append(data)


class _Zip:
    def __init__(self, z: zipfile.ZipFile) -> None:
        self.z = z
        names = z.namelist()
        self._exact = set(names)
        self._lower = {n.lower(): n for n in names}

    def find(self, name: str) -> Optional[str]:
        name = name.lstrip("/")
        for cand in (name, unquote(name)):
            if cand in self._exact:
                return cand
            hit = self._lower.get(cand.lower())
            if hit:
                return hit
        return None

    def read(self, name: str) -> bytes:
        real = self.find(name)
        if not real:
            raise ReaderError(f"EPUB 缺少文件：{name}")
        if self.z.getinfo(real).file_size > _MAX_ENTRY_BYTES:
            raise ReaderError("EPUB 内含过大的文件")
        return self.z.read(real)


def _resolve(base: str, href: str) -> str:
    clean = unquote(href.split("#", 1)[0])
    return posixpath.normpath(posixpath.join(base, clean)) if clean else ""


def _parse_epub(path: Path) -> ParsedBook:
    try:
        zf = zipfile.ZipFile(path)
    except (zipfile.BadZipFile, OSError):
        raise ReaderError("EPUB 文件已损坏")
    with zf:
        zz = _Zip(zf)
        try:
            container = ET.fromstring(zz.read("META-INF/container.xml"))
            opf_path = ""
            for el in container.iter():
                if _local(el.tag) == "rootfile" and el.get("full-path"):
                    opf_path = el.get("full-path", "")
                    break
            if not opf_path:
                raise ReaderError("EPUB 缺少 OPF 描述文件")
            opf = ET.fromstring(zz.read(opf_path))
        except ET.ParseError:
            raise ReaderError("EPUB 目录解析失败")
        base = posixpath.dirname(opf_path)

        author = ""
        manifest: Dict[str, Tuple[str, str, str]] = {}
        spine: List[str] = []
        toc_id = ""
        for el in opf.iter():
            tag = _local(el.tag)
            if tag == "creator" and not author:
                author = (el.text or "").strip()
            elif tag == "item" and el.get("id") and el.get("href"):
                manifest[el.get("id", "")] = (
                    el.get("href", ""),
                    (el.get("media-type") or "").lower(),
                    el.get("properties") or "",
                )
            elif tag == "itemref" and el.get("idref"):
                spine.append(el.get("idref", ""))
            elif tag == "spine" and el.get("toc"):
                toc_id = el.get("toc", "")

        titles: Dict[str, str] = {}
        # EPUB2：NCX
        ncx = manifest.get(toc_id) if toc_id else None
        if not ncx:
            ncx = next((v for v in manifest.values() if "ncx" in v[1]), None)
        if ncx:
            try:
                root = ET.fromstring(zz.read(_resolve(base, ncx[0])))
                ncx_base = posixpath.dirname(_resolve(base, ncx[0]))
                for np in root.iter():
                    if _local(np.tag) != "navPoint":
                        continue
                    label = ""
                    src = ""
                    for sub in np:
                        t = _local(sub.tag)
                        if t == "navLabel" and not label:
                            label = _tidy("".join(x.text or "" for x in sub.iter() if _local(x.tag) == "text"))
                        elif t == "content" and not src:
                            src = sub.get("src", "")
                    if label and src:
                        titles.setdefault(_resolve(ncx_base, src), label)
            except (ReaderError, ET.ParseError):
                pass
        # EPUB3：nav
        nav = next((v for v in manifest.values() if "nav" in v[2].split()), None)
        if nav:
            try:
                nav_path = _resolve(base, nav[0])
                parser = _NavLinks()
                parser.feed(zz.read(nav_path).decode("utf-8", errors="replace"))
                nav_base = posixpath.dirname(nav_path)
                for href, label in parser.links:
                    key = _resolve(nav_base, href)
                    if key:
                        titles.setdefault(key, label)
            except ReaderError:
                pass

        chapters: List[Chapter] = []
        for idref in spine:
            item = manifest.get(idref)
            if not item or "html" not in item[1]:
                continue
            item_path = _resolve(base, item[0])
            try:
                paras, heading = _html_to_paras(zz.read(item_path))
            except ReaderError:
                continue
            if not paras:
                continue
            title = titles.get(item_path) or heading or ""
            if title and paras and paras[0] == title:
                paras = paras[1:]
                if not paras:
                    continue
            if not title:
                title = f"第 {len(chapters) + 1} 节"
            chapters.append(_make_chapter(title, paras))

    if not chapters:
        raise ReaderError("EPUB 里没有可阅读的正文")
    return ParsedBook(fmt="EPUB", author=author, chapters=chapters)


# ---------------------------------------------------------------- 缓存

_LOCK = threading.Lock()
_BOOKS: "OrderedDict[str, ParsedBook]" = OrderedDict()
_META: "OrderedDict[str, BookMeta]" = OrderedDict()


def _cache_key(path: Path) -> str:
    st = path.stat()
    return f"{path}|{st.st_mtime_ns}|{st.st_size}"


def _parse(path: Path) -> ParsedBook:
    ext = ext_of(path.name)
    if path.stat().st_size > _MAX_BOOK_BYTES:
        raise ReaderError("文件过大，请下载后阅读")
    if ext == ".epub":
        return _parse_epub(path)
    if ext == ".txt":
        return _parse_txt(path.read_bytes())
    raise ReaderError("该格式暂不支持在线阅读")


def _meta_of(book: ParsedBook) -> BookMeta:
    return BookMeta(
        author=book.author,
        titles=[c.title for c in book.chapters],
        words=[c.words for c in book.chapters],
    )


def load_book(stored: str) -> ParsedBook:
    """按库里存的相对路径取书；同一文件修改前只解析一次。"""
    try:
        path = resolve_stored_path(stored)
    except FileNotFoundError:
        raise ReaderError("文件已丢失")
    key = _cache_key(path)
    with _LOCK:
        hit = _BOOKS.get(key)
        if hit is not None:
            _BOOKS.move_to_end(key)
            return hit
    book = _parse(path)
    with _LOCK:
        _BOOKS[key] = book
        _BOOKS.move_to_end(key)
        _META[key] = _meta_of(book)
        _META.move_to_end(key)
        while len(_META) > _META_LIMIT:
            _META.popitem(last=False)
        total = sum(b.chars for b in _BOOKS.values())
        while total > _CACHE_BUDGET_CHARS and len(_BOOKS) > 1:
            _, old = _BOOKS.popitem(last=False)
            total -= old.chars
    return book


def load_meta(stored: str) -> BookMeta:
    """书架列表用：不要求常驻正文，只留章节标题与字数。"""
    try:
        path = resolve_stored_path(stored)
    except FileNotFoundError:
        raise ReaderError("文件已丢失")
    key = _cache_key(path)
    with _LOCK:
        hit = _META.get(key)
        if hit is not None:
            _META.move_to_end(key)
            return hit
    book = load_book(stored)
    return _meta_of(book)


def overall_percent(ch: int, pct: int, total: int) -> int:
    if total <= 0:
        return 0
    ch = max(0, min(total - 1, ch))
    pct = max(0, min(100, pct))
    if ch == total - 1 and pct >= 90:
        return 100
    return max(0, min(100, round((ch + pct / 100) / total * 100)))
