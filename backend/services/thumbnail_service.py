"""
Generate and cache face crop thumbnails as JPEG files.
"""
import io
import sqlite3
from pathlib import Path

from PIL import Image
import pillow_heif

pillow_heif.register_heif_opener()

from config import settings


def get_or_create_thumbnail(face_id: int, conn: sqlite3.Connection) -> bytes | None:
    """
    Return JPEG bytes for a face crop. Reads from DB cache, generates if missing.
    """
    # Check DB cache first
    row = conn.execute(
        "SELECT jpeg_data FROM thumbnails WHERE face_id = ?", (face_id,)
    ).fetchone()
    if row and row["jpeg_data"]:
        return bytes(row["jpeg_data"])

    # Generate
    jpeg = _generate_thumbnail(face_id, conn)
    if jpeg:
        _cache_thumbnail(face_id, jpeg, conn)
    return jpeg


def _generate_thumbnail(face_id: int, conn: sqlite3.Connection) -> bytes | None:
    face = conn.execute(
        """SELECT f.bbox_x, f.bbox_y, f.bbox_w, f.bbox_h,
                  f.source_timestamp_ms, fi.path, fi.file_type, fi.width, fi.height
           FROM faces f JOIN files fi ON fi.id = f.file_id
           WHERE f.id = ?""",
        (face_id,),
    ).fetchone()
    if not face:
        return None

    path = face["path"]
    if not Path(path).exists():
        return None

    if face["file_type"] == "photo":
        try:
            img = Image.open(path)
            img.load()
        except Exception:
            return None
    else:
        from services.video_processor import extract_frame
        ts = face["source_timestamp_ms"] or 0
        img = extract_frame(path, ts)
        if img is None:
            return None

    # Crop face bbox (normalized coords → pixels)
    w, h = img.size
    x1 = int(face["bbox_x"] * w)
    y1 = int(face["bbox_y"] * h)
    x2 = int((face["bbox_x"] + face["bbox_w"]) * w)
    y2 = int((face["bbox_y"] + face["bbox_h"]) * h)

    # Add 20% padding
    pad_x = int((x2 - x1) * 0.2)
    pad_y = int((y2 - y1) * 0.2)
    x1 = max(0, x1 - pad_x)
    y1 = max(0, y1 - pad_y)
    x2 = min(w, x2 + pad_x)
    y2 = min(h, y2 + pad_y)

    if x2 <= x1 or y2 <= y1:
        return None

    crop = img.crop((x1, y1, x2, y2)).convert("RGB")
    crop.thumbnail((200, 200), Image.LANCZOS)

    buf = io.BytesIO()
    crop.save(buf, format="JPEG", quality=85)
    return buf.getvalue()


def _generate_thumbnail_from_img(
    img: Image.Image,
    bbox_x: float,
    bbox_y: float,
    bbox_w: float,
    bbox_h: float,
) -> bytes | None:
    """
    Generate a face crop thumbnail from an already-loaded PIL Image.
    Used during indexing to avoid re-opening the file.
    """
    w, h = img.size
    x1 = int(bbox_x * w)
    y1 = int(bbox_y * h)
    x2 = int((bbox_x + bbox_w) * w)
    y2 = int((bbox_y + bbox_h) * h)

    pad_x = int((x2 - x1) * 0.2)
    pad_y = int((y2 - y1) * 0.2)
    x1 = max(0, x1 - pad_x)
    y1 = max(0, y1 - pad_y)
    x2 = min(w, x2 + pad_x)
    y2 = min(h, y2 + pad_y)

    if x2 <= x1 or y2 <= y1:
        return None

    crop = img.crop((x1, y1, x2, y2)).convert("RGB")
    crop.thumbnail((200, 200), Image.LANCZOS)

    buf = io.BytesIO()
    crop.save(buf, format="JPEG", quality=85)
    return buf.getvalue()


def _cache_thumbnail(face_id: int, jpeg: bytes, conn: sqlite3.Connection):
    from datetime import datetime
    now = datetime.utcnow().isoformat()
    conn.execute(
        "INSERT OR REPLACE INTO thumbnails (face_id, jpeg_data, generated_at) VALUES (?, ?, ?)",
        (face_id, jpeg, now),
    )
    conn.commit()
