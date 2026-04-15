"""
Indexing endpoints: start a job, stream SSE progress, trigger clustering.
"""
import asyncio
import json
import os
import sqlite3
import threading
from datetime import datetime
from typing import AsyncIterator

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request
from fastapi.responses import StreamingResponse

from database import get_conn
from models.api import StartIndexRequest, JobStatus
from services.file_scanner import scan_directory, PHOTO_EXTS, VIDEO_EXTS
from services.photo_processor import process_photo_path
from services.video_processor import process_video_path
from services.clustering_engine import run_full_clustering

router = APIRouter(prefix="/api/index")

# Per-job cancellation flags; cleaned up when job finishes
_cancel_flags: dict[int, threading.Event] = {}

# ── Background job ────────────────────────────────────────────────────────────

def _run_indexing_job(job_id: int, request: StartIndexRequest):
    cancel = _cancel_flags.setdefault(job_id, threading.Event())
    conn = get_conn()
    try:
        # ── Phase 1: scan (one pass — no double walk) ────────────────────────────
        scanned = 0
        pending: list[tuple[str, str]] = []
        for path, ftype in scan_directory(request.path, conn):
            if cancel.is_set():
                _mark_cancelled(conn, job_id)
                return
            pending.append((path, ftype))
            scanned += 1
            if scanned % 20 == 0:
                conn.execute(
                    "UPDATE indexing_jobs SET files_total = ? WHERE id = ?", (scanned, job_id)
                )
                conn.commit()

        conn.execute(
            "UPDATE indexing_jobs SET files_total = ? WHERE id = ?", (scanned, job_id)
        )
        conn.commit()

        if cancel.is_set():
            _mark_cancelled(conn, job_id)
            return

        # ── Phase 2: face detection (photos first for fast visible progress, then videos) ─
        done = 0
        faces_found = 0
        pending.sort(key=lambda x: 0 if x[1] == "photo" else 1)

        for path, ftype in pending:
            if cancel.is_set():
                _mark_cancelled(conn, job_id)
                return

            if ftype == "photo":
                n = process_photo_path(path, conn)
            else:
                n = process_video_path(
                    path, conn,
                    video_sample_interval_s=request.video_sample_interval_s,
                    scene_detection=request.scene_detection,
                )
            done += 1
            faces_found += n
            conn.execute(
                "UPDATE indexing_jobs SET files_done = ?, faces_found = ? WHERE id = ?",
                (done, faces_found, job_id),
            )
            conn.commit()

        if cancel.is_set():
            _mark_cancelled(conn, job_id)
            return

        # ── Phase 3: clustering ──────────────────────────────────────────────────
        conn.execute(
            "UPDATE indexing_jobs SET status = 'clustering' WHERE id = ?", (job_id,)
        )
        conn.commit()

        run_full_clustering(conn, job_id=job_id)

        conn.execute(
            "UPDATE indexing_jobs SET status = 'done', finished_at = ? WHERE id = ?",
            (datetime.utcnow().isoformat(), job_id),
        )
        conn.commit()

    except Exception as e:
        conn.execute(
            "UPDATE indexing_jobs SET status = 'error', error_msg = ?, finished_at = ? WHERE id = ?",
            (str(e), datetime.utcnow().isoformat(), job_id),
        )
        conn.commit()
    finally:
        _cancel_flags.pop(job_id, None)
        conn.close()


def _mark_cancelled(conn, job_id: int):
    conn.execute(
        "UPDATE indexing_jobs SET status = 'cancelled', finished_at = ? WHERE id = ?",
        (datetime.utcnow().isoformat(), job_id),
    )
    conn.commit()


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/start", response_model=JobStatus)
def start_indexing(req: StartIndexRequest, background_tasks: BackgroundTasks):
    conn = get_conn()
    cur = conn.execute(
        "INSERT INTO indexing_jobs (started_at, root_path, status) VALUES (?, ?, 'running')",
        (datetime.utcnow().isoformat(), req.path),
    )
    job_id = cur.lastrowid
    conn.commit()
    row = conn.execute("SELECT * FROM indexing_jobs WHERE id = ?", (job_id,)).fetchone()
    conn.close()
    background_tasks.add_task(_run_indexing_job, job_id, req)
    return _job_row_to_out(row)


@router.get("/jobs", response_model=list[JobStatus])
def list_jobs():
    conn = get_conn()
    rows = conn.execute(
        "SELECT * FROM indexing_jobs ORDER BY started_at DESC LIMIT 20"
    ).fetchall()
    conn.close()
    return [_job_row_to_out(r) for r in rows]


@router.get("/jobs/{job_id}", response_model=JobStatus)
def get_job(job_id: int):
    conn = get_conn()
    row = conn.execute("SELECT * FROM indexing_jobs WHERE id = ?", (job_id,)).fetchone()
    conn.close()
    if not row:
        from fastapi import HTTPException
        raise HTTPException(404, "Job not found")
    return _job_row_to_out(row)


