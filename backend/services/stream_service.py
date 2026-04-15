"""
RFC 7233 byte-range streaming for video files.
Required so HTML5 <video> can seek without buffering the whole file.
"""
from pathlib import Path
from typing import Iterator

from fastapi import HTTPException
from fastapi.responses import StreamingResponse, Response


CHUNK_SIZE = 1024 * 1024  # 1 MB


def stream_file(path: str, range_header: str | None) -> Response:
    file_path = Path(path)
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found (drive may be offline)")

    file_size = file_path.stat().st_size
    media_type = _guess_media_type(path)

    if not range_header:
        return StreamingResponse(
            _iter_file(path, 0, file_size - 1),
            media_type=media_type,
            headers={
                "Content-Length": str(file_size),
                "Accept-Ranges": "bytes",
            },
        )

    # Parse RFC 7233 Range header: "bytes=start-end", "bytes=-suffix", "bytes=start-"
    try:
        if not range_header.startswith("bytes="):
            raise ValueError("Not a bytes range")
        range_val = range_header[6:]  # strip "bytes="

        # Multiple ranges not supported — use first one only
        range_val = range_val.split(",")[0].strip()

        if range_val.startswith("-"):
            # Suffix range: bytes=-N  (last N bytes)
            suffix = int(range_val[1:])
            start = max(0, file_size - suffix)
            end = file_size - 1
        elif range_val.endswith("-"):
            # Open-ended range: bytes=N-
            start = int(range_val[:-1])
            end = file_size - 1
        else:
            start_str, end_str = range_val.split("-", 1)
            start = int(start_str)
            end = int(end_str) if end_str else file_size - 1
    except Exception:
        raise HTTPException(
            status_code=416,
            detail="Invalid Range header",
            headers={"Content-Range": f"bytes */{file_size}"},
        )

    if start >= file_size or end >= file_size or start > end:
        raise HTTPException(
            status_code=416,
            detail="Range Not Satisfiable",
            headers={"Content-Range": f"bytes */{file_size}"},
        )

    content_length = end - start + 1
    return StreamingResponse(
        _iter_file(path, start, end),
        status_code=206,
        media_type=media_type,
        headers={
            "Content-Range": f"bytes {start}-{end}/{file_size}",
            "Content-Length": str(content_length),
            "Accept-Ranges": "bytes",
        },
    )


def _iter_file(path: str, start: int, end: int) -> Iterator[bytes]:
    with open(path, "rb") as f:
        f.seek(start)
        remaining = end - start + 1
        while remaining > 0:
            chunk_size = min(CHUNK_SIZE, remaining)
            data = f.read(chunk_size)
            if not data:
                break
            yield data
            remaining -= len(data)


def _guess_media_type(path: str) -> str:
    ext = Path(path).suffix.lower()
    return {
        ".mp4": "video/mp4",
        ".mov": "video/quicktime",
        ".mts": "video/mp2t",
        ".m2ts": "video/mp2t",
        ".avi": "video/x-msvideo",
        ".mkv": "video/x-matroska",
        ".m4v": "video/mp4",
    }.get(ext, "video/mp4")
