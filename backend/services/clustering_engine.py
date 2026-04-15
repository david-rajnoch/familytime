"""
Cluster face embeddings into person identities using UMAP + HDBSCAN.
"""
import logging
import sqlite3
from datetime import datetime
from typing import Optional

import numpy as np

from services.photo_processor import EMBEDDING_BYTES

logger = logging.getLogger(__name__)


def _load_embeddings(conn: sqlite3.Connection) -> tuple[np.ndarray, list[int]]:
    """Return (embeddings array [N, 512], face_id list [N])."""
    rows = conn.execute("SELECT id, embedding FROM faces").fetchall()
    if not rows:
        return np.empty((0, 512), dtype=np.float32), []

    face_ids = []
    blobs = []
    for row in rows:
        blob = bytes(row["embedding"])
        if len(blob) != EMBEDDING_BYTES:
            logger.warning("Skipping face id=%d: bad embedding size %d", row["id"], len(blob))
            continue
        face_ids.append(row["id"])
        blobs.append(np.frombuffer(blob, dtype=np.float32).copy())

    if not blobs:
        return np.empty((0, 512), dtype=np.float32), []

    embeddings = np.stack(blobs, axis=0)
    return embeddings, face_ids


def _pick_thumbnail(fids: list[int], conn: sqlite3.Connection) -> int:
    """Pick the face with highest detection confidence as cluster thumbnail."""
    placeholders = ",".join("?" * len(fids))
    row = conn.execute(
        f"SELECT id FROM faces WHERE id IN ({placeholders}) ORDER BY detection_conf DESC LIMIT 1",
        fids,
    ).fetchone()
    return row["id"] if row else fids[0]


def _get_date_range(fids: list[int], conn: sqlite3.Connection) -> tuple[Optional[str], Optional[str]]:
    """Return (first_seen, last_seen) ISO8601 strings for a set of face IDs."""
    placeholders = ",".join("?" * len(fids))
    rows = conn.execute(
        f"""SELECT f.taken_at FROM files f
            JOIN faces fa ON fa.file_id = f.id
            WHERE fa.id IN ({placeholders}) AND f.taken_at IS NOT NULL
            ORDER BY f.taken_at""",
        fids,
    ).fetchall()
    dates = [r["taken_at"] for r in rows]
    return (dates[0] if dates else None, dates[-1] if dates else None)


