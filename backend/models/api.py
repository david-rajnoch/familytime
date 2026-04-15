from pydantic import BaseModel
from typing import Optional


class PersonOut(BaseModel):
    id: int
    name: Optional[str]
    appearance_count: int
    date_first_seen: Optional[str]
    date_last_seen: Optional[str]
    thumbnail_face_id: Optional[int]
    notes: Optional[str]


class AppearanceOut(BaseModel):
    face_id: int
    file_id: int
    file_path: str
    file_type: str
    taken_at: Optional[str]
    folder_label: Optional[str]
    source_timestamp_ms: Optional[int]
    bbox_x: float
    bbox_y: float
    bbox_w: float
    bbox_h: float
    detection_conf: float


class TimelineGroup(BaseModel):
    label: str          # folder_label or "YYYY-MM"
    date: Optional[str] # earliest date in group
    appearances: list[AppearanceOut]


class JobStatus(BaseModel):
    id: int
    status: str
    root_path: str
    files_total: int
    files_done: int
    faces_found: int
    error_msg: Optional[str]
    started_at: Optional[str]
    finished_at: Optional[str]


class StartIndexRequest(BaseModel):
    path: str
    video_sample_interval_s: int = 3
    scene_detection: bool = True


class NameRequest(BaseModel):
    name: str


class MergeRequest(BaseModel):
    source_id: int
    target_id: int
