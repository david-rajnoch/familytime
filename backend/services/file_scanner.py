"""Scan a directory tree, hash files, insert into the files table."""
import hashlib
import os
import re
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Iterator

PHOTO_EXTS = {".jpg", ".jpeg", ".png", ".heic", ".heif", ".tiff", ".tif", ".webp", ".bmp"}
VIDEO_EXTS = {".mp4", ".mov", ".mts", ".m2ts", ".avi", ".mkv", ".m4v", ".3gp", ".vob", ".VOB"}


def fast_hash(path: str) -> str:
    """SHA-256 of the first 64 KB + file size. Fast and collision-resistant enough."""
    size = os.path.getsize(path)
    h = hashlib.sha256()
    with open(path, "rb") as f:
        h.update(f.read(65536))
    h.update(size.to_bytes(8, "little"))
    return h.hexdigest()


def clean_folder_label(name: str) -> str:
    """Turn a folder name into a human-readable event label."""
    # Replace underscores and dashes with spaces
    label = re.sub(r"[_\-]+", " ", name).strip()
    # Remove leading year pattern like "2023 " so we don't duplicate
    label = re.sub(r"^\d{4}\s+", "", label)
    return label.title() if label else ""


def drive_label(path: str) -> str:
    """Best-effort volume name from the path."""
    parts = Path(path).parts
    if len(parts) >= 3 and parts[1] == "Volumes":
        return parts[2]
    return "Local"


def scan_directory(root: str, conn: sqlite3.Connection) -> Iterator[tuple[str, str]]:
    """
    Walk root, yield (path, file_type) for files not yet in the DB.
    Inserts file records into the files table.
    """
    root_path = Path(root)
    for dirpath, _dirs, filenames in os.walk(root_path):
        folder_name = Path(dirpath).name
        label = clean_folder_label(folder_name)
        vol = drive_label(dirpath)

        for fname in filenames:
            fpath = Path(dirpath) / fname
            ext = fpath.suffix.lower()
            if ext in PHOTO_EXTS:
                ftype = "photo"
            elif ext in VIDEO_EXTS:
                ftype = "video"
            else:
                continue

            try:
                h = fast_hash(str(fpath))
            except OSError:
                continue

            # Skip if already indexed AND face extraction completed
            row = conn.execute(
                "SELECT id FROM files WHERE fast_hash = ? AND face_extracted_at IS NOT NULL", (h,)
            ).fetchone()
            if row:
                continue

            size = os.path.getsize(str(fpath))
            now = datetime.utcnow().isoformat()

            try:
                conn.execute(
                    """
                    INSERT OR IGNORE INTO files
                      (path, fast_hash, file_type, size_bytes, folder_label, indexed_at, drive_label)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (str(fpath), h, ftype, size, label or None, now, vol),
                )
                conn.commit()
            except sqlite3.IntegrityError:
                continue

            yield str(fpath), ftype