def run_full_clustering(conn: sqlite3.Connection, job_id: Optional[int] = None):
    """
    Full UMAP + HDBSCAN clustering pass. Wipes existing auto-assigned clusters (name IS NULL).
    Named persons are preserved and their faces re-matched.
    """
    import hdbscan

    embeddings, face_ids = _load_embeddings(conn)
    n = len(face_ids)
    logger.info("Clustering %d face embeddings", n)

    if n < 3:
        logger.warning("Too few faces (%d) to cluster", n)
        return

    if job_id:
        conn.execute("UPDATE indexing_jobs SET status = 'clustering' WHERE id = ?", (job_id,))
        conn.commit()

    # HDBSCAN directly on 512-d ArcFace embeddings.
    # No UMAP — ArcFace is trained so cosine distance IS identity distance.
    # ArcFace normed_embedding is already L2-normalized, so euclidean distance
    # on unit vectors == sqrt(2 * cosine_distance). We normalize to be safe,
    # then use euclidean with epsilon converted from cosine space:
    #   cosine_dist 0.40 → euclidean sqrt(2*0.40) ≈ 0.894
    #   (cosine similarity ~0.60 = reliably same person threshold)
    norms = np.linalg.norm(embeddings, axis=1, keepdims=True)
    norms = np.where(norms == 0, 1.0, norms)
    embeddings_normed = embeddings / norms

    try:
        clusterer = hdbscan.HDBSCAN(
            min_cluster_size=3,
            min_samples=1,
            metric="euclidean",
            cluster_selection_method="leaf",   # avoids over-splitting families
            cluster_selection_epsilon=0.894,   # ≈ cosine_dist 0.40
        )
        labels = clusterer.fit_predict(embeddings_normed)
    except Exception as e:
        logger.error("HDBSCAN clustering failed: %s", e)
        return

    unique_labels = set(labels)
    n_clusters = len(unique_labels - {-1})
    n_noise = int(np.sum(labels == -1))
    logger.info("Clustering result: %d clusters, %d noise points", n_clusters, n_noise)

    # Snapshot which faces currently belong to each named person BEFORE wiping.
    # Used after clustering to re-link new clusters back to existing named persons.
    named_face_sets: dict[int, set[int]] = {}  # person_id -> set of face_ids
    for row in conn.execute(
        "SELECT p.id, fa.id as fid FROM persons p "
        "JOIN faces fa ON fa.cluster_id = p.id WHERE p.name IS NOT NULL"
    ).fetchall():
        named_face_sets.setdefault(row["id"], set()).add(row["fid"])

    # Delete auto-created persons (those without names) and reset face assignments
    conn.execute("DELETE FROM persons WHERE name IS NULL")
    conn.execute("UPDATE faces SET cluster_id = NULL")
    conn.commit()

    # Group face_ids by cluster label
    cluster_map: dict[int, list[int]] = {}
    for face_id, label in zip(face_ids, labels):
        cluster_map.setdefault(int(label), []).append(face_id)

    now = datetime.utcnow().isoformat()
    claimed_person_ids: set[int] = set()  # named persons already matched

    for label, fids in cluster_map.items():
        if label == -1 or not fids:
            continue

        thumb_face_id = _pick_thumbnail(fids, conn)
        first_seen, last_seen = _get_date_range(fids, conn)
        fid_set = set(fids)

        # Try to match this cluster to an unclaimed named person by face overlap
        best_person_id: Optional[int] = None
        best_overlap = 0
        for pid, old_fids in named_face_sets.items():
            if pid in claimed_person_ids:
                continue
            overlap = len(fid_set & old_fids)
            if overlap > best_overlap:
                best_overlap = overlap
                best_person_id = pid

        # Require at least 30% of the cluster OR 3 faces to match (avoids false positives)
        if best_person_id is not None and (best_overlap >= max(3, len(fids) * 0.30)):
            person_id = best_person_id
            claimed_person_ids.add(person_id)
            conn.execute(
                """UPDATE persons SET thumbnail_face_id=?, appearance_count=?,
                   date_first_seen=?, date_last_seen=? WHERE id=?""",
                (thumb_face_id, len(fids), first_seen, last_seen, person_id),
            )
            logger.info("Re-linked cluster (label=%d, %d faces) → named person id=%d (overlap=%d)",
                        label, len(fids), person_id, best_overlap)
        else:
            cur = conn.execute(
                """INSERT INTO persons
                   (name, created_at, thumbnail_face_id, appearance_count, date_first_seen, date_last_seen)
                   VALUES (NULL, ?, ?, ?, ?, ?)""",
                (now, thumb_face_id, len(fids), first_seen, last_seen),
            )
            person_id = cur.lastrowid

        placeholders = ",".join("?" * len(fids))
        conn.execute(
            f"UPDATE faces SET cluster_id = ? WHERE id IN ({placeholders})",
            [person_id] + fids,
        )

    # Any named persons that weren't matched still exist in the DB but have 0 faces.
    # Update their appearance_count to reflect reality.
    unmatched = set(named_face_sets.keys()) - claimed_person_ids
    for pid in unmatched:
        conn.execute("UPDATE persons SET appearance_count = 0 WHERE id = ?", (pid,))
        logger.warning("Named person id=%d lost all faces after re-clustering", pid)

    conn.commit()
    logger.info("Clustering complete: %d clusters, %d re-linked to named persons",
                n_clusters, len(claimed_person_ids))


