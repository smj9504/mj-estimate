"""
AI Photo Classification Service for Water Mitigation

Uses Gemini Vision API for photo classification with rule-based post-processing.

Categories:
- wet-area: Red meter + no demolition (water detected, before work)
- pre-mitigation-moving: Furniture/items being moved
- demolition: Active demolition work
- containment: Plastic barriers, containment setup
- drying-process: Drying equipment operating or stacked (3+)
- day-1: Red meter + demolition complete
- day-2: Yellow meter + demolition
- day-3: Green meter + demolition
- documentation: Paperwork, signatures
- uncategorized: Anything else, mold detected, needs manual review

Cost optimization:
- Images resized to max 1024px before sending (70%+ token savings)
- gemini-2.0-flash-lite default ($0.0375/1M input tokens)
- Cache layer avoids duplicate API calls
"""

import base64
import io
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

# Optimized prompt - concise for token savings, precise for accuracy
CLASSIFICATION_PROMPT = """Analyze this water mitigation (flood/water damage restoration) photo.

CATEGORIES (pick exactly one):
1. wet-area — Moisture meter showing RED, area NOT yet demolished
2. pre-mitigation-moving — Furniture/belongings being moved out
3. demolition — Active tear-out of drywall/flooring/baseboards (exposed studs, debris piles)
4. containment — Plastic sheeting barriers, poly walls, zipper doors
5. drying-process — Air movers/dehumidifiers/fans on floor running, OR 3+ units stacked together
6. day-1 — Moisture meter RED + demolition already completed (exposed studs visible)
7. day-2 — Moisture meter YELLOW + demolition completed
8. day-3 — Moisture meter GREEN + demolition completed
9. documentation — Paperwork, signatures, certificates, authorization forms
10. uncategorized — None of the above, unclear, or mold visible

KEY VISUAL CUES:
- Moisture meters: handheld devices with colored digital display (red=wet, yellow=drying, green=dry)
- Demolition complete: exposed wall studs, removed baseboards, cut drywall lines visible
- Air movers: small blue/red fan units on floor; dehumidifiers: larger boxy units
- Containment: translucent plastic sheets hung from ceiling to floor

Respond ONLY with valid JSON:
{"category":"<name>","confidence":0.85,"metadata":{"meter_visible":false,"meter_color":null,"is_demolished":false,"equipment_count":0,"equipment_status":null,"mold_visible":false}}

metadata fields:
- meter_visible: boolean — is a moisture meter in the photo?
- meter_color: "red"|"yellow"|"green"|null
- is_demolished: boolean — evidence of completed demolition (exposed studs)?
- equipment_count: int — number of drying machines visible
- equipment_status: "operating"|"stacked"|null — operating=on floor running, stacked=stored/piled
- mold_visible: boolean — visible mold or mold-like growth?"""


def _resize_image(image_data: bytes, max_size: int = 1024) -> tuple[bytes, str]:
    """
    Resize image to max_size px on longest side. Returns (resized_bytes, mime_type).
    Converts to JPEG for consistent, smaller payloads.
    """
    try:
        from PIL import Image

        img = Image.open(io.BytesIO(image_data))

        # Convert RGBA/P to RGB for JPEG
        if img.mode in ("RGBA", "P", "LA"):
            img = img.convert("RGB")

        # Only resize if larger than max_size
        if max(img.size) > max_size:
            img.thumbnail((max_size, max_size), Image.LANCZOS)

        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=80, optimize=True)
        return buf.getvalue(), "image/jpeg"

    except Exception as e:
        logger.warning(f"Image resize failed, using original: {e}")
        return image_data, "image/jpeg"


def validate_and_correct(ai_result: dict) -> dict:
    """
    Apply rule-based post-processing to validate and correct AI classification.

    Rules:
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
            if equipment_count < 1:
                corrections.append({
                    "rule": "drying_no_equipment",
                    "reason": "작동중인 장비 없음 → uncategorized",
                    "from": category,
                    "to": "uncategorized"
                })
                category = "uncategorized"
        elif equipment_status == "stacked":
            if equipment_count < 3:
                corrections.append({
                    "rule": "drying_stacked_insufficient",
                    "reason": f"적재된 장비 {equipment_count}대 (3대 미만) → uncategorized",
                    "from": category,
                    "to": "uncategorized"
                })
                category = "uncategorized"
        elif equipment_status is None and equipment_count == 0:
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
        result["rule_applied"] = corrections[-1]["rule"]
        result["corrections"] = corrections

    return result


class AIClassificationService:
    """AI Photo Classification Service using Gemini Vision API."""

    def __init__(self):
        self.enabled = settings.ENABLE_AI_PHOTO_CLASSIFICATION
        self.api_key = settings.GEMINI_API_KEY
        self.model_name = settings.GEMINI_MODEL
        self._model = None

    def _get_model(self):
        """Lazy load Gemini model."""
        if self._model is None:
            if not self.api_key:
                raise ValueError("GEMINI_API_KEY is not configured")

            import google.generativeai as genai
            genai.configure(api_key=self.api_key)
            self._model = genai.GenerativeModel(
                self.model_name,
                generation_config=genai.GenerationConfig(
                    temperature=0.1,  # Low temp for consistent classification
                    max_output_tokens=256,  # JSON response is small
                ),
            )

        return self._model

    async def classify_photo(
        self,
        image_data: bytes,
        mime_type: str = "image/jpeg"
    ) -> dict:
        """
        Classify a single photo using Gemini Vision API.

        Images are resized to 1024px max before sending to reduce costs.
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

            # Resize image for cost savings
            resized_data, resized_mime = _resize_image(image_data)

            # Build proper Gemini content parts
            import google.generativeai as genai

            image_part = genai.types.BlobDict(
                mime_type=resized_mime,
                data=resized_data,
            )

            # Call Gemini Vision API
            response = model.generate_content(
                [CLASSIFICATION_PROMPT, image_part]
            )

            # Parse response
            response_text = response.text.strip()

            # Clean up JSON response (remove markdown code blocks if present)
            if response_text.startswith("```"):
                lines = response_text.split("\n")
                # Remove first line (```json) and last line (```)
                json_lines = []
                for line in lines:
                    stripped = line.strip()
                    if stripped.startswith("```"):
                        continue
                    json_lines.append(line)
                response_text = "\n".join(json_lines)

            ai_result = json.loads(response_text)

            # Validate category
            if ai_result.get("category") not in VALID_CATEGORIES:
                ai_result["category"] = "uncategorized"

            # Ensure metadata exists
            if "metadata" not in ai_result:
                ai_result["metadata"] = {}

            # Apply rule-based corrections
            corrected_result = validate_and_correct(ai_result)

            return corrected_result

        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse Gemini response: {e}, raw: {response_text[:200] if 'response_text' in dir() else 'N/A'}")
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
        """Classify a photo from URL."""
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
        """Get cached classification result for a photo."""
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
        """Save classification result to cache."""
        from app.domains.water_mitigation.models import PhotoAnalysisCache

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
        """Mark a classification as user-corrected (for analytics)."""
        from app.domains.water_mitigation.models import PhotoAnalysisCache

        cache = session.query(PhotoAnalysisCache).filter(
            PhotoAnalysisCache.photo_id == photo_id
        ).first()

        if cache:
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
