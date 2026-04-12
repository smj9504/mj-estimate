"""
Xactimate Helper Tool - Service Layer (Business Logic)

Orchestrates repository + AI pipeline for the full recommendation workflow.
"""

import json
import logging
from typing import Any, Dict, List, Optional
from uuid import UUID

from app.core.config import settings
from app.core.database_factory import get_database

from . import ai_service
from .models import PGVECTOR_AVAILABLE
from .repository import (
    XactAssemblyRepository,
    XactCorrectionRepository,
    XactDescriptionRepository,
    XactLineItemRepository,
    XactRoomRepository,
)

logger = logging.getLogger(__name__)


def _get_session():
    db = get_database()
    return db.get_session()


def _get_readonly_session():
    db = get_database()
    return db.get_readonly_session()


# ─── Line Item Service ────────────────────────────────────────────────────────


class XactLineItemService:
    def search(self, query=None, category=None, is_active=True, limit=20, offset=0):
        session = _get_readonly_session()
        try:
            repo = XactLineItemRepository(session)
            items = repo.search(query, category, is_active, limit, offset)
            total = repo.count(query, category, is_active)
            return {
                "items": [i.to_dict() for i in items],
                "total": total,
                "limit": limit,
                "offset": offset,
            }
        finally:
            session.close()

    def get_categories(self):
        session = _get_readonly_session()
        try:
            return XactLineItemRepository(session).get_categories()
        finally:
            session.close()

    def get_by_code(self, item_code: str):
        session = _get_readonly_session()
        try:
            item = XactLineItemRepository(session).get_by_code(item_code)
            return item.to_dict() if item else None
        finally:
            session.close()


# ─── Assembly Service ─────────────────────────────────────────────────────────


class XactAssemblyService:
    def get_all(self, damage_type=None, room_type=None):
        session = _get_readonly_session()
        try:
            repo = XactAssemblyRepository(session)
            assemblies = repo.get_all(damage_type, room_type)
            return [a.to_dict(include_items=True) for a in assemblies]
        finally:
            session.close()

    def get_by_id(self, assembly_id: UUID):
        session = _get_readonly_session()
        try:
            a = XactAssemblyRepository(session).get_by_id(assembly_id)
            return a.to_dict(include_items=True) if a else None
        finally:
            session.close()

    def create(self, data: Dict[str, Any]):
        session = _get_session()
        try:
            items = data.pop("items", None)
            items_dicts = None
            if items:
                items_dicts = [
                    i.model_dump() if hasattr(i, "model_dump") else i for i in items
                ]
            repo = XactAssemblyRepository(session)
            assembly = repo.create(data, items_dicts)
            session.commit()
            return assembly.to_dict(include_items=True)
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()


# ─── Room Service ─────────────────────────────────────────────────────────────


class XactRoomService:
    def create(self, data: Dict[str, Any], user_id: Optional[UUID] = None):
        session = _get_session()
        try:
            if user_id:
                data["user_id"] = user_id
            repo = XactRoomRepository(session)
            room = repo.create(data)
            session.commit()
            return room.to_dict()
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    def get_by_id(self, room_id: UUID):
        session = _get_readonly_session()
        try:
            room = XactRoomRepository(session).get_by_id(room_id)
            return room.to_dict() if room else None
        finally:
            session.close()

    def update(self, room_id: UUID, data: Dict[str, Any]):
        session = _get_session()
        try:
            room = XactRoomRepository(session).update(room_id, data)
            session.commit()
            return room.to_dict() if room else None
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    def get_line_items(self, room_id: UUID):
        session = _get_readonly_session()
        try:
            room = XactRoomRepository(session).get_by_id(room_id)
            if not room:
                return None
            return room.final_line_items or []
        finally:
            session.close()


# ─── AI Recommendation Service ────────────────────────────────────────────────


