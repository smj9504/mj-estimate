"""
Xactimate Helper Tool - Repository (Data Access Layer)
"""

import logging
from typing import Any, Dict, List, Optional
from uuid import UUID

from sqlalchemy import and_, desc, func, or_, text
from sqlalchemy.exc import DataError, ProgrammingError
from sqlalchemy.orm import Session, joinedload

from app.core.database_factory import get_database

from .models import (
    PGVECTOR_AVAILABLE,
    XactAssembly,
    XactAssemblyItem,
    XactCorrectionFeedback,
    XactItemDescription,
    XactLineItem,
    XactRoom,
)

logger = logging.getLogger(__name__)


class XactLineItemRepository:
    """Data access for xact_line_items."""

    def __init__(self, session: Session):
        self.session = session

    def get_by_code(self, item_code: str) -> Optional[XactLineItem]:
        return (
            self.session.query(XactLineItem)
            .filter(XactLineItem.item_code == item_code)
            .first()
        )

    def get_by_id(self, item_id: UUID) -> Optional[XactLineItem]:
        return (
            self.session.query(XactLineItem)
            .filter(XactLineItem.id == item_id)
            .first()
        )

    def search(
        self,
        query: Optional[str] = None,
        category: Optional[str] = None,
        is_active: Optional[bool] = True,
        limit: int = 20,
        offset: int = 0,
    ) -> List[XactLineItem]:
        q = self.session.query(XactLineItem)
        if is_active is not None:
            q = q.filter(XactLineItem.is_active == is_active)
        if category:
            q = q.filter(XactLineItem.category == category)
        if query:
            pattern = f"%{query}%"
            q = q.filter(
                or_(
                    XactLineItem.item_code.ilike(pattern),
                    XactLineItem.description.ilike(pattern),
                )
            )
        return q.order_by(XactLineItem.item_code).offset(offset).limit(limit).all()

    def count(
        self,
        query: Optional[str] = None,
        category: Optional[str] = None,
        is_active: Optional[bool] = True,
    ) -> int:
        q = self.session.query(func.count(XactLineItem.id))
        if is_active is not None:
            q = q.filter(XactLineItem.is_active == is_active)
        if category:
            q = q.filter(XactLineItem.category == category)
        if query:
            pattern = f"%{query}%"
            q = q.filter(
                or_(
                    XactLineItem.item_code.ilike(pattern),
                    XactLineItem.description.ilike(pattern),
                )
            )
        return q.scalar() or 0

    def get_categories(self) -> List[str]:
        rows = (
            self.session.query(XactLineItem.category)
            .distinct()
            .order_by(XactLineItem.category)
            .all()
        )
        return [r[0] for r in rows]

    def vector_search(
        self, embedding: List[float], limit: int = 8, is_active: bool = True
    ) -> List[XactLineItem]:
        """Cosine similarity search using pgvector."""
        if not PGVECTOR_AVAILABLE:
            logger.warning("pgvector not available; vector_search returning empty")
            return []

        q = self.session.query(XactLineItem)
        if is_active:
            q = q.filter(XactLineItem.is_active == True)
        q = q.filter(XactLineItem.embedding.isnot(None))
        # pgvector cosine distance: <=> operator
        q = q.order_by(XactLineItem.embedding.cosine_distance(embedding))
        try:
            return q.limit(limit).all()
        except (ProgrammingError, DataError):
            # The column is still jsonb (migration xv20260904vec01 not applied
            # yet), so `<=>` does not exist. Callers treat an empty result as
            # "no vector hits" and fall back to text search, which is far
            # better than a 500 from a half-migrated database.
            self.session.rollback()
            logger.warning(
                "vector_search unavailable (embedding column is not vector); "
                "returning empty so callers fall back to text search"
            )
            return []

    def get_items_without_embedding(self, category: Optional[str] = None, limit: int = 500) -> List[XactLineItem]:
        q = self.session.query(XactLineItem).filter(
            XactLineItem.is_active == True,
        )
        if PGVECTOR_AVAILABLE:
            q = q.filter(XactLineItem.embedding.is_(None))
        else:
            # On a pre-migration jsonb column every row holds JSON `null`,
            # which is NOT SQL NULL - is_(None) matches nothing and the sync
            # would report "all items already embedded" while embedding none.
            q = q.filter(
                or_(
                    XactLineItem.embedding.is_(None),
                    func.jsonb_typeof(XactLineItem.embedding) == "null",
                )
            )
        if category:
            q = q.filter(XactLineItem.category == category)
        return q.limit(limit).all()

    def bulk_update_embeddings(self, updates: List[Dict[str, Any]]) -> int:
        """Batch update embeddings. Each dict: {'item_code': ..., 'embedding': [...]}"""
        count = 0
        for u in updates:
            item = self.get_by_code(u["item_code"])
            if item:
                item.embedding = u["embedding"]
                count += 1
        self.session.flush()
        return count

    def create(self, data: Dict[str, Any]) -> XactLineItem:
        item = XactLineItem(**data)
        self.session.add(item)
        self.session.flush()
        return item

    def bulk_create(self, items_data: List[Dict[str, Any]]) -> int:
        objects = [XactLineItem(**d) for d in items_data]
        self.session.bulk_save_objects(objects)
        self.session.flush()
        return len(objects)

    def update(self, item_code: str, data: Dict[str, Any]) -> Optional[XactLineItem]:
        item = self.get_by_code(item_code)
        if not item:
            return None
        for k, v in data.items():
            if hasattr(item, k):
                setattr(item, k, v)
        self.session.flush()
        return item