def run_incremental_clustering(conn: sqlite3.Connection, since_face_id: int):
    """
    Assign newly indexed faces to existing persons where similarity > 0.68,
    then cluster the residuals and merge into persons table.
    """
    import hdbscan

    new_rows = conn.execute(
        "SELECT id, embedding FROM faces WHERE id > ? AND cluster_id IS NULL",
        (since_face_id,),
    ).fetchall()
    if not new_rows:
        return

    new_ids = []
    new_embs_list = []
    for r in new_rows:
        blob = bytes(r["embedding"])
        if len(blob) != EMBEDDING_BYTES:
            continue
        new_ids.append(r["id"])
        new_embs_list.append(np.frombuffer(blob, dtype=np.float32).copy())

    if not new_ids:
        return

    new_embs = np.stack(new_embs_list, axis=0)

    # Load existing person centroids (use thumbnail face embedding as centroid)
    person_rows = conn.execute(
        "SELECT p.id, f.embedding FROM persons p JOIN faces f ON f.id = p.thumbnail_face_id"
    ).fetchall()

    assigned: set[int] = set()
    if person_rows:
        person_ids = []
        person_embs_list = []
        for r in person_rows:
            blob = bytes(r["embedding"])
            if len(blob) != EMBEDDING_BYTES:
                continue
            person_ids.append(r["id"])
            person_embs_list.append(np.frombuffer(blob, dtype=np.float32).copy())

        if person_embs_list:
            person_embs = np.stack(person_embs_list, axis=0)
            # Batch cosine similarity: (P, 512) @ (512, N) -> (P, N)
            new_norms = np.linalg.norm(new_embs, axis=1, keepdims=True) + 1e-9
            person_norms = np.linalg.norm(person_embs, axis=1, keepdims=True) + 1e-9
            sims = (person_embs / person_norms) @ (new_embs / new_norms).T  # (P, N)

            for i, fid in enumerate(new_ids):
                best_person_idx = int(np.argmax(sims[:, i]))
                if sims[best_person_idx, i] >= 0.68:
                    conn.execute(
                        "UPDATE faces SET cluster_id = ? WHERE id = ?",
                        (person_ids[best_person_idx], fid),
                    )
                    assigned.add(fid)

    conn.commit()

    # Cluster residuals
    id_to_idx = {fid: i for i, fid in enumerate(new_ids)}
    residual_ids = [fid for fid in new_ids if fid not in assigned]

    if len(residual_ids) < 3:
        return

    residual_embs = np.stack([new_embs[id_to_idx[fid]] for fid in residual_ids])
    n = len(residual_ids)

    try:
        norms = np.linalg.norm(residual_embs, axis=1, keepdims=True)
        norms = np.where(norms == 0, 1.0, norms)
        residual_normed = residual_embs / norms
        clusterer = hdbscan.HDBSCAN(
            min_cluster_size=3,
            min_samples=1,
            metric="euclidean",
            cluster_selection_method="leaf",
            cluster_selection_epsilon=0.894,
        )
        labels = clusterer.fit_predict(residual_normed)
    except Exception as e:
        logger.error("Incremental clustering failed: %s", e)
        return

    now = datetime.utcnow().isoformat()
    cluster_map: dict[int, list[int]] = {}
    for fid, label in zip(residual_ids, labels):
        cluster_map.setdefault(int(label), []).append(fid)

    for label, fids in cluster_map.items():
        if label == -1 or not fids:
            continue
        thumb_face_id = _pick_thumbnail(fids, conn)
        first_seen, last_seen = _get_date_range(fids, conn)
        cur = conn.execute(
            """INSERT INTO persons
               (name, created_at, thumbnail_face_id, appearance_count, date_first_seen, date_last_seen)
               VALUES (NULL, ?, ?, ?, ?, ?)""",
            (now, thumb_face_id, len(fids), first_seen, last_seen),
        )
        person_id = cur.lastrowid
        placeholders = ",".join("?" * len(fids))
        conn.execute(
            f"UPDATE faces SET cluster_id = ? WHERE id IN ({placeholders})",
            [person_id] + fids,
        )

    conn.commit()
