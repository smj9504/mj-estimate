"""
AI Photo Classification Service for Water Mitigation

Uses Gemini Vision API for photo classification with rule-based post-processing.
Implements the classification logic from AI_PHOTO_CLASSIFICATION_IMPLEMENTATION_PLAN.md

Categories:
- wet-area: Red meter + no demolition (water detected, before work)
- pre-mitigation-moving: Furniture/items being moved
- demolition: Active demolition work
- containment: Plastic barriers, containment setup
- drying-process: Equipment operating or stacked (3+)
- day-1: Red meter + demolition complete
- day-2: Yellow meter + demolition
- day-3: Green meter + demolition
- documentation: Paperwork, signatures
- uncategorized: Anything else, mold detected, needs manual review

Cost: ~$1.5/month with Gemini 1.5 Flash (0.075$/1M input tokens)
"""

import base64
import json
import logging
from datetime import datetime
from typing import Any, Optional

from sqlalchemy.orm import Session

from app.core.config import settings

logger = logging.getLogger(__name__)

# Valid categories
VALID_CATEGORIES = [
    "wet-area",
    "pre-mitigation-moving",
    "demolition",
    "containment",
    "drying-process",
    "day-1",
    "day-2",
    "day-3",
    "documentation",
    "uncategorized"
]

# System prompt for Gemini
CLASSIFICATION_PROMPT = """You are analyzing water mitigation (flood/water damage restoration) photos.

Your task is to:
1. Classify the photo into one of these categories:
   - wet-area: Water damaged area with moisture meter showing RED (high moisture), no demolition yet
   - pre-mitigation-moving: Furniture, belongings, or items being moved out of the area
   - demolition: Active demolition work (removing drywall, flooring, baseboards)
   - containment: Plastic sheeting, barriers, containment setup for work areas
   - drying-process: Drying equipment (fans, dehumidifiers, air movers) operating or stacked
   - day-1: Moisture meter showing RED, demolition already completed
   - day-2: Moisture meter showing YELLOW (medium moisture), demolition completed
   - day-3: Moisture meter showing GREEN (dry), demolition completed
   - documentation: Paperwork, signatures, certificates, written documents
   - uncategorized: Anything that doesn't fit above categories

2. Extract these metadata fields:
   - meter_visible: Is a moisture meter visible in the photo? (true/false)
   - meter_color: If meter visible, what color is displayed? (red/yellow/green/null)
   - is_demolished: Is there evidence of demolition work completed? (true/false)
   - equipment_count: Number of drying equipment visible (0 if none)
   - equipment_status: Status of equipment - "operating" if running/active, "stacked" if stored/stacked, null if no equipment
   - mold_visible: Is there visible mold or mold-like growth? (true/false)

IMPORTANT RULES:
- If you see mold, always set mold_visible: true (will be reclassified to uncategorized)
- For drying equipment: look for air movers, dehumidifiers, fans, blowers
- "Operating" equipment: positioned on floor, appearing to be in use, cables visible
- "Stacked" equipment: piled up, stored together, not actively running
- Moisture meters often appear as handheld devices with digital displays

Respond ONLY with valid JSON in this exact format:
{
  "category": "category-name",
  "confidence": 0.85,
  "metadata": {
    "meter_visible": true,
    "meter_color": "red",
    "is_demolished": false,
    "equipment_count": 0,
    "equipment_status": null,
    "mold_visible": false
  }
}
"""


