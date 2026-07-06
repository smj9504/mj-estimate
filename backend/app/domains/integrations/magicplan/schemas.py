"""
MagicPlan integration schemas for API requests/responses
"""

from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


# ── MagicPlan API Response Models ────────────────────────────

class MagicPlanFloor(BaseModel):
    """Floor data from MagicPlan plan"""
    id: Optional[str] = None
    name: Optional[str] = None
    label: Optional[str] = None
    order: Optional[int] = None
    ceiling_height: Optional[float] = None
    rooms: Optional[List[Dict[str, Any]]] = None
    notes: Optional[List[Dict[str, Any]]] = None


class MagicPlanPlan(BaseModel):
    """Plan data from MagicPlan project"""
    id: str
    title: Optional[str] = None
    floors: Optional[List[MagicPlanFloor]] = None
    door_count: Optional[int] = None
    windows_count: Optional[int] = None


class MagicPlanImage(BaseModel):
    """Image/photo from MagicPlan"""
    id: Optional[str] = None
    url: Optional[str] = None
    thumbnail_url: Optional[str] = None
    title: Optional[str] = None
    description: Optional[str] = None
    floor_id: Optional[str] = None
    floor_name: Optional[str] = None
    room_id: Optional[str] = None
    room_name: Optional[str] = None
    created_at: Optional[str] = None
    file_type: Optional[str] = None  # 'photo', 'floor_plan'


class MagicPlanProject(BaseModel):
    """MagicPlan project summary"""
    id: str
    title: Optional[str] = None
    name: Optional[str] = None  # alias for title
    address: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None
    plans: Optional[List[MagicPlanPlan]] = None
    photo_count: Optional[int] = None

    @property
    def display_name(self) -> str:
        return self.title or self.name or f"Project {self.id}"


# ── Request Models ───────────────────────────────────────────

class MagicPlanSyncRequest(BaseModel):
    """Request to sync photos from MagicPlan project"""
    magicplan_project_id: str
    magicplan_project_name: Optional[str] = None
    sync_photos: bool = True
    sync_floor_plans: bool = True


class MagicPlanProjectSearchRequest(BaseModel):
    """Request to search MagicPlan projects"""
    query: Optional[str] = None
    job_address: Optional[str] = None


class MagicPlanFloorPlanImportRequest(BaseModel):
    """Request to import a floor plan from MagicPlan into WM sketch"""
    magicplan_project_id: str
    plan_id: str
    floor_id: Optional[str] = None
    floor_index: Optional[int] = 0  # Which floor's image to import
    target_wm_floor_id: Optional[str] = None  # Existing WM floor to update


# ── Response Models ──────────────────────────────────────────

class MagicPlanProjectMatch(BaseModel):
    """A matched MagicPlan project with confidence score"""
    project_id: str
    project_name: str
    address: Optional[str] = None
    match_score: float = 0.0
    match_type: str = "manual"  # 'auto', 'fuzzy', 'manual'
    photo_count: Optional[int] = None
    plan_count: Optional[int] = None
    created_at: Optional[str] = None


class MagicPlanProjectSearchResponse(BaseModel):
    """Response from searching MagicPlan projects"""
    auto_match: Optional[MagicPlanProjectMatch] = None
    candidates: List[MagicPlanProjectMatch] = []
    total_projects: int = 0


class MagicPlanSyncStatus(BaseModel):
    """Status of a MagicPlan sync operation"""
    status: str  # 'in_progress', 'completed', 'failed'
    photos_synced: int = 0
    photos_skipped: int = 0
    floor_plans_synced: int = 0
    total_items: int = 0
    error_message: Optional[str] = None


class MagicPlanSyncResult(BaseModel):
    """Result of a MagicPlan sync operation"""
    success: bool
    photos_synced: int = 0
    photos_skipped: int = 0
    floor_plans_synced: int = 0
    errors: List[str] = []
    magicplan_project_id: str = ""
    magicplan_project_name: str = ""


class MagicPlanFloorPlanInfo(BaseModel):
    """Info about available floor plans from MagicPlan"""
    plan_id: str
    plan_title: Optional[str] = None
    floors: List[Dict[str, Any]] = []
    file_urls: Dict[str, str] = {}  # floor_index -> image_url


class MagicPlanFloorPlanImportResult(BaseModel):
    """Result of importing a floor plan into WM sketch"""
    success: bool
    wm_floor_id: Optional[str] = None
    floor_label: Optional[str] = None
    image_url: Optional[str] = None
    error_message: Optional[str] = None
