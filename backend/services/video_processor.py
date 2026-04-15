"""
Extract frames from videos at regular intervals + scene changes, then detect faces.
Uses ffmpeg with VideoToolbox hardware acceleration on Apple Silicon.
"""
import io
import json
import logging
import sqlite3
import subprocess
import time
from datetime import datetime
from pathlib import Path
from typing import Optional

import numpy as np
from PIL import Image

from services.photo_processor import process_image

logger = logging.getLogger(__name__)


# ── ffprobe helpers ───────────────────────────────────────────────────────────

def get_video_info(path: str) -> dict:
    """Return dict with duration_ms, width, height, taken_at."""
    cmd = [
        "ffprobe", "-v", "quiet", "-print_format", "json",
        "-show_streams", "-show_format", path
    ]
    try:
        out = subprocess.check_output(cmd, stderr=subprocess.DEVNULL, timeout=60)
        data = json.loads(out)
    except subprocess.TimeoutExpired:
        logger.warning("ffprobe timed out for %s", path)
        return {}
    except subprocess.CalledProcessError as e:
        logger.warning("ffprobe failed for %s: exit %d", path, e.returncode)
        return {}
    except json.JSONDecodeError as e:
        logger.warning("ffprobe JSON parse error for %s: %s", path, e)
        return {}
    except Exception as e:
        logger.warning("ffprobe error for %s: %s", path, e)
        return {}

    result: dict = {}

    try:
        duration_s = float(data.get("format", {}).get("duration", 0) or 0)
        result["duration_ms"] = int(duration_s * 1000)
    except (ValueError, TypeError):
        result["duration_ms"] = 0

    for stream in data.get("streams", []):
        if stream.get("codec_type") == "video":
            result["width"] = stream.get("width")
            result["height"] = stream.get("height")
            break

    tags = data.get("format", {}).get("tags", {})
    ct = tags.get("creation_time") or tags.get("com.apple.quicktime.creationdate")
    if ct:
        try:
            result["taken_at"] = datetime.fromisoformat(ct.replace("Z", "+00:00")).isoformat()
        except Exception:
            pass

    return result


def get_scene_change_timestamps_ms(path: str, threshold: float = 0.35) -> list[int]:
    """Run ffmpeg scene detection, return list of timestamps in ms."""
    # Clamp threshold to valid range
    threshold = max(0.01, min(1.0, threshold))

    cmd = [
        "ffmpeg", "-i", path,
        "-vf", f"select='gt(scene,{threshold:.3f})',showinfo",
        "-vsync", "vfr",
        "-f", "null", "-"
    ]
    try:
        result = subprocess.run(
            cmd, stderr=subprocess.PIPE, timeout=600, text=True
        )
        timestamps = []
        for line in result.stderr.splitlines():
            if "pts_time:" in line:
                for part in line.split():
                    if part.startswith("pts_time:"):
                        try:
                            ts_s = float(part.split(":")[1])
                            timestamps.append(int(ts_s * 1000))
                        except (ValueError, IndexError):
                            pass
        return sorted(set(timestamps))
    except subprocess.TimeoutExpired:
        logger.warning("Scene detection timed out for %s, using interval-only sampling", path)
        return []
    except Exception as e:
        logger.warning("Scene detection failed for %s: %s", path, e)
        return []


def build_sample_timestamps(duration_ms: int, interval_s: int, scene_ts: list[int]) -> list[int]:
    """Union of fixed-interval grid and scene-change timestamps, deduplicated within 500ms."""
    if duration_ms <= 0:
        return []
    grid = list(range(0, duration_ms, max(1, interval_s) * 1000))
    # Always sample the first second if there's content
    if grid and grid[0] > 500:
        grid.insert(0, 0)
    all_ts = sorted(set(grid + scene_ts))

    # Deduplicate within 500ms window
    deduped = []
    last = -9999
    for ts in all_ts:
        if ts - last >= 500:
            deduped.append(ts)
            last = ts
    return deduped


def _split_jpeg_stream(data: bytes) -> list[bytes]:
    """Split a concatenated MJPEG byte stream into individual JPEG images."""
    images = []
    i = 0
    start = -1
    while i < len(data) - 1:
        if data[i] == 0xFF:
            marker = data[i + 1]
            if marker == 0xD8:        # SOI — start of image
                start = i
            elif marker == 0xD9:      # EOI — end of image
                if start != -1:
                    images.append(data[start : i + 2])
                    start = -1
                i += 2
                continue
        i += 1
    return images


def extract_frames_batch(path: str, timestamps_ms: list[int], interval_s: int = 0) -> list[tuple[int, Image.Image]]:
    """
    Extract all frames in ONE ffmpeg call.

    If interval_s > 0 (pure interval sampling, no scene timestamps mixed in):
        Uses the fps filter — ffmpeg natively skips to every N-th second.
        Very fast: one process, exact one frame per interval.

    Otherwise (arbitrary/mixed timestamps from scene detection):
        Uses per-frame individual seeks (original approach).

    Returns list of (timestamp_ms, Image).
    """
    if not timestamps_ms:
        return []

    if interval_s > 0:
        return _extract_frames_fps(path, timestamps_ms, interval_s)
    else:
        return _extract_frames_individually(path, timestamps_ms)