def validate_and_correct(ai_result: dict) -> dict:
    """
    Apply rule-based post-processing to validate and correct AI classification.

    Rules from implementation plan:
    - Rule 0: Mold detected → uncategorized
    - Rule 1: Meter color + demolition state → correct category
    - Rule 2: Equipment status validation for drying-process
    """
    category = ai_result.get("category", "uncategorized")
    metadata = ai_result.get("metadata", {})
    confidence = ai_result.get("confidence", 0.5)

    corrections = []
    original_category = category

    # Rule 0: Mold detected → uncategorized
    if metadata.get("mold_visible"):
        if category != "uncategorized":
            corrections.append({
                "rule": "mold_detected",
                "reason": "곰팡이 감지 → 수동 분류 필요",
                "from": category,
                "to": "uncategorized"
            })
            category = "uncategorized"

    # Rule 1: Meter color + demolition state
    elif metadata.get("meter_visible") and metadata.get("meter_color"):
        color = metadata["meter_color"].lower()
        demolished = metadata.get("is_demolished", False)

        expected_category = None

        if color == "red":
            expected_category = "day-1" if demolished else "wet-area"
        elif color == "yellow":
            expected_category = "day-2" if demolished else "wet-area"
        elif color == "green":
            expected_category = "day-3" if demolished else "wet-area"

        if expected_category and category != expected_category:
            corrections.append({
                "rule": f"meter_{color}_{'demolished' if demolished else 'no_demo'}",
                "reason": f"미터기 {color} + {'철거완료' if demolished else '철거전'} → {expected_category}",
                "from": category,
                "to": expected_category
            })
            category = expected_category

    # Rule 2: Drying process equipment validation
    if category == "drying-process":
        equipment_status = metadata.get("equipment_status")
        equipment_count = metadata.get("equipment_count", 0)

        if equipment_status == "operating":
            # Operating equipment: 1+ is OK
            if equipment_count < 1:
                corrections.append({
                    "rule": "drying_no_equipment",
                    "reason": "작동중인 장비 없음 → uncategorized",
                    "from": category,
                    "to": "uncategorized"
                })
                category = "uncategorized"
        elif equipment_status == "stacked":
            # Stacked equipment: need 3+ to be drying-process
            if equipment_count < 3:
                corrections.append({
                    "rule": "drying_stacked_insufficient",
                    "reason": f"적재된 장비 {equipment_count}대 (3대 미만) → uncategorized",
                    "from": category,
                    "to": "uncategorized"
                })
                category = "uncategorized"
        elif equipment_status is None and equipment_count == 0:
            # No equipment at all
            corrections.append({
                "rule": "drying_no_equipment",
                "reason": "장비 미감지 → uncategorized",
                "from": category,
                "to": "uncategorized"
            })
            category = "uncategorized"

    # Build corrected result
    result = {
        "category": category,
        "confidence": confidence,
        "metadata": metadata,
        "analyzed_at": datetime.utcnow().isoformat() + "Z"
    }

    if corrections:
        result["original_category"] = original_category
        result["rule_applied"] = corrections[-1]["rule"]  # Last applied rule
        result["corrections"] = corrections

    return result