class XactRecommendationService:
    """Orchestrates the full AI pipeline: photo → keywords → candidates → assembly."""

    async def analyze_room(
        self,
        room_id: UUID,
        photos: Optional[List[str]] = None,
        manual_keywords: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        """
        Full AI pipeline for a room.

        1. Extract keywords from photos (or use manual)
        2. Generate embedding for combined keywords
        3. Check correction feedback for prior similar situations
        4. Vector search for candidate line items
        5. LLM matching to build assembly
        """
        session = _get_session()
        try:
            room_repo = XactRoomRepository(session)
            room = room_repo.get_by_id(room_id)
            if not room:
                raise ValueError(f"Room {room_id} not found")

            # Step 1: Extract keywords
            keywords = []
            if photos:
                for photo in photos:
                    try:
                        photo_keywords = await ai_service.extract_keywords_from_photo(photo)
                        keywords.extend(photo_keywords)
                    except Exception as e:
                        logger.error(f"Photo analysis failed: {e}")
            if manual_keywords:
                keywords.extend(manual_keywords)

            if not keywords:
                return {
                    "room_id": str(room_id),
                    "keywords": [],
                    "recommendations": [],
                    "feedback_applied": False,
                    "feedback_message": "No keywords extracted. Please provide photos or manual keywords.",
                }

            # Step 2: Generate embedding for combined keywords
            combined_text = " | ".join(keywords)
            embedding = await ai_service.generate_embedding(combined_text)

            # Step 4 (check before Step 3): Check correction feedback
            correction_repo = XactCorrectionRepository(session)
            feedback_applied = False
            feedback_message = None
            correction_hints = []

            exact_threshold = float(
                getattr(settings, "XACT_SIMILARITY_THRESHOLD_EXACT", 0.92)
            )
            hint_threshold = float(
                getattr(settings, "XACT_SIMILARITY_THRESHOLD_HINT", 0.85)
            )

            similar_corrections = correction_repo.find_similar(
                embedding, exact_threshold, hint_threshold
            )

            for sc in similar_corrections:
                if sc["apply_mode"] == "exact" and sc["feedback"]["confidence_score"] >= 1:
                    # Direct apply: use the user_corrected as the result
                    feedback_applied = True
                    feedback_message = "Prior correction applied (exact match)."
                    corrected = sc["feedback"]["user_corrected"]
                    items = []
                    if corrected:
                        for ci in corrected:
                            items.append(
                                {
                                    "item_code": ci.get("item_code"),
                                    "description": ci.get("description"),
                                    "qty": ci.get("qty", 1),
                                    "unit": ci.get("unit"),
                                    "unit_price": ci.get("unit_price", 0),
                                    "reason": "Applied from prior correction feedback",
                                }
                            )
                    result = {
                        "room_id": str(room_id),
                        "keywords": keywords,
                        "recommendations": [
                            {
                                "assembly_name": "Correction-Based Recommendation",
                                "items": items,
                                "source": "feedback",
                                "confidence": sc["similarity"],
                            }
                        ],
                        "feedback_applied": True,
                        "feedback_message": feedback_message,
                    }
                    return result

                elif sc["apply_mode"] == "hint":
                    # Inject as hint for LLM
                    fb = sc["feedback"]
                    correction_hints.append(
                        f"In a similar past situation ({fb.get('situation_summary', 'N/A')}), "
                        f"user corrected: {json.dumps(fb.get('user_corrected', [])[:3])}"
                    )
                    feedback_message = "Similar corrections found and used as hints."

            # Step 2b: Vector search for candidate line items
            line_item_repo = XactLineItemRepository(session)
            candidate_limit = int(
                getattr(settings, "XACT_CANDIDATE_ITEM_LIMIT", 8)
            )
            candidates_raw = line_item_repo.vector_search(
                embedding, limit=candidate_limit
            )
            candidates = [c.to_dict() for c in candidates_raw]

            if not candidates:
                # Fallback: text search
                for kw in keywords[:3]:
                    text_results = line_item_repo.search(
                        query=kw, is_active=True, limit=5
                    )
                    candidates.extend([r.to_dict() for r in text_results])
                # Deduplicate
                seen = set()
                unique = []
                for c in candidates:
                    if c["item_code"] not in seen:
                        seen.add(c["item_code"])
                        unique.append(c)
                candidates = unique[:candidate_limit]

            # Step 3: LLM matching
            room_info = {
                "name": room.name,
                "room_type": room.room_type,
                "dimensions": room.dimensions or {},
                "damage_type": room.damage_type,
                "condition_flags": room.condition_flags or {},
            }

            assembly_result = await ai_service.match_candidates_to_assembly(
                keywords, candidates, room_info, correction_hints or None
            )

            # Build response
            items = []
            for item in assembly_result.get("items", []):
                # Enrich with line item data
                li = line_item_repo.get_by_code(item.get("item_code", ""))
                items.append(
                    {
                        "item_code": item.get("item_code"),
                        "description": li.description if li else item.get("description"),
                        "qty": item.get("qty", 1),
                        "unit": li.unit if li else item.get("unit"),
                        "unit_price": float(li.unit_price) if li and li.unit_price else 0,
                        "reason": item.get("reason"),
                    }
                )

            return {
                "room_id": str(room_id),
                "keywords": keywords,
                "recommendations": [
                    {
                        "assembly_name": assembly_result.get(
                            "assembly_name", "AI Recommendation"
                        ),
                        "items": items,
                        "source": "ai",
                        "confidence": None,
                    }
                ],
                "feedback_applied": bool(correction_hints),
                "feedback_message": feedback_message,
            }

        except Exception as e:
            logger.error(f"Room analysis failed: {e}", exc_info=True)
            raise
        finally:
            session.close()


# ─── Correction Feedback Service ──────────────────────────────────────────────


class XactCorrectionService:
    async def save_correction(
        self,
        room_id: UUID,
        ai_suggested: List[Dict],
        user_corrected: List[Dict],
        situation_summary: Optional[str] = None,
        user_id: Optional[UUID] = None,
    ) -> Dict[str, Any]:
        session = _get_session()
        try:
            room_repo = XactRoomRepository(session)
            room = room_repo.get_by_id(room_id)
            if not room:
                raise ValueError(f"Room {room_id} not found")

            # Determine correction types
            correction_types = self._detect_correction_types(ai_suggested, user_corrected)

            # Build situation summary if not provided
            if not situation_summary:
                dims = room.dimensions or {}
                situation_summary = (
                    f"{room.name} {room.room_type or ''} "
                    f"{room.damage_type or ''}, "
                    f"LF={dims.get('LF', '?')}, SF={dims.get('SF', '?')}"
                )
                if room.condition_flags:
                    flags = [k for k, v in room.condition_flags.items() if v]
                    if flags:
                        situation_summary += f", {', '.join(flags)}"

            # Generate situation embedding
            situation_embedding = None
            try:
                situation_embedding = await ai_service.generate_embedding(situation_summary)
            except Exception as e:
                logger.warning(f"Failed to generate situation embedding: {e}")

            correction_repo = XactCorrectionRepository(session)
            fb = correction_repo.create(
                {
                    "user_id": user_id,
                    "room_id": room_id,
                    "situation_summary": situation_summary,
                    "situation_embedding": situation_embedding,
                    "damage_type": room.damage_type,
                    "room_type": room.room_type,
                    "ai_suggested": ai_suggested,
                    "user_corrected": user_corrected,
                    "correction_type": correction_types,
                }
            )

            # Update room's final_line_items
            room_repo.update(room_id, {"final_line_items": user_corrected})

            # Check if similar correction exists and increment confidence
            auto_apply_threshold = int(
                getattr(settings, "XACT_CORRECTION_AUTO_APPLY_THRESHOLD", 3)
            )
            # This is simplified; a full implementation would check per-item corrections
            for ct in correction_types:
                new_score = correction_repo.increment_confidence(
                    "", ct, room.damage_type or ""
                )
                if new_score >= auto_apply_threshold:
                    logger.info(
                        f"Correction confidence reached {new_score} — eligible for assembly rule update"
                    )
                    # TODO: Auto-update assembly rules when threshold is reached

            session.commit()
            return fb.to_dict()

        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    def get_by_room(self, room_id: UUID):
        session = _get_readonly_session()
        try:
            corrections = XactCorrectionRepository(session).get_by_room(room_id)
            return [c.to_dict() for c in corrections]
        finally:
            session.close()

    @staticmethod
    def _detect_correction_types(
        ai_suggested: List[Dict], user_corrected: List[Dict]
    ) -> List[str]:
        """Detect what types of corrections were made."""
        types = set()
        ai_codes = {item.get("item_code") for item in ai_suggested}
        user_codes = {item.get("item_code") for item in user_corrected}

        added = user_codes - ai_codes
        removed = ai_codes - user_codes

        if added:
            types.add("add")
        if removed:
            types.add("remove")

        # Check for quantity changes on items present in both
        ai_map = {i.get("item_code"): i for i in ai_suggested}
        for item in user_corrected:
            code = item.get("item_code")
            if code in ai_map:
                if item.get("qty") != ai_map[code].get("qty"):
                    types.add("qty_change")

        # If an item was added and another removed, it might be a swap
        if added and removed:
            types.add("swap")

        return list(types) if types else ["no_change"]


# ─── Description Service ─────────────────────────────────────────────────────


class XactDescriptionService:
    def get_for_item(self, item_code: str, description_type=None, approved_only=False):
        session = _get_readonly_session()
        try:
            repo = XactDescriptionRepository(session)
            descs = repo.get_by_item_code(item_code, description_type, approved_only)
            return [d.to_dict() for d in descs]
        finally:
            session.close()

    def create(self, data: Dict[str, Any]):
        session = _get_session()
        try:
            repo = XactDescriptionRepository(session)
            d = repo.create(data)
            session.commit()
            return d.to_dict()
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    def update(self, desc_id: UUID, data: Dict[str, Any]):
        session = _get_session()
        try:
            repo = XactDescriptionRepository(session)
            d = repo.update(desc_id, data)
            session.commit()
            return d.to_dict() if d else None
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    def approve(self, desc_id: UUID):
        return self.update(desc_id, {"approved": True})

    def record_copy(self, desc_id: UUID):
        session = _get_session()
        try:
            repo = XactDescriptionRepository(session)
            count = repo.increment_usage(desc_id)
            session.commit()
            return {"usage_count": count}
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    async def generate_if_missing(
        self,
        item_code: str,
        damage_type: str,
        room_type: str,
        description_types: Optional[List[str]] = None,
    ) -> List[Dict[str, Any]]:
        """Generate AI descriptions for item+damage combo if none exist in DB."""
        if description_types is None:
            description_types = ["waste", "building_code", "scope_of_work"]

        session = _get_session()
        try:
            desc_repo = XactDescriptionRepository(session)
            li_repo = XactLineItemRepository(session)

            item = li_repo.get_by_code(item_code)
            if not item:
                return []

            generated = []
            for dt in description_types:
                existing = desc_repo.get_by_item_code(item_code, dt)
                if existing:
                    continue  # Already has descriptions for this type

                try:
                    result = await ai_service.generate_description(
                        item_code=item_code,
                        item_description=item.description or "",
                        damage_type=damage_type,
                        room_type=room_type,
                        description_type=dt,
                    )

                    d = desc_repo.create(
                        {
                            "item_code": item_code,
                            "description_type": dt,
                            "title": result["title"],
                            "body": result["body"],
                            "trigger_condition": {"damage_type": damage_type},
                            "is_ai_generated": True,
                            "approved": False,
                        }
                    )
                    generated.append(d.to_dict())
                except Exception as e:
                    logger.error(f"Failed to generate description for {item_code}/{dt}: {e}")

            session.commit()
            return generated

        except Exception:
            session.rollback()
            raise
        finally:
            session.close()


# ─── Embedding Sync Service ──────────────────────────────────────────────────


class XactEmbeddingService:
    async def sync_embeddings(
        self, category: Optional[str] = None, force_regenerate: bool = False
    ) -> Dict[str, Any]:
        """Batch generate embeddings for line items without them."""
        session = _get_session()
        try:
            repo = XactLineItemRepository(session)

            if force_regenerate:
                # Get all active items
                items = repo.search(category=category, is_active=True, limit=10000, offset=0)
            else:
                items = repo.get_items_without_embedding(category)

            if not items:
                return {
                    "total_items": 0,
                    "processed": 0,
                    "skipped": 0,
                    "errors": 0,
                    "message": "No items need embedding",
                }

            # Build texts for embedding
            texts = []
            codes = []
            for item in items:
                # Combine description + definition for richer embedding
                text_parts = [item.item_code, item.description or ""]
                if item.definition:
                    if isinstance(item.definition, dict):
                        includes = item.definition.get("includes", "")
                        if includes:
                            text_parts.append(includes)
                    elif isinstance(item.definition, str):
                        text_parts.append(item.definition)
                texts.append(" | ".join(filter(None, text_parts)))
                codes.append(item.item_code)

            # Generate embeddings in batch
            embeddings = await ai_service.generate_embeddings_batch(texts)

            # Update in DB
            updates = [
                {"item_code": code, "embedding": emb}
                for code, emb in zip(codes, embeddings)
            ]
            processed = repo.bulk_update_embeddings(updates)
            session.commit()

            return {
                "total_items": len(items),
                "processed": processed,
                "skipped": len(items) - processed,
                "errors": 0,
                "message": f"Successfully embedded {processed} items",
            }

        except Exception as e:
            session.rollback()
            logger.error(f"Embedding sync failed: {e}", exc_info=True)
            return {
                "total_items": 0,
                "processed": 0,
                "skipped": 0,
                "errors": 1,
                "message": f"Error: {str(e)}",
            }
        finally:
            session.close()
