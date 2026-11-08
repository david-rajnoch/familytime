"""
Person / cluster management endpoints.
"""
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, HTTPException, Query

from database import get_conn
from models.api import PersonOut, AppearanceOut, TimelineGroup, NameRequest, MergeRequest

router = APIRouter(prefix="/api/persons")


@router.get("", response_model=list[PersonOut])
def list_persons(
    named_only: bool = False,
    limit: int = Query(default=200, le=500),
    offset: int = 0,
):
    conn = get_conn()
    q = "SELECT * FROM persons"
    if named_only:
        q += " WHERE name IS NOT NULL"
    q += " ORDER BY appearance_count DESC LIMIT ? OFFSET ?"
    rows = conn.execute(q, (limit, offset)).fetchall()
    conn.close()
    return [_person_out(r) for r in rows]


@router.get("/unknown", response_model=list[AppearanceOut])
def list_unknown_faces(limit: int = Query(default=200, le=500), offset: int = 0):
    """Faces not assigned to any cluster (noise points)."""
    conn = get_conn()
    rows = conn.execute(
        """SELECT fa.id as face_id, fa.file_id, fa.source_timestamp_ms,
                  fa.bbox_x, fa.bbox_y, fa.bbox_w, fa.bbox_h, fa.detection_conf,
                  fi.path as file_path, fi.file_type, fi.taken_at, fi.folder_label
           FROM faces fa JOIN files fi ON fi.id = fa.file_id
           WHERE fa.cluster_id IS NULL
           ORDER BY fi.taken_at DESC
           LIMIT ? OFFSET ?""",
        (limit, offset),
    ).fetchall()
    conn.close()
    return [_appearance_out(r) for r in rows]


@router.get("/{person_id}", response_model=PersonOut)
def get_person(person_id: int):
    conn = get_conn()
    row = conn.execute("SELECT * FROM persons WHERE id = ?", (person_id,)).fetchone()
    conn.close()
    if not row:
        raise HTTPException(404, "Person not found")
    return _person_out(row)


@router.get("/{person_id}/timeline", response_model=list[TimelineGroup])
def get_timeline(
    person_id: int,
    limit: int = Query(default=20, le=100),
    offset: int = 0,
    order: str = Query(default="desc", pattern="^(asc|desc)$"),
):
    """
    Returns complete timeline groups sorted by date (newest first by default).
    Paginated by GROUP count so groups are never split across pages.
    """
    conn = get_conn()
    direction = "DESC" if order == "desc" else "ASC"

    # Step 1: get distinct groups sorted by their earliest date, paginated
    group_rows = conn.execute(
        f"""SELECT
               COALESCE(fi.folder_label,
                        CASE WHEN fi.taken_at IS NOT NULL
                             THEN substr(fi.taken_at, 1, 7)
                             ELSE 'Unknown Date' END
               ) as label,
               MIN(fi.taken_at) as first_date
           FROM faces fa JOIN files fi ON fi.id = fa.file_id
           WHERE fa.cluster_id = ?
           GROUP BY label
           ORDER BY COALESCE(first_date, CASE WHEN '{direction}' = 'DESC' THEN '9999-99-99' ELSE '0000-00-00' END) {direction}
           LIMIT ? OFFSET ?""",
        (person_id, limit, offset),
    ).fetchall()

    if not group_rows:
        conn.close()
        return []

    # Step 2: for each group fetch appearances (capped) + total counts
    MAX_PER_GROUP = 200
    labels = [r["label"] for r in group_rows]
    label_date = {r["label"]: r["first_date"] for r in group_rows}
    placeholders = ",".join("?" * len(labels))

    # Total count per group (needed to show "200 of N")
    count_rows = conn.execute(
        f"""SELECT
               COALESCE(fi.folder_label,
                        CASE WHEN fi.taken_at IS NOT NULL
                             THEN substr(fi.taken_at, 1, 7)
                             ELSE 'Unknown Date' END
               ) as group_label,
               COUNT(*) as n
            FROM faces fa JOIN files fi ON fi.id = fa.file_id
            WHERE fa.cluster_id = ?
              AND COALESCE(fi.folder_label,
                           CASE WHEN fi.taken_at IS NOT NULL
                                THEN substr(fi.taken_at, 1, 7)
                                ELSE 'Unknown Date' END
                  ) IN ({placeholders})
            GROUP BY group_label""",
        [person_id] + labels,
    ).fetchall()
    label_count = {r["group_label"]: r["n"] for r in count_rows}

    rows = conn.execute(
        f"""SELECT fa.id as face_id, fa.file_id, fa.source_timestamp_ms,
                   fa.bbox_x, fa.bbox_y, fa.bbox_w, fa.bbox_h, fa.detection_conf,
                   fi.path as file_path, fi.file_type, fi.taken_at, fi.folder_label,
                   COALESCE(fi.folder_label,
                            CASE WHEN fi.taken_at IS NOT NULL
                                 THEN substr(fi.taken_at, 1, 7)
                                 ELSE 'Unknown Date' END
                   ) as group_label
            FROM faces fa JOIN files fi ON fi.id = fa.file_id
            WHERE fa.cluster_id = ?
              AND COALESCE(fi.folder_label,
                           CASE WHEN fi.taken_at IS NOT NULL
                                THEN substr(fi.taken_at, 1, 7)
                                ELSE 'Unknown Date' END
                  ) IN ({placeholders})
            ORDER BY fi.taken_at DESC""",
        [person_id] + labels,
    ).fetchall()
    conn.close()

    # Bucket appearances into their groups, capped at MAX_PER_GROUP
    groups: dict[str, list] = {lbl: [] for lbl in labels}
    for row in rows:
        lbl = row["group_label"]
        if lbl in groups and len(groups[lbl]) < MAX_PER_GROUP:
            groups[lbl].append(_appearance_out(row))

    return [
        TimelineGroup(
            label=lbl,
            date=label_date[lbl],
            appearances=groups[lbl],
            total_count=label_count.get(lbl, len(groups[lbl])),
        )
        for lbl in labels
        if groups[lbl]
    ]