class AIClassificationService:
    """
    AI Photo Classification Service using Gemini Vision API.
    """

    def __init__(self):
        self.enabled = settings.ENABLE_AI_PHOTO_CLASSIFICATION
        self.api_key = settings.GEMINI_API_KEY
        self.model_name = settings.GEMINI_MODEL
        self._model = None

    def _get_model(self):
        """Lazy load Gemini model"""
        if self._model is None:
            if not self.api_key:
                raise ValueError("GEMINI_API_KEY is not configured")

            import google.generativeai as genai
            genai.configure(api_key=self.api_key)
            self._model = genai.GenerativeModel(self.model_name)

        return self._model

    async def classify_photo(
        self,
        image_data: bytes,
        mime_type: str = "image/jpeg"
    ) -> dict:
        """
        Classify a single photo using Gemini Vision API.

        Args:
            image_data: Raw image bytes
            mime_type: Image MIME type (image/jpeg, image/png, etc.)

        Returns:
            Classification result with category, confidence, metadata
        """
        if not self.enabled:
            return {
                "category": "uncategorized",
                "confidence": 0.0,
                "metadata": {},
                "error": "AI classification is disabled"
            }

        try:
            model = self._get_model()

            # Prepare image for Gemini
            image_part = {
                "mime_type": mime_type,
                "data": base64.b64encode(image_data).decode("utf-8")
            }

            # Call Gemini Vision API
            response = model.generate_content([
                CLASSIFICATION_PROMPT,
                image_part
            ])

            # Parse response
            response_text = response.text.strip()

            # Clean up JSON response (remove markdown code blocks if present)
            if response_text.startswith("```"):
                lines = response_text.split("\n")
                response_text = "\n".join(lines[1:-1])

            ai_result = json.loads(response_text)

            # Validate category
            if ai_result.get("category") not in VALID_CATEGORIES:
                ai_result["category"] = "uncategorized"

            # Apply rule-based corrections
            corrected_result = validate_and_correct(ai_result)

            return corrected_result

        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse Gemini response: {e}")
            return {
                "category": "uncategorized",
                "confidence": 0.0,
                "metadata": {},
                "error": f"JSON parse error: {str(e)}"
            }
        except Exception as e:
            logger.error(f"AI classification failed: {e}")
            return {
                "category": "uncategorized",
                "confidence": 0.0,
                "metadata": {},
                "error": str(e)
            }

    async def classify_photo_from_url(self, photo_url: str) -> dict:
        """
        Classify a photo from URL.

        Args:
            photo_url: URL of the image to classify

        Returns:
            Classification result
        """
        import httpx

        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(photo_url, timeout=30.0)
                response.raise_for_status()

                content_type = response.headers.get("content-type", "image/jpeg")
                mime_type = content_type.split(";")[0].strip()

                return await self.classify_photo(response.content, mime_type)

        except httpx.HTTPError as e:
            logger.error(f"Failed to fetch image from URL: {e}")
            return {
                "category": "uncategorized",
                "confidence": 0.0,
                "metadata": {},
                "error": f"Failed to fetch image: {str(e)}"
            }

    def get_cached_result(
        self,
        session: Session,
        photo_id: str
    ) -> Optional[dict]:
        """
        Get cached classification result for a photo.

        Args:
            session: Database session
            photo_id: Photo UUID

        Returns:
            Cached AI result or None
        """
        from app.domains.water_mitigation.models import PhotoAnalysisCache

        cache = session.query(PhotoAnalysisCache).filter(
            PhotoAnalysisCache.photo_id == photo_id
        ).first()

        if cache:
            return cache.ai_result

        return None

    def save_result(
        self,
        session: Session,
        photo_id: str,
        ai_result: dict
    ) -> None:
        """
        Save classification result to cache.

        Args:
            session: Database session
            photo_id: Photo UUID
            ai_result: Classification result to cache
        """
        from app.domains.water_mitigation.models import PhotoAnalysisCache

        # Check for existing cache
        existing = session.query(PhotoAnalysisCache).filter(
            PhotoAnalysisCache.photo_id == photo_id
        ).first()

        if existing:
            existing.ai_result = ai_result
            existing.user_corrected = False
        else:
            cache = PhotoAnalysisCache(
                photo_id=photo_id,
                ai_result=ai_result,
                user_corrected=False
            )
            session.add(cache)

        session.commit()

    def mark_user_corrected(
        self,
        session: Session,
        photo_id: str,
        corrected_category: str
    ) -> None:
        """
        Mark a classification as user-corrected (for analytics).

        Args:
            session: Database session
            photo_id: Photo UUID
            corrected_category: The category user selected
        """
        from app.domains.water_mitigation.models import PhotoAnalysisCache

        cache = session.query(PhotoAnalysisCache).filter(
            PhotoAnalysisCache.photo_id == photo_id
        ).first()

        if cache:
            # Update AI result with user correction info
            ai_result = cache.ai_result or {}
            ai_result["user_correction"] = {
                "original_ai_category": ai_result.get("category"),
                "corrected_to": corrected_category,
                "corrected_at": datetime.utcnow().isoformat() + "Z"
            }
            ai_result["category"] = corrected_category

            cache.ai_result = ai_result
            cache.user_corrected = True
            session.commit()


# Singleton instance
ai_classification_service = AIClassificationService()
