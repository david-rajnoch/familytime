CREATE TABLE IF NOT EXISTS files (
    id          INTEGER PRIMARY KEY,
    path        TEXT NOT NULL,
    fast_hash   TEXT NOT NULL UNIQUE,
    file_type   TEXT NOT NULL,       -- 'photo' | 'video'
    size_bytes  INTEGER,
    duration_ms INTEGER,             -- null for photos
    width       INTEGER,
    height      INTEGER,
    taken_at    TEXT,                -- ISO8601 from EXIF; fallback to mtime
    folder_label TEXT,               -- cleaned parent folder name e.g. "Beach Vacation"
    indexed_at  TEXT,
    drive_label TEXT
);
CREATE INDEX IF NOT EXISTS files_taken_at  ON files(taken_at);
CREATE INDEX IF NOT EXISTS files_drive     ON files(drive_label);
CREATE INDEX IF NOT EXISTS files_hash      ON files(fast_hash);

CREATE TABLE IF NOT EXISTS faces (
    id                  INTEGER PRIMARY KEY,
    file_id             INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
    source_timestamp_ms INTEGER,     -- null for photos; ms offset into video
    bbox_x              REAL,        -- normalized 0-1
    bbox_y              REAL,
    bbox_w              REAL,
    bbox_h              REAL,
    detection_conf      REAL,
    cluster_id          INTEGER REFERENCES persons(id) ON DELETE SET NULL,
    embedding           BLOB NOT NULL,   -- 512 x float32 LE = 2048 bytes
    manually_verified   INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS faces_file_id        ON faces(file_id);
CREATE INDEX IF NOT EXISTS faces_cluster        ON faces(cluster_id);
CREATE INDEX IF NOT EXISTS idx_faces_cluster_conf ON faces(cluster_id, detection_conf DESC);
CREATE INDEX IF NOT EXISTS idx_faces_cluster_null ON faces(cluster_id) WHERE cluster_id IS NULL;

CREATE TABLE IF NOT EXISTS persons (
    id                  INTEGER PRIMARY KEY,
    name                TEXT,
    created_at          TEXT,
    thumbnail_face_id   INTEGER REFERENCES faces(id) ON DELETE SET NULL,
    appearance_count    INTEGER DEFAULT 0,
    date_first_seen     TEXT,
    date_last_seen      TEXT,
    notes               TEXT
);

CREATE TABLE IF NOT EXISTS person_merges (
    id                  INTEGER PRIMARY KEY,
    source_person_id    INTEGER,
    target_person_id    INTEGER,
    merged_at           TEXT,
    face_count_moved    INTEGER
);

CREATE TABLE IF NOT EXISTS indexing_jobs (
    id              INTEGER PRIMARY KEY,
    started_at      TEXT,
    finished_at     TEXT,
    root_path       TEXT,
    status          TEXT DEFAULT 'running',  -- 'running'|'done'|'error'|'clustering'
    files_total     INTEGER DEFAULT 0,
    files_done      INTEGER DEFAULT 0,
    faces_found     INTEGER DEFAULT 0,
    error_msg       TEXT
);

CREATE TABLE IF NOT EXISTS thumbnails (
    face_id         INTEGER PRIMARY KEY REFERENCES faces(id) ON DELETE CASCADE,
    jpeg_data       BLOB,
    generated_at    TEXT
);