class XactAssemblyRepository:
    """Data access for xact_assemblies + xact_assembly_items."""

    def __init__(self, session: Session):
        self.session = session

    def get_all(
        self,
        damage_type: Optional[str] = None,
        room_type: Optional[str] = None,
        is_active: bool = True,
    ) -> List[XactAssembly]:
        q = self.session.query(XactAssembly).options(
            joinedload(XactAssembly.items)
        )
        if is_active:
            q = q.filter(XactAssembly.is_active == True)
        if damage_type:
            q = q.filter(XactAssembly.damage_type == damage_type)
        if room_type:
            q = q.filter(
                or_(XactAssembly.room_type == room_type, XactAssembly.room_type == "any")
            )
        return q.order_by(XactAssembly.name).all()

    def get_by_id(self, assembly_id: UUID) -> Optional[XactAssembly]:
        return (
            self.session.query(XactAssembly)
            .options(joinedload(XactAssembly.items))
            .filter(XactAssembly.id == assembly_id)
            .first()
        )

    def find_by_keywords(
        self, keywords: List[str], damage_type: Optional[str] = None
    ) -> List[XactAssembly]:
        """Find assemblies whose trigger_keywords overlap with given keywords."""
        q = self.session.query(XactAssembly).options(
            joinedload(XactAssembly.items)
        ).filter(XactAssembly.is_active == True)
        if damage_type:
            q = q.filter(XactAssembly.damage_type == damage_type)
        # PostgreSQL ARRAY overlap operator &&
        q = q.filter(XactAssembly.trigger_keywords.overlap(keywords))
        return q.all()

    def create(self, data: Dict[str, Any], items: Optional[List[Dict[str, Any]]] = None) -> XactAssembly:
        assembly = XactAssembly(
            name=data["name"],
            damage_type=data.get("damage_type"),
            room_type=data.get("room_type"),
            trigger_keywords=data.get("trigger_keywords"),
        )
        self.session.add(assembly)
        self.session.flush()

        if items:
            for item_data in items:
                ai = XactAssemblyItem(
                    assembly_id=assembly.id,
                    item_code=item_data["item_code"],
                    condition=item_data.get("condition"),
                    qty_formula=item_data.get("qty_formula"),
                    is_required=item_data.get("is_required", True),
                    sort_order=item_data.get("sort_order", 0),
                )
                self.session.add(ai)
            self.session.flush()

        return assembly


class XactRoomRepository:
    """Data access for xact_rooms."""

    def __init__(self, session: Session):
        self.session = session

    def get_by_id(self, room_id: UUID) -> Optional[XactRoom]:
        return self.session.query(XactRoom).filter(XactRoom.id == room_id).first()

    def get_by_user(self, user_id: UUID, status: Optional[str] = None) -> List[XactRoom]:
        q = self.session.query(XactRoom).filter(XactRoom.user_id == user_id)
        if status:
            q = q.filter(XactRoom.status == status)
        return q.order_by(desc(XactRoom.updated_at)).all()

    def get_by_project(self, project_id: UUID) -> List[XactRoom]:
        return (
            self.session.query(XactRoom)
            .filter(XactRoom.project_id == project_id)
            .order_by(XactRoom.name)
            .all()
        )

    def create(self, data: Dict[str, Any]) -> XactRoom:
        room = XactRoom(**data)
        self.session.add(room)
        self.session.flush()
        return room

    def update(self, room_id: UUID, data: Dict[str, Any]) -> Optional[XactRoom]:
        room = self.get_by_id(room_id)
        if not room:
            return None
        for k, v in data.items():
            if hasattr(room, k) and v is not None:
                setattr(room, k, v)
        self.session.flush()
        return room

    def delete(self, room_id: UUID) -> bool:
        room = self.get_by_id(room_id)
        if not room:
            return False
        self.session.delete(room)
        self.session.flush()
        return True


