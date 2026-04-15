import sqlite3
import sqlite_vec
from pathlib import Path
from config import settings


def get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(settings.db_path, check_same_thread=False, timeout=60)
    conn.row_factory = sqlite3.Row
    conn.enable_load_extension(True)
    sqlite_vec.load(conn)
    conn.enable_load_extension(False)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=60000")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db():
    Path(settings.db_path).parent.mkdir(parents=True, exist_ok=True)
    Path(settings.thumbs_dir).mkdir(parents=True, exist_ok=True)
    conn = get_conn()
    schema = (Path(__file__).parent / "schema.sql").read_text()
    conn.executescript(schema)
    # sqlite-vec virtual table (rebuilt from embeddings BLOB if needed)
    conn.execute("""
        CREATE VIRTUAL TABLE IF NOT EXISTS faces_vec USING vec0(
            face_id INTEGER PRIMARY KEY,
            embedding FLOAT[512]
        )
    """)
    # Migration: ensure composite indexes exist in live DB
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_faces_cluster_conf ON faces(cluster_id, detection_conf DESC)"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_faces_cluster_null ON faces(cluster_id) WHERE cluster_id IS NULL"
    )
    # Migration: add columns that may be missing from DBs created before schema updates
    _add_column_if_missing(conn, "persons", "thumbnail_face_id", "INTEGER REFERENCES faces(id) ON DELETE SET NULL")
    _add_column_if_missing(conn, "persons", "notes", "TEXT")
    _add_column_if_missing(conn, "files", "face_extracted_at", "TEXT")
    # Clean up orphaned faces_vec entries (vec0 doesn't participate in FK cascades)
    conn.execute("DELETE FROM faces_vec WHERE face_id NOT IN (SELECT id FROM faces)")
    conn.commit()
    conn.close()


def _add_column_if_missing(conn: sqlite3.Connection, table: str, column: str, col_def: str) -> None:
    existing = {row[1] for row in conn.execute(f"PRAGMA table_info({table})")}
    if column not in existing:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {col_def}")
