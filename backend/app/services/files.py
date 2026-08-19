from __future__ import annotations

import logging
import re
import uuid
from pathlib import Path
from typing import Optional, Set

from fastapi import UploadFile

from ..database import BASE_DIR

logger = logging.getLogger("lingxia.files")

UPLOAD_DIR = BASE_DIR / "uploads"
COVER_DIR = UPLOAD_DIR / "covers"
FILE_DIR = UPLOAD_DIR / "files"
ASSET_DIR = UPLOAD_DIR / "assets"
MAX_UPLOAD_BYTES = 50 * 1024 * 1024  # 50MB
MAX_COVER_BYTES = 5 * 1024 * 1024  # 5MB
COVER_EXTENSIONS: Set[str] = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp"}
# assets 目录由 Nginx/StaticFiles 公开提供，禁止可在站点源下执行的类型
ASSET_EXTENSIONS: Set[str] = {
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico",
    ".pdf", ".txt", ".md", ".csv", ".json",
    ".zip", ".rar", ".7z", ".gz", ".tar",
    ".mp3", ".mp4", ".wav", ".webm",
    ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
}


def ensure_upload_dir() -> Path:
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    COVER_DIR.mkdir(parents=True, exist_ok=True)
    FILE_DIR.mkdir(parents=True, exist_ok=True)
    ASSET_DIR.mkdir(parents=True, exist_ok=True)
    return UPLOAD_DIR


def safe_filename(name: str) -> str:
    name = Path(name).name
    name = re.sub(r"[^\w.\u4e00-\u9fff\-]+", "_", name, flags=re.UNICODE)
    return name[:180] or "file.bin"


async def _save_to(file: UploadFile, dest: Path, max_bytes: int) -> None:
    size = 0
    with dest.open("wb") as out:
        while True:
            chunk = await file.read(1024 * 1024)
            if not chunk:
                break
            size += len(chunk)
            if size > max_bytes:
                out.close()
                dest.unlink(missing_ok=True)
                raise ValueError(f"文件过大，最大 {max_bytes // (1024 * 1024)}MB")
            out.write(chunk)


async def save_upload(file: UploadFile, product_id: str) -> tuple:
    """Save product digital file; returns (relative_path, original_filename)."""
    ensure_upload_dir()
    original = safe_filename(file.filename or "file.bin")
    stored = f"{product_id}_{uuid.uuid4().hex[:10]}_{original}"
    dest = FILE_DIR / stored
    await _save_to(file, dest, MAX_UPLOAD_BYTES)
    return f"files/{stored}", original


async def save_cover(file: UploadFile, product_id: str) -> tuple:
    """Save product cover image; returns (relative_path, original_filename)."""
    ensure_upload_dir()
    original = safe_filename(file.filename or "cover.png")
    ext = Path(original).suffix.lower()
    if ext not in COVER_EXTENSIONS:
        raise ValueError("封面仅支持 png / jpg / jpeg / gif / webp / bmp")
    stored = f"{product_id}_{uuid.uuid4().hex[:10]}{ext}"
    dest = COVER_DIR / stored
    await _save_to(file, dest, MAX_COVER_BYTES)
    return f"covers/{stored}", original


async def save_asset(file: UploadFile) -> tuple:
    """Save markdown attachment; returns (relative_path, original_filename)."""
    ensure_upload_dir()
    original = safe_filename(file.filename or "file.bin")
    if Path(original).suffix.lower() not in ASSET_EXTENSIONS:
        raise ValueError("不支持的附件类型，请上传图片、文档或压缩包")
    stored = f"{uuid.uuid4().hex[:12]}_{original}"
    dest = ASSET_DIR / stored
    await _save_to(file, dest, MAX_UPLOAD_BYTES)
    return f"assets/{stored}", original

def resolve_stored_path(relative: str) -> Path:
    ensure_upload_dir()
    rel = Path(relative.replace("\\", "/"))
    # allow legacy flat filenames in uploads/
    if len(rel.parts) == 1:
        path = (UPLOAD_DIR / rel.name).resolve()
    else:
        path = (UPLOAD_DIR / rel).resolve()
    try:
        path.relative_to(UPLOAD_DIR.resolve())
    except ValueError:
        raise FileNotFoundError("非法路径")
    if not path.is_file():
        raise FileNotFoundError("文件不存在")
    return path


def delete_stored(relative: Optional[str]) -> None:
    if not relative:
        return
    try:
        resolve_stored_path(relative).unlink(missing_ok=True)
    except FileNotFoundError:
        return
    except OSError as e:
        logger.warning("删除文件失败 %s：%s", relative, e)


def cover_public_url(relative: Optional[str]) -> Optional[str]:
    if not relative:
        return None
    return "/uploads/" + relative.replace("\\", "/").lstrip("/")
