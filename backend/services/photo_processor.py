"""
Extract faces from images using InsightFace (buffalo_l model).
Uses ONNX Runtime with CoreML execution provider on Apple Silicon.
"""
import io
import logging
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Optional

import numpy as np
from PIL import Image, ExifTags
import pillow_heif

pillow_heif.register_heif_opener()

logger = logging.getLogger(__name__)

# Single shared model — lazily initialised on first use.
_app = None


def _get_app():
    global _app
    if _app is None:
        import insightface
        logger.info("Loading InsightFace buffalo_l model…")
        _app = insightface.app.FaceAnalysis(
            name="buffalo_l",
            providers=["CoreMLExecutionProvider", "CPUExecutionProvider"],
        )
        _app.prepare(ctx_id=0, det_size=(640, 640))
        logger.info("InsightFace model ready")
    return _app


# ── EXIF helpers ──────────────────────────────────────────────────────────────

_EXIF_TAGS_REV = {v: k for k, v in ExifTags.TAGS.items()}

EXIF_DATE_FORMATS = [
    "%Y:%m:%d %H:%M:%S",
    "%Y:%m:%d %H:%M",
    "%Y-%m-%d %H:%M:%S",
    "%Y-%m-%dT%H:%M:%S",
]


def _exif_date(img: Image.Image, path: str) -> Optional[str]:
    """Return ISO8601 date from EXIF DateTimeOriginal, or None."""
    try:
        exif = img._getexif()  # type: ignore[attr-defined]
        if not exif:
            return None
        tag_id = _EXIF_TAGS_REV.get("DateTimeOriginal")
        raw = exif.get(tag_id) if tag_id else None
        if raw:
            for fmt in EXIF_DATE_FORMATS:
                try:
                    return datetime.strptime(raw.strip(), fmt).isoformat()
                except ValueError:
                    continue
            logger.debug("Unrecognised EXIF date format %r in %s", raw, path)
    except Exception as e:
        logger.debug("EXIF read error for %s: %s", path, e)
    return None


def _mtime_date(path: str) -> str:
    import os
    mtime = os.path.getmtime(path)
    return datetime.utcfromtimestamp(mtime).isoformat()


# ── Embedding packing ─────────────────────────────────────────────────────────

EMBEDDING_DIM = 512
EMBEDDING_BYTES = EMBEDDING_DIM * 4  # float32


def embedding_to_blob(embedding: np.ndarray) -> bytes:
    return embedding.astype(np.float32).tobytes()


def blob_to_embedding(blob: bytes) -> Optional[np.ndarray]:
    if len(blob) != EMBEDDING_BYTES:
        logger.warning("Unexpected embedding blob size: %d bytes (expected %d)", len(blob), EMBEDDING_BYTES)
        return None
    return np.frombuffer(blob, dtype=np.float32).copy()


# ── Main processing ───────────────────────────────────────────────────────────

def process_image(
    img: Image.Image,
    file_id: int,
    conn: sqlite3.Connection,
    source_timestamp_ms: Optional[int] = None,
) -> int:
    """
    Detect all faces in img, insert into faces + faces_vec tables.
    Returns number of faces found.
    """
    if img.width == 0 or img.height == 0:
        logger.warning("Zero-dimension image for file_id=%d, skipping", file_id)
        return 0

    app = _get_app()

    rgb = img.convert("RGB")
    bgr = np.array(rgb)[:, :, ::-1]
    w, h = img.size

    try:
        faces = app.get(bgr)
    except Exception as e:
        logger.warning("InsightFace detection failed for file_id=%d: %s", file_id, e)
        return 0

    count = 0
    for face in faces:
        try:
            bbox = face.bbox  # [x1, y1, x2, y2] pixels
            x1, y1, x2, y2 = bbox
            bx = float(x1) / w
            by = float(y1) / h
            bw = float(x2 - x1) / w
            bh = float(y2 - y1) / h
            conf = float(face.det_score)
            emb = face.normed_embedding  # 512-d float32

            if emb is None or len(emb) != EMBEDDING_DIM:
                logger.warning("Unexpected embedding shape from InsightFace, skipping face")
                continue

            blob = embedding_to_blob(emb)

            cur = conn.execute(
                """
                INSERT INTO faces
                  (file_id, source_timestamp_ms, bbox_x, bbox_y, bbox_w, bbox_h,
                   detection_conf, embedding)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (file_id, source_timestamp_ms, bx, by, bw, bh, conf, blob),
            )
            face_id = cur.lastrowid

            # vec0 virtual tables don't support INSERT OR REPLACE — delete first
            conn.execute("DELETE FROM faces_vec WHERE face_id = ?", (face_id,))
            conn.execute(
                "INSERT INTO faces_vec (face_id, embedding) VALUES (?, ?)",
                (face_id, blob),
            )

            # Pre-generate thumbnail immediately while img is in memory
            try:
                from services.thumbnail_service import _generate_thumbnail_from_img, _cache_thumbnail
                thumb_jpeg = _generate_thumbnail_from_img(img, bx, by, bw, bh)
                if thumb_jpeg:
                    _cache_thumbnail(face_id, thumb_jpeg, conn)
            except Exception as _te:
                logger.debug("Thumbnail pre-gen failed for face_id=%s: %s", face_id, _te)

            count += 1
        except Exception as e:
            logger.warning("Error processing individual face for file_id=%d: %s", file_id, e)
            continue

    if count:
        conn.commit()

    return count


def process_photo_path(path: str, conn: sqlite3.Connection) -> int:
    """
    Load a photo file, update its EXIF metadata in files table, detect faces.
    Returns number of faces found.
    """
    if not Path(path).exists():
        logger.warning("File not found (drive offline?): %s", path)
        return 0

    row = conn.execute(
        "SELECT id FROM files WHERE path = ?", (path,)
    ).fetchone()
    if not row:
        return 0
    file_id = row["id"]

    try:
        img = Image.open(path)
        img.load()
    except Exception as e:
        logger.warning("Cannot open image %s: %s", path, e)
        return 0

    try:
        img = _auto_rotate(img)
    except Exception as e:
        logger.debug("Auto-rotate failed for %s: %s", path, e)

    taken_at = _exif_date(img, path) or _mtime_date(path)
    w, h = img.size

    now = datetime.utcnow().isoformat()
    conn.execute(
        "UPDATE files SET taken_at = ?, width = ?, height = ?, face_extracted_at = ? WHERE id = ?",
        (taken_at, w, h, now, file_id),
    )
    conn.commit()

    return process_image(img, file_id, conn)


def _auto_rotate(img: Image.Image) -> Image.Image:
    try:
        exif = img._getexif()  # type: ignore
        if not exif:
            return img
        orient_id = _EXIF_TAGS_REV.get("Orientation")
        orientation = exif.get(orient_id) if orient_id else None
        rotations = {3: 180, 6: 270, 8: 90}
        if orientation in rotations:
            img = img.rotate(rotations[orientation], expand=True)
    except Exception:
        pass
    return img