@router.get("/{person_id}/faces", response_model=list[AppearanceOut])
def get_sample_faces(person_id: int, limit: int = 24):
    conn = get_conn()
    rows = conn.execute(
        """SELECT fa.id as face_id, fa.file_id, fa.source_timestamp_ms,
                  fa.bbox_x, fa.bbox_y, fa.bbox_w, fa.bbox_h, fa.detection_conf,
                  fi.path as file_path, fi.file_type, fi.taken_at, fi.folder_label
           FROM faces fa JOIN files fi ON fi.id = fa.file_id
           WHERE fa.cluster_id = ?
           ORDER BY fa.detection_conf DESC
           LIMIT ?""",
        (person_id, limit),
    ).fetchall()
    conn.close()
    return [_appearance_out(r) for r in rows]


@router.post("/{person_id}/thumbnail/{face_id}")
def set_thumbnail(person_id: int, face_id: int):
    conn = get_conn()
    if not conn.execute("SELECT id FROM persons WHERE id = ?", (person_id,)).fetchone():
        conn.close()
        raise HTTPException(404, "Person not found")
    if not conn.execute("SELECT id FROM faces WHERE id = ? AND cluster_id = ?", (face_id, person_id)).fetchone():
        conn.close()
        raise HTTPException(404, "Face not found for this person")
    conn.execute("UPDATE persons SET thumbnail_face_id = ? WHERE id = ?", (face_id, person_id))
    conn.commit()
    conn.close()
    return {"ok": True}


@router.post("/{person_id}/name")
def set_name(person_id: int, req: NameRequest):
    conn = get_conn()
    row = conn.execute("SELECT id FROM persons WHERE id = ?", (person_id,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(404, "Person not found")
    conn.execute("UPDATE persons SET name = ? WHERE id = ?", (req.name, person_id))
    conn.commit()
    conn.close()
    return {"ok": True}


@router.post("/merge")
def merge_persons(req: MergeRequest):
    """Move all faces from source_id into target_id, then delete source."""
    conn = get_conn()
    for pid in (req.source_id, req.target_id):
        if not conn.execute("SELECT id FROM persons WHERE id = ?", (pid,)).fetchone():
            conn.close()
            raise HTTPException(404, f"Person {pid} not found")

    count = conn.execute(
        "SELECT COUNT(*) as c FROM faces WHERE cluster_id = ?", (req.source_id,)
    ).fetchone()["c"]

    conn.execute(
        "UPDATE faces SET cluster_id = ? WHERE cluster_id = ?",
        (req.target_id, req.source_id),
    )
    conn.execute(
        """INSERT INTO person_merges (source_person_id, target_person_id, merged_at, face_count_moved)
           VALUES (?, ?, ?, ?)""",
        (req.source_id, req.target_id, datetime.utcnow().isoformat(), count),
    )
    # Update appearance count on target
    conn.execute(
        "UPDATE persons SET appearance_count = (SELECT COUNT(*) FROM faces WHERE cluster_id = ?) WHERE id = ?",
        (req.target_id, req.target_id),
    )
    conn.execute("DELETE FROM persons WHERE id = ?", (req.source_id,))
    conn.commit()
    conn.close()
    return {"ok": True, "faces_moved": count}


@router.post("/{person_id}/remove_face/{face_id}")
def remove_face(person_id: int, face_id: int):
    """Unassign a face from a person (mark as noise)."""
    conn = get_conn()
    conn.execute(
        "UPDATE faces SET cluster_id = NULL WHERE id = ? AND cluster_id = ?",
        (face_id, person_id),
    )
    conn.execute(
        "UPDATE persons SET appearance_count = appearance_count - 1 WHERE id = ?",
        (person_id,),
    )
    conn.commit()
    conn.close()
    return {"ok": True}



@router.post("/{person_id}/assign_face/{face_id}")
def assign_face(person_id: int, face_id: int):
    """Manually assign an unknown face to a person."""
    conn = get_conn()
    conn.execute(
        "UPDATE faces SET cluster_id = ?, manually_verified = 1 WHERE id = ?",
        (person_id, face_id),
    )
    conn.execute(
        "UPDATE persons SET appearance_count = (SELECT COUNT(*) FROM faces WHERE cluster_id = ?) WHERE id = ?",
        (person_id, person_id),
    )
    conn.commit()
    conn.close()
    return {"ok": True}


# ── Helpers ───────────────────────────────────────────────────────────────────

def _person_out(row) -> PersonOut:
    return PersonOut(
        id=row["id"],
        name=row["name"],
        appearance_count=row["appearance_count"] or 0,
        date_first_seen=row["date_first_seen"],
        date_last_seen=row["date_last_seen"],
        thumbnail_face_id=row["thumbnail_face_id"],
        notes=row["notes"],
    )


def _appearance_out(row) -> AppearanceOut:
    return AppearanceOut(
        face_id=row["face_id"],
        file_id=row["file_id"],
        file_path=row["file_path"],
        file_type=row["file_type"],
        taken_at=row["taken_at"],
        folder_label=row["folder_label"],
        source_timestamp_ms=row["source_timestamp_ms"],
        bbox_x=row["bbox_x"],
        bbox_y=row["bbox_y"],
        bbox_w=row["bbox_w"],
        bbox_h=row["bbox_h"],
        detection_conf=row["detection_conf"],
    )