class XactCorrectionRepository:
    """Data access for xact_correction_feedback."""

    def __init__(self, session: Session):
        self.session = session

    def get_by_room(self, room_id: UUID) -> List[XactCorrectionFeedback]:
        return (
            self.session.query(XactCorrectionFeedback)
            .filter(XactCorrectionFeedback.room_id == room_id)
            .order_by(desc(XactCorrectionFeedback.created_at))
            .all()
        )

    def find_similar(
        self,
        embedding: List[float],
        threshold_exact: float = 0.92,
        threshold_hint: float = 0.85,
        limit: int = 5,
    ) -> List[Dict[str, Any]]:
        """Find similar correction feedback using vector similarity."""
        if not PGVECTOR_AVAILABLE:
            return []

        # Query with cosine distance
        results = (
            self.session.query(
                XactCorrectionFeedback,
                (1 - XactCorrectionFeedback.situation_embedding.cosine_distance(embedding)).label("similarity"),
            )
            .filter(XactCorrectionFeedback.situation_embedding.isnot(None))
            .order_by(
                XactCorrectionFeedback.situation_embedding.cosine_distance(embedding)
            )
            .limit(limit)
            .all()
        )

        output = []
        for fb, sim in results:
            if sim >= threshold_hint:
                output.append(
                    {
                        "feedback": fb.to_dict(),
                        "similarity": float(sim),
                        "apply_mode": "exact" if sim >= threshold_exact else "hint",
                    }
                )
        return output

    def create(self, data: Dict[str, Any]) -> XactCorrectionFeedback:
        fb = XactCorrectionFeedback(**data)
        self.session.add(fb)
        self.session.flush()
        return fb

    def increment_confidence(self, item_code: str, correction_type: str, damage_type: str) -> int:
        """Increment confidence_score for matching existing corrections.
        Returns the new confidence score if found, 0 otherwise."""
        # Find matching correction
        fb = (
            self.session.query(XactCorrectionFeedback)
            .filter(
                XactCorrectionFeedback.damage_type == damage_type,
                XactCorrectionFeedback.correction_type.contains([correction_type]),
            )
            .order_by(desc(XactCorrectionFeedback.confidence_score))
            .first()
        )
        if fb:
            fb.confidence_score += 1
            self.session.flush()
            return fb.confidence_score
        return 0

    def get_unapplied_high_confidence(self, threshold: int = 3) -> List[XactCorrectionFeedback]:
        """Get corrections ready for assembly rule auto-update."""
        return (
            self.session.query(XactCorrectionFeedback)
            .filter(
                XactCorrectionFeedback.confidence_score >= threshold,
                XactCorrectionFeedback.is_applied_to_rule == False,
            )
            .all()
        )


class XactDescriptionRepository:
    """Data access for xact_item_descriptions."""

    def __init__(self, session: Session):
        self.session = session

    def get_by_item_code(
        self,
        item_code: str,
        description_type: Optional[str] = None,
        approved_only: bool = False,
    ) -> List[XactItemDescription]:
        q = self.session.query(XactItemDescription).filter(
            XactItemDescription.item_code == item_code
        )
        if description_type:
            q = q.filter(XactItemDescription.description_type == description_type)
        if approved_only:
            q = q.filter(XactItemDescription.approved == True)
        return q.order_by(desc(XactItemDescription.usage_count)).all()

    def get_by_id(self, desc_id: UUID) -> Optional[XactItemDescription]:
        return (
            self.session.query(XactItemDescription)
            .filter(XactItemDescription.id == desc_id)
            .first()
        )

    def create(self, data: Dict[str, Any]) -> XactItemDescription:
        d = XactItemDescription(**data)
        self.session.add(d)
        self.session.flush()
        return d

    def update(self, desc_id: UUID, data: Dict[str, Any]) -> Optional[XactItemDescription]:
        d = self.get_by_id(desc_id)
        if not d:
            return None
        for k, v in data.items():
            if hasattr(d, k) and v is not None:
                setattr(d, k, v)
        self.session.flush()
        return d

    def increment_usage(self, desc_id: UUID) -> int:
        d = self.get_by_id(desc_id)
        if d:
            d.usage_count = (d.usage_count or 0) + 1
            self.session.flush()
            return d.usage_count
        return 0

    def exists_for_item(self, item_code: str, damage_type: Optional[str] = None) -> bool:
        """Check if descriptions exist for item + damage_type combo (for AI generation trigger)."""
        q = self.session.query(func.count(XactItemDescription.id)).filter(
            XactItemDescription.item_code == item_code,
            XactItemDescription.approved == True,
        )
        if damage_type:
            q = q.filter(
                XactItemDescription.trigger_condition.contains({"damage_type": damage_type})
            )
        return (q.scalar() or 0) > 0
