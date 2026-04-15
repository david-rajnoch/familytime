"""
File serving endpoints: video streaming (byte-range), thumbnails, single frames.
"""
from fastapi import APIRouter, HTTPException, Header
from fastapi.responses import Response
from typing import Optional

from database import get_conn
from services.stream_service import stream_file
from services.thumbnail_service import get_or_create_thumbnail
from services.video_processor import extract_frame

router = APIRouter(prefix="/api/files")


@router.get("/{file_id}/stream")
def stream_video(file_id: int, range: Optional[str] = Header(default=None)):
    """RFC 7233 byte-range streaming for video files."""
    conn = get_conn()
    row = conn.execute("SELECT path, file_type FROM files WHERE id = ?", (file_id,)).fetchone()
    conn.close()
    if not row:
        raise HTTPException(404, "File not found")
    return stream_file(row["path"], range)


_THUMB_CACHE_HEADERS = {
    "Cache-Control": "public, max-age=31536000, immutable",
}


@router.get("/{file_id}/thumbnail")
def file_thumbnail(file_id: int):
    """Return a representative face thumbnail for a file (first face found)."""
    conn = get_conn()
    face = conn.execute(
        "SELECT id FROM faces WHERE file_id = ? ORDER BY detection_conf DESC LIMIT 1",
        (file_id,),
    ).fetchone()
    if not face:
        conn.close()
        raise HTTPException(404, "No faces in file")
    jpeg = get_or_create_thumbnail(face["id"], conn)
    conn.close()
    if not jpeg:
        raise HTTPException(404, "Could not generate thumbnail")
    return Response(content=jpeg, media_type="image/jpeg", headers=_THUMB_CACHE_HEADERS)


@router.get("/face/{face_id}/thumbnail")
def face_thumbnail(face_id: int):
    """Return a face crop thumbnail by face ID."""
    conn = get_conn()
    jpeg = get_or_create_thumbnail(face_id, conn)
    conn.close()
    if not jpeg:
        raise HTTPException(404, "Could not generate thumbnail")
    return Response(content=jpeg, media_type="image/jpeg", headers=_THUMB_CACHE_HEADERS)


@router.get("/{file_id}/frame")
def get_frame(file_id: int, timestamp_ms: int = 0):
    """Extract a single video frame at timestamp_ms and return as JPEG."""
    conn = get_conn()
    row = conn.execute("SELECT path, file_type FROM files WHERE id = ?", (file_id,)).fetchone()
    conn.close()
    if not row:
        raise HTTPException(404, "File not found")
    if row["file_type"] != "video":
        raise HTTPException(400, "Not a video file")

    img = extract_frame(row["path"], timestamp_ms)
    if img is None:
        raise HTTPException(500, "Frame extraction failed")

    import io
    buf = io.BytesIO()
    img.convert("RGB").save(buf, format="JPEG", quality=85)
    return Response(content=buf.getvalue(), media_type="image/jpeg")


@router.get("/{file_id}/photo")
def get_photo(file_id: int):
    """Serve a photo file directly."""
    conn = get_conn()
    row = conn.execute("SELECT path, file_type FROM files WHERE id = ?", (file_id,)).fetchone()
    conn.close()
    if not row:
        raise HTTPException(404, "File not found")

    from pathlib import Path
    path = Path(row["path"])
    if not path.exists():
        raise HTTPException(404, "File not found (drive may be offline)")

    # Convert HEIC to JPEG for browser display
    ext = path.suffix.lower()
    if ext in (".heic", ".heif"):
        from PIL import Image
        import io
        img = Image.open(str(path)).convert("RGB")
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=90)
        return Response(content=buf.getvalue(), media_type="image/jpeg")

    from fastapi.responses import FileResponse
    media_types = {
        ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
        ".png": "image/png", ".webp": "image/webp",
        ".tiff": "image/tiff", ".tif": "image/tiff",
    }
    return FileResponse(str(path), media_type=media_types.get(ext, "image/jpeg"))