def _extract_frames_fps(path: str, timestamps_ms: list[int], interval_s: int) -> list[tuple[int, Image.Image]]:
    """
    One ffmpeg call using fps=1/N filter. Produces exactly one frame per interval.
    Timestamps are reconstructed as 0, interval_s*1000, 2*interval_s*1000, …
    """
    cmd = [
        "ffmpeg",
        "-hwaccel", "videotoolbox",
        "-i", path,
        "-vf", f"fps=1/{interval_s}",
        "-f", "image2pipe",
        "-vcodec", "mjpeg",
        "-q:v", "4",
        "pipe:1",
    ]
    try:
        raw = subprocess.check_output(cmd, stderr=subprocess.DEVNULL, timeout=600)
    except Exception as e:
        logger.warning("fps-batch extraction failed for %s: %s — falling back", path, e)
        return _extract_frames_individually(path, timestamps_ms)

    frames_data = _split_jpeg_stream(raw)
    if not frames_data:
        logger.warning("fps-batch returned 0 frames for %s — falling back", path)
        return _extract_frames_individually(path, timestamps_ms)

    result: list[tuple[int, Image.Image]] = []
    for i, jpeg in enumerate(frames_data):
        ts_ms = i * interval_s * 1000
        try:
            img = Image.open(io.BytesIO(jpeg))
            img.load()
            result.append((ts_ms, img))
        except Exception as e:
            logger.debug("JPEG decode failed frame %d of %s: %s", i, path, e)

    return result


def _extract_frames_individually(path: str, timestamps_ms: list[int]) -> list[tuple[int, Image.Image]]:
    """Legacy per-frame extraction — one ffmpeg spawn per frame."""
    result = []
    for ts_ms in timestamps_ms:
        ts_s = max(0.0, ts_ms / 1000.0)
        cmd = [
            "ffmpeg", "-hwaccel", "videotoolbox",
            "-ss", f"{ts_s:.3f}", "-i", path,
            "-frames:v", "1", "-f", "image2pipe",
            "-vcodec", "mjpeg", "-q:v", "4", "pipe:1",
        ]
        try:
            data = subprocess.check_output(cmd, stderr=subprocess.DEVNULL, timeout=30)
            if data:
                img = Image.open(io.BytesIO(data))
                img.load()
                result.append((ts_ms, img))
        except Exception:
            pass
    return result


def extract_frame(path: str, timestamp_ms: int) -> Optional[Image.Image]:
    """Extract a single frame (kept for compatibility)."""
    frames = _extract_frames_individually(path, [timestamp_ms])
    return frames[0][1] if frames else None


# ── Main video processing ─────────────────────────────────────────────────────

def process_video_path(
    path: str,
    conn: sqlite3.Connection,
    video_sample_interval_s: int = 3,
    scene_detection: bool = True,
) -> int:
    """
    Sample a video file, detect faces in each frame.
    Returns total number of faces found.
    """
    if not Path(path).exists():
        logger.warning("Video file not found (drive offline?): %s", path)
        return 0

    row = conn.execute("SELECT id FROM files WHERE path = ?", (path,)).fetchone()
    if not row:
        return 0
    file_id = row["id"]

    info = get_video_info(path)
    if not info:
        logger.warning("Could not read video metadata for %s", path)
        return 0

    duration_ms = info.get("duration_ms", 0)
    if duration_ms <= 0:
        logger.warning("Zero or unknown duration for %s, skipping", path)
        return 0

    # Update file record with video metadata (only non-null values)
    conn.execute(
        """UPDATE files
           SET duration_ms = COALESCE(?, duration_ms),
               width = COALESCE(?, width),
               height = COALESCE(?, height),
               taken_at = COALESCE(taken_at, ?),
               face_extracted_at = ?
           WHERE id = ?""",
        (duration_ms, info.get("width"), info.get("height"), info.get("taken_at"),
         datetime.utcnow().isoformat(), file_id),
    )
    conn.commit()

    scene_ts: list[int] = []
    if scene_detection:
        scene_ts = get_scene_change_timestamps_ms(path)

    timestamps = build_sample_timestamps(duration_ms, video_sample_interval_s, scene_ts)

    if not timestamps:
        logger.debug("No sample timestamps for %s (duration=%dms)", path, duration_ms)
        return 0

    n_frames = len(timestamps)
    logger.info("Sampling %d frames from %s (%.1fs)", n_frames, Path(path).name, duration_ms / 1000)

    # Use fast fps-filter batch if no scene timestamps mixed in
    t0 = time.perf_counter()
    batch_interval = video_sample_interval_s if not scene_ts else 0
    frames = extract_frames_batch(path, timestamps, interval_s=batch_interval)
    extract_elapsed = time.perf_counter() - t0

    t1 = time.perf_counter()
    total_faces = 0
    for ts_ms, img in frames:
        total_faces += process_image(img, file_id, conn, source_timestamp_ms=ts_ms)
    infer_elapsed = time.perf_counter() - t1

    logger.info(
        "%s | %d frames | extract %.1fs (%.2fs/frame) | inference %.1fs (%.2fs/frame) | %d faces",
        Path(path).name, n_frames,
        extract_elapsed, extract_elapsed / max(n_frames, 1),
        infer_elapsed, infer_elapsed / max(n_frames, 1),
        total_faces,
    )

    return total_faces