@router.post("/jobs/{job_id}/cancel")
def cancel_job(job_id: int):
    """Signal a running job to stop after the current file."""
    conn = get_conn()
    row = conn.execute("SELECT status FROM indexing_jobs WHERE id = ?", (job_id,)).fetchone()
    conn.close()
    if not row:
        raise HTTPException(404, "Job not found")
    if row["status"] not in ("running", "clustering"):
        raise HTTPException(400, f"Job is already {row['status']}")
    flag = _cancel_flags.get(job_id)
    if flag:
        flag.set()
    return {"ok": True}


@router.get("/jobs/{job_id}/stream")
async def stream_job_progress(job_id: int, request: Request):
    """SSE endpoint — streams job status updates until done or error."""
    return StreamingResponse(
        _sse_generator(job_id, request),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


async def _sse_generator(job_id: int, request: Request) -> AsyncIterator[str]:
    while True:
        if await request.is_disconnected():
            break
        conn = get_conn()
        row = conn.execute(
            "SELECT * FROM indexing_jobs WHERE id = ?", (job_id,)
        ).fetchone()
        conn.close()
        if row:
            data = json.dumps(dict(row))
            yield f"data: {data}\n\n"
            if row["status"] in ("done", "error"):
                break
        await asyncio.sleep(1)


@router.get("/folders")
def list_folders():
    """List all indexed folders with file and face counts, sorted newest first."""
    conn = get_conn()
    rows = conn.execute("""
        SELECT
            COALESCE(fi.folder_label, 'Unknown') AS label,
            COUNT(DISTINCT fi.id)  AS file_count,
            COUNT(fa.id)           AS face_count,
            SUM(CASE WHEN fi.file_type = 'photo' THEN 1 ELSE 0 END) AS photo_count,
            SUM(CASE WHEN fi.file_type = 'video' THEN 1 ELSE 0 END) AS video_count,
            MIN(fi.taken_at)       AS first_date,
            MAX(fi.taken_at)       AS last_date,
            MIN(fi.path)           AS sample_path
        FROM files fi
        LEFT JOIN faces fa ON fa.file_id = fi.id
        GROUP BY label
        ORDER BY first_date DESC
    """).fetchall()
    conn.close()
    return [dict(r) for r in rows]


@router.delete("/folders")
def delete_folders(body: dict):
    """Delete all files and faces for the given folder labels. Updates person counts."""
    labels: list[str] = body.get("labels", [])
    if not labels:
        return {"ok": True, "deleted_files": 0, "deleted_faces": 0}

    conn = get_conn()
    total_files = 0
    total_faces = 0

    for label in labels:
        real_label = None if label == "Unknown" else label
        cond = "fi.folder_label IS NULL" if real_label is None else "fi.folder_label = ?"
        params_label = [] if real_label is None else [real_label]

        file_ids = [r["id"] for r in conn.execute(
            f"SELECT id FROM files fi WHERE {cond}", params_label
        ).fetchall()]
        if not file_ids:
            continue

        ph = ",".join("?" * len(file_ids))

        # Track affected persons before deletion
        affected = [r["cluster_id"] for r in conn.execute(
            f"SELECT DISTINCT cluster_id FROM faces WHERE file_id IN ({ph}) AND cluster_id IS NOT NULL",
            file_ids,
        ).fetchall()]

        face_ids = [r["id"] for r in conn.execute(
            f"SELECT id FROM faces WHERE file_id IN ({ph})", file_ids
        ).fetchall()]
        if face_ids:
            fph = ",".join("?" * len(face_ids))
            conn.execute(f"DELETE FROM faces_vec WHERE face_id IN ({fph})", face_ids)
        face_rows = conn.execute(f"DELETE FROM faces WHERE file_id IN ({ph})", file_ids)
        total_faces += face_rows.rowcount
        file_rows = conn.execute(f"DELETE FROM files WHERE id IN ({ph})", file_ids)
        total_files += file_rows.rowcount

        # Recount appearances for affected persons
        for pid in affected:
            count = conn.execute(
                "SELECT COUNT(*) AS c FROM faces WHERE cluster_id = ?", (pid,)
            ).fetchone()["c"]
            conn.execute("UPDATE persons SET appearance_count = ? WHERE id = ?", (count, pid))

        # Remove auto-generated persons now with 0 faces
        conn.execute("DELETE FROM persons WHERE name IS NULL AND appearance_count = 0")

    conn.commit()
    conn.close()
    return {"ok": True, "deleted_files": total_files, "deleted_faces": total_faces}


@router.post("/cluster")
def trigger_clustering(background_tasks: BackgroundTasks):
    """Manually trigger a full re-clustering pass."""
    def _do():
        conn = get_conn()
        run_full_clustering(conn)
        conn.close()
    background_tasks.add_task(_do)
    return {"status": "clustering started"}


def _job_row_to_out(row) -> JobStatus:
    return JobStatus(
        id=row["id"],
        status=row["status"],
        root_path=row["root_path"] or "",
        files_total=row["files_total"] or 0,
        files_done=row["files_done"] or 0,
        faces_found=row["faces_found"] or 0,
        error_msg=row["error_msg"],
        started_at=row["started_at"],
        finished_at=row["finished_at"],
    )
