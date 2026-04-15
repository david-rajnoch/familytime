from dataclasses import dataclass
from typing import Optional


@dataclass
class FileRecord:
    id: int
    path: str
    fast_hash: str
    file_type: str
    size_bytes: Optional[int]
    duration_ms: Optional[int]
    width: Optional[int]
    height: Optional[int]
    taken_at: Optional[str]
    folder_label: Optional[str]
    indexed_at: Optional[str]
    drive_label: Optional[str]


@dataclass
class FaceRecord:
    id: int
    file_id: int
    source_timestamp_ms: Optional[int]
    bbox_x: float
    bbox_y: float
    bbox_w: float
    bbox_h: float
    detection_conf: float
    cluster_id: Optional[int]
    manually_verified: int


@dataclass
class PersonRecord:
    id: int
    name: Optional[str]
    created_at: str
    thumbnail_face_id: Optional[int]
    appearance_count: int
    date_first_seen: Optional[str]
    date_last_seen: Optional[str]
    notes: Optional[str]
