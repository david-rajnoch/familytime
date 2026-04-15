"""
Similarity search via sqlite-vec ANN index.
"""
from fastapi import APIRouter, HTTPException, Query

from database import get_conn
from models.api import AppearanceOut

router = APIRouter(prefix="/api/search")


@router.get("/similar/{face_id}", response_model=list[AppearanceOut])
def similar_faces(face_id: int, limit: int = Query(default=20, le=100)):
    """Find faces most similar to the given face_id using ANN vector search."""
    conn = get_conn()

    emb_row = conn.execute(
        "SELECT embedding FROM faces WHERE id = ?", (face_id,)
    ).fetchone()
    if not emb_row:
        conn.close()
        raise HTTPException(404, "Face not found")

    emb_blob = bytes(emb_row["embedding"])

    rows = conn.execute(
        """SELECT fv.face_id, fv.distance
           FROM faces_vec fv
           WHERE fv.embedding MATCH ? AND k = ?
           ORDER BY fv.distance""",
        (emb_blob, limit + 1),  # +1 because self will be in results
    ).fetchall()

    # Skip self
    face_ids = [r["face_id"] for r in rows if r["face_id"] != face_id][:limit]

    if not face_ids:
        conn.close()
        return []

    placeholders = ",".join("?" * len(face_ids))
    result_rows = conn.execute(
        f"""SELECT fa.id as face_id, fa.file_id, fa.source_timestamp_ms,
                   fa.bbox_x, fa.bbox_y, fa.bbox_w, fa.bbox_h, fa.detection_conf,
                   fi.path as file_path, fi.file_type, fi.taken_at, fi.folder_label
            FROM faces fa JOIN files fi ON fi.id = fa.file_id
            WHERE fa.id IN ({placeholders})""",
        face_ids,
    ).fetchall()
    conn.close()

    return [
        AppearanceOut(
            face_id=r["face_id"],
            file_id=r["file_id"],
            file_path=r["file_path"],
            file_type=r["file_type"],
            taken_at=r["taken_at"],
            folder_label=r["folder_label"],
            source_timestamp_ms=r["source_timestamp_ms"],
            bbox_x=r["bbox_x"],
            bbox_y=r["bbox_y"],
            bbox_w=r["bbox_w"],
            bbox_h=r["bbox_h"],
            detection_conf=r["detection_conf"],
        )
        for r in result_rows
    ]
