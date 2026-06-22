"""
AI Photo Classification Service for Water Mitigation

Uses Gemini Vision API for photo classification with rule-based post-processing.

Categories:
- wet-area: High meter reading + no demolition (water detected, before work)
- pre-mitigation-moving: Furniture/items being moved
- demolition: Active demolition work
- containment: Plastic barriers, containment setup
- protection: Floor/content protection (paper, tape, plastic wrap)
- drying-process: Drying equipment operating or stacked (3+)
- day-1: High/wet meter (24%+/HI) + demolition complete (first reading, still wet)
- day-2: Medium meter (14-23%) + demolition complete (drying in progress)
- day-3: Low/dry meter (0-13%/LO) on any surface (final reading, dry)
- documentation: Paperwork, signatures
- uncategorized: Anything else, mold detected, needs manual review

Cost optimization:
- Images resized to max 1024px before sending (70%+ token savings)
- gemini-2.0-flash-lite default ($0.0375/1M input tokens)
- Cache layer avoids duplicate API calls
"""

import io
import json
import logging
import re
from datetime import datetime
from typing import Optional

from sqlalchemy.orm import Session

from app.core.config import settings

logger = logging.getLogger(__name__)

# Valid categories
VALID_CATEGORIES = [
    "property-overview",
    "wet-area",
    "personal-properties",
    "pre-mitigation-moving",
    "demolition",
    "containment",
    "protection",
    "drying-process",
    "day-1",
    "day-2",
    "day-3",
    "documentation",
    "uncategorized",
]

# Optimized prompt - concise for token savings, precise for accuracy
CLASSIFICATION_PROMPT = """Analyze this water mitigation (flood/water damage restoration) photo.

CATEGORIES (pick exactly one):
1. property-overview — Exterior/interior overview of the property (front of house, street view, wide-angle room shots showing overall condition)
2. wet-area — Moisture meter showing HIGH reading (24%+/HI/red) on INTACT (not demolished) surface
3. personal-properties — Homeowner belongings, furniture, personal items (before moving)
4. pre-mitigation-moving — Furniture/belongings being moved out, packing process
5. demolition — Active tear-out of drywall/flooring/baseboards (exposed studs, debris piles)
6. containment — Plastic sheeting barriers, poly walls, zipper doors
7. protection — Floor protection (ram board, paper, tape), content protection (plastic wrap on furniture/items)
8. drying-process — Air movers/dehumidifiers/fans on floor running, OR 3+ units stacked together
9. day-1 — Moisture meter 24%+ or "HI" on DEMOLISHED surface (first reading after demolition, still wet)
10. day-2 — Moisture meter 14-23% on DEMOLISHED surface (drying in progress after demolition)
11. day-3 — Moisture meter 0-13% or "LO" on ANY surface (final reading, drying complete — demolished or intact)
12. documentation — Paperwork, signatures, certificates, authorization forms
13. uncategorized — None of the above, unclear, or mold visible

MOISTURE METER READING GUIDE:

★★★ MULTI-DISPLAY METERS (READ CAREFULLY) ★★★
Many meters (General, Protimeter, Delmhorst, etc.) show MULTIPLE values on LCD simultaneously:
- PIN / WOOD moisture % ← THIS IS THE ONLY VALUE YOU MUST READ
- RH% (relative humidity) ← IGNORE THIS completely
- °F / °C (temperature) ← IGNORE THIS completely

Look for labels like "PIN", "WOOD", "%WME" on the display to find the correct reading.
If the display shows "LO" text next to the PIN/WOOD section, that means moisture is below measurable range = VERY DRY.
If the display shows "HI" text next to the PIN/WOOD section, that means moisture is above measurable range = VERY WET.

★★★ BAR INDICATOR ★★★
Many meters have a bar/scale at the bottom with "WET" on one end and "DRY" on the other:
- Bar on DRY side = green (dry)
- Bar in middle = yellow (drying)
- Bar on WET side = red (wet)
Use this bar as CONFIRMATION of the reading.

READING INTERPRETATION (based on PIN/WOOD value only):
  * 24%+ or "HI" → WET → meter_color="red" → day-1 (first reading, still wet)
  * 14-23% → DRYING → meter_color="yellow" → day-2 (drying in progress)
  * "LO" or 0-13% → DRY → meter_color="green" → day-3 (final reading, dry)

- CRITICAL: Report the PIN/WOOD moisture reading in meter_reading field. NOT the RH% or temperature.

★★★ CRITICAL: METER SURFACE ANALYSIS (wet-area vs day-1/2/3) ★★★
When a moisture meter is visible, you MUST examine THE EXACT SURFACE the meter is touching/placed against.
IGNORE the background — only the surface directly under the meter pins matters.

INTACT surface (→ wet-area, regardless of meter reading):
- Painted drywall (smooth, painted finish)
- Wallpapered wall
- Tile, vinyl, laminate flooring
- Baseboards/trim still attached at wall-floor junction
- Finished cabinet surfaces
- Any original building material with its finish intact

DEMOLISHED surface (→ day-1/2/3 based on meter reading):
- Exposed wood studs/framing (bare 2x4s visible)
- Cut drywall edge with paper/gypsum layers visible
- Bare plywood or OSB subfloor (no flooring on top)
- Concrete slab where flooring has been removed
- Exposed insulation (fiberglass/foam)
- Areas where baseboards have been ripped off (nail holes, adhesive residue, gap at wall bottom)

⚠️ COMMON MISTAKE: Air movers or dehumidifiers in the background do NOT mean the meter surface is demolished.
The same room can have both demolished and intact areas. Focus ONLY on where the meter touches.

OTHER VISUAL CUES:
- Air movers: small blue/red fan units on floor; dehumidifiers: larger boxy units
- Containment: translucent plastic sheets hung from ceiling to floor
- Floor protection: brown/white paper (ram board, kraft paper, rosin paper) laid on floor

Respond ONLY with valid JSON:
{"category":"<name>","confidence":0.85,"metadata":{"meter_visible":false,"meter_reading":null,"meter_color":null,"is_demolished":false,"demolition_confidence":0.0,"surface_description":null,"equipment_count":0,"equipment_status":null,"mold_visible":false}}

metadata fields:
- meter_visible: boolean — is a moisture meter in the photo?
- meter_reading: string|null — exact value on meter display (e.g., "22", "67.5", "LO", "HI")
- meter_color: "red"|"yellow"|"green"|null — from reading or meter color indicator
- is_demolished: boolean — is the surface THE METER TOUCHES demolished?
- demolition_confidence: float 0.0-1.0 — how confident about the is_demolished judgment? (0.9+ = clearly visible studs/bare subfloor, 0.5 = ambiguous/hard to tell)
- surface_description: string|null — brief description of the surface the meter is touching (e.g., "painted drywall", "bare plywood subfloor", "exposed stud")
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


def _parse_json_response(response_text: str) -> dict:
    """
    Parse JSON from Gemini response with robust cleanup.
    Handles markdown code blocks, trailing commas, and other common issues.
    """
    text = response_text.strip()

    # Remove markdown code blocks
    if text.startswith("```"):
        text = re.sub(r'^```(?:json)?\s*\n?', '', text)
        text = re.sub(r'\n?```\s*$', '', text)

    # Extract JSON object if there's extra text around it
    match = re.search(r'\{.*\}', text, re.DOTALL)
    if match:
        text = match.group(0)

    # Remove trailing commas before } or ]
    text = re.sub(r',\s*([}\]])', r'\1', text)

    # Try parsing
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        # Replace single quotes with double quotes as last resort
        fixed = text.replace("'", '"')
        return json.loads(fixed)


# Phase 2: Meter-focused verification prompt (higher accuracy)
# Used only when Phase 1 demolition judgment is uncertain
METER_VERIFICATION_PROMPT = """This photo contains a moisture meter.
Focus ONLY on these 3 things:

## 1. METER READING (PIN/WOOD moisture ONLY)
Read the PIN or WOOD moisture value on the LCD display. IGNORE RH% and temperature.
Look for labels "PIN", "WOOD", "%WME" to identify the correct reading.
Examples: "22", "67.5", "8", "LO", "HI"
If the display shows "LO" for PIN/WOOD → report meter_reading="LO", meter_color="green"
If the display shows "HI" for PIN/WOOD → report meter_reading="HI", meter_color="red"
Also check the WET/DRY bar indicator at the bottom of the meter.

## 2. SURFACE THE METER IS TOUCHING
Describe the exact surface the meter pins/pad are pressed against.

INTACT (original finish, NOT demolished):
- Painted/finished drywall
- Wallpaper
- Tile, vinyl, laminate flooring
- Baseboards/trim still attached
- Cabinet surface

DEMOLISHED (material removed):
- Bare wood studs or framing
- Cut drywall edge (gypsum layers visible)
- Bare plywood/OSB subfloor
- Concrete slab (flooring removed)
- Exposed insulation
- Wall bottom with no baseboard (nail holes, gap)

## 3. KEY QUESTION
Is the surface the meter touches INTACT or DEMOLISHED?
Ignore equipment/fans in background — only the contact surface matters.

Respond ONLY with valid JSON:
{"meter_reading":null,"meter_color":null,"surface_type":"intact","surface_description":"painted drywall","confidence":0.85}

Fields:
- meter_reading: string|null — exact display value
- meter_color: "green"|"yellow"|"red"|null — from reading or LED
- surface_type: "intact"|"demolished" — the contact surface
- surface_description: string — what the meter is touching
- confidence: float 0.0-1.0 — confidence in surface_type
"""


def _derive_color_from_reading(reading: str) -> str | None:
    """
    Derive meter color from numeric/text reading.

    Returns "green", "yellow", "red", or None if unparseable.
    """
    if not reading:
        return None

    reading_upper = str(reading).strip().upper()

    # Text readings - broad matching for "LO" variants
    # AI may return: "LO", "LOW", "Lo", "L0", "LO PIN", "PIN LO", etc.
    if any(lo in reading_upper for lo in ("LO", "LOW", "L0")):
        return "green"
    if any(hi in reading_upper for hi in ("HI", "HIGH", "H1")):
        return "red"

    # Numeric readings — strip % sign and parse
    try:
        # Extract first numeric value from reading
        import re
        numeric_match = re.search(r'[\d.]+', reading_upper)
        if not numeric_match:
            return None
        value = float(numeric_match.group())
        if value <= 13:
            return "green"
        elif value <= 23:
            return "yellow"
        else:
            return "red"
    except (ValueError, TypeError):
        return None


def validate_and_correct(ai_result: dict) -> dict:
    """
    Apply rule-based post-processing to validate and correct AI classification.

    Rules:
    - Rule 0: Mold detected → uncategorized
    - Rule 0.5: Derive/correct meter_color from meter_reading (numeric)
    - Rule 1: Meter color + demolition state → correct category
      - Rule 1.1: Low demolition_confidence → default to wet-area
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

    # Rule 0.5: Derive meter_color from meter_reading if available
    elif metadata.get("meter_visible"):
        meter_reading = metadata.get("meter_reading")
        ai_color = (metadata.get("meter_color") or "").lower()

        # Normalize text-based meter_color values
        if ai_color in ("lo", "low", "l0"):
            ai_color = "green"
        elif ai_color in ("hi", "high", "h1"):
            ai_color = "red"

        # If we have a numeric/text reading, derive color from it
        derived_color = _derive_color_from_reading(meter_reading)

        # Fallback: check if surface_description mentions LO/HI/DRY
        # (AI sometimes puts reading info in surface_description instead)
        if not derived_color and not meter_reading:
            surface_desc = (metadata.get("surface_description") or "").upper()
            if any(lo in surface_desc for lo in ("LO ", " LO", "\"LO\"", "READS LO", "SHOWING LO", "DISPLAY LO", "DRY READING")):
                derived_color = "green"
                metadata["meter_reading"] = "LO"
                corrections.append({
                    "rule": "lo_from_surface_desc",
                    "reason": f"surface_description에서 LO 감지 → green으로 보정",
                    "from": ai_color or "unknown",
                    "to": "green"
                })
            elif any(hi in surface_desc for hi in ("HI ", " HI", "\"HI\"", "READS HI", "SHOWING HI", "DISPLAY HI")):
                derived_color = "red"
                metadata["meter_reading"] = "HI"

        if derived_color:
            # Reading-based color overrides AI's meter_color
            if ai_color and ai_color != derived_color:
                corrections.append({
                    "rule": "meter_reading_override",
                    "reason": (
                        f"미터기 수치 {meter_reading}"
                        f" → {derived_color}"
                        f" (AI 판단 {ai_color} 보정)"
                    ),
                    "from": ai_color,
                    "to": derived_color
                })
            color = derived_color
            metadata["meter_color"] = derived_color
        elif ai_color in ("red", "yellow", "green"):
            color = ai_color
            metadata["meter_color"] = ai_color
        else:
            color = None

        # Rule 1: Meter color + demolition state → correct category
        if color:
            demolished = metadata.get("is_demolished", False)
            demo_conf = metadata.get(
                "demolition_confidence", 0.5
            )

            # Rule 1.1: Low demolition_confidence → wet-area
            # demolished=true이더라도 confidence가 낮으면
            # wet-area로 분류 (안전한 기본값)
            if demolished and demo_conf < 0.7:
                corrections.append({
                    "rule": "low_demolition_confidence",
                    "reason": (
                        f"철거 판단 confidence {demo_conf}"
                        f" < 0.7 → wet-area로 기본 분류"
                        f" (surface: {metadata.get('surface_description', 'N/A')})"
                    ),
                    "from": "demolished",
                    "to": "not_demolished"
                })
                demolished = False
                metadata["is_demolished"] = False

            expected_category = None

            if color == "red":  # 24%+ / HI = wet
                expected_category = (
                    "day-1" if demolished else "wet-area"
                )
            elif color == "yellow":  # 14-23% = drying
                expected_category = (
                    "day-2" if demolished else "wet-area"
                )
            elif color == "green":  # 0-13% / LO = dry → always day-3
                expected_category = "day-3"

            if expected_category and category != expected_category:
                demo_label = (
                    "철거완료" if demolished else "철거전"
                )
                corrections.append({
                    "rule": (
                        f"meter_{color}"
                        f"_{'demolished' if demolished else 'no_demo'}"
                    ),
                    "reason": (
                        f"미터기 {color}"
                        f" ({meter_reading or 'N/A'})"
                        f" + {demo_label}"
                        f" → {expected_category}"
                    ),
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
                    "reason": (
                        f"적재된 장비 {equipment_count}대"
                        f" (3대 미만) → uncategorized"
                    ),
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

    # Flag for Phase 2 verification if needed
    # meter 사진인데 demolition 판단이 애매한 경우
    if (
        metadata.get("meter_visible")
        and category in (
            "day-1", "day-2", "day-3", "wet-area"
        )
    ):
        demo_conf = metadata.get(
            "demolition_confidence", 0.5
        )
        if 0.5 <= demo_conf < 0.8:
            result["needs_verification"] = True

    return result


class AIClassificationService:
    """AI Photo Classification Service using Gemini Vision API."""

    def __init__(self):
        self.enabled = settings.ENABLE_AI_PHOTO_CLASSIFICATION
        self.api_key = settings.GEMINI_API_KEY
        self.model_name = settings.GEMINI_MODEL
        self._client = None

    def _get_client(self):
        """Lazy load Gemini client (new google-genai SDK)."""
        if self._client is None:
            if not self.api_key:
                raise ValueError("GEMINI_API_KEY is not configured")

            from google import genai
            self._client = genai.Client(api_key=self.api_key)

        return self._client

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
            client = self._get_client()

            # Resize image (1280px for better meter LCD reading accuracy)
            resized_data, resized_mime = _resize_image(image_data, max_size=1280)

            from google.genai import types

            image_part = types.Part.from_bytes(
                data=resized_data,
                mime_type=resized_mime,
            )

            # Call Gemini Vision API
            response = client.models.generate_content(
                model=self.model_name,
                contents=[CLASSIFICATION_PROMPT, image_part],
                config=types.GenerateContentConfig(
                    temperature=0.1,
                    max_output_tokens=1024,
                ),
            )

            # Parse response
            response_text = response.text.strip()

            ai_result = _parse_json_response(response_text)

            # Log raw AI response for debugging meter reading issues
            meta = ai_result.get("metadata", {})
            if meta.get("meter_visible"):
                logger.info(
                    f"AI raw response: category={ai_result.get('category')}, "
                    f"meter_reading={meta.get('meter_reading')}, "
                    f"meter_color={meta.get('meter_color')}, "
                    f"is_demolished={meta.get('is_demolished')}, "
                    f"surface_desc={meta.get('surface_description')}"
                )

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
        """Classify a photo from URL (Phase 1 only)."""
        import httpx

        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    photo_url, timeout=30.0
                )
                response.raise_for_status()

                content_type = response.headers.get(
                    "content-type", "image/jpeg"
                )
                mime_type = content_type.split(";")[0].strip()

                return await self.classify_photo(
                    response.content, mime_type
                )

        except httpx.HTTPError as e:
            logger.error(
                f"Failed to fetch image from URL: {e}"
            )
            return {
                "category": "uncategorized",
                "confidence": 0.0,
                "metadata": {},
                "error": f"Failed to fetch image: {str(e)}"
            }

    async def _verify_meter_surface(
        self,
        image_data: bytes,
    ) -> dict | None:
        """
        Phase 2: Meter surface verification.

        Uses higher resolution (1536px) and a focused prompt
        to accurately determine if the meter is on an intact
        or demolished surface.

        Returns verification result or None on failure.
        """
        try:
            client = self._get_client()

            # Higher resolution for better surface detail
            resized_data, resized_mime = _resize_image(
                image_data, max_size=1536
            )

            from google.genai import types

            image_part = types.Part.from_bytes(
                data=resized_data,
                mime_type=resized_mime,
            )

            response = client.models.generate_content(
                model=self.model_name,
                contents=[
                    METER_VERIFICATION_PROMPT, image_part
                ],
                config=types.GenerateContentConfig(
                    temperature=0.1,
                    max_output_tokens=512,
                    thinking_config=types.ThinkingConfig(
                        thinking_budget=0
                    ),
                ),
            )

            response_text = response.text.strip()

            return _parse_json_response(response_text)

        except Exception as e:
            logger.warning(
                f"Phase 2 meter verification failed: {e}"
            )
            return None

    async def classify_photo_two_phase(
        self,
        image_data: bytes,
        mime_type: str = "image/jpeg"
    ) -> dict:
        """
        Two-phase classification:
        Phase 1: Standard classification (1024px)
        Phase 2: Meter surface verification (1536px)
                 - only when demolition judgment is uncertain

        Cost: Phase 2 adds ~1 extra API call for ~20-30%
        of meter photos where demolition_confidence is ambiguous.
        """
        # Phase 1: Standard classification
        result = await self.classify_photo(
            image_data, mime_type
        )

        # Phase 2: Only if needs_verification flag is set
        if not result.get("needs_verification"):
            return result

        metadata = result.get("metadata", {})
        logger.info(
            "Phase 2: Verifying meter surface"
            f" (demo_conf={metadata.get('demolition_confidence')},"
            f" category={result['category']})"
        )

        verification = await self._verify_meter_surface(
            image_data
        )

        if not verification:
            # Phase 2 failed → keep Phase 1 result
            result["phase2_status"] = "failed"
            return result

        # Apply Phase 2 results
        phase1_category = result["category"]

        # Update meter reading if Phase 2 got a better one
        if verification.get("meter_reading"):
            metadata["meter_reading"] = (
                verification["meter_reading"]
            )
            derived = _derive_color_from_reading(
                verification["meter_reading"]
            )
            if derived:
                metadata["meter_color"] = derived
        elif verification.get("meter_color"):
            metadata["meter_color"] = (
                verification["meter_color"]
            )

        # Update demolition state from Phase 2
        surface_type = verification.get("surface_type")
        v_confidence = verification.get("confidence", 0.5)

        if surface_type == "intact" and v_confidence >= 0.6:
            metadata["is_demolished"] = False
            metadata["demolition_confidence"] = v_confidence
        elif (
            surface_type == "demolished"
            and v_confidence >= 0.7
        ):
            metadata["is_demolished"] = True
            metadata["demolition_confidence"] = v_confidence

        # Update surface description
        if verification.get("surface_description"):
            metadata["surface_description"] = (
                verification["surface_description"]
            )

        # Re-apply rules with updated metadata
        result["metadata"] = metadata
        corrected = validate_and_correct({
            "category": result.get(
                "original_category", phase1_category
            ),
            "confidence": result["confidence"],
            "metadata": metadata
        })

        # Record Phase 2 trace
        corrected["phase2_applied"] = True
        corrected["phase2_verification"] = verification
        if phase1_category != corrected["category"]:
            corrected["phase1_category"] = phase1_category
            logger.info(
                f"Phase 2 correction:"
                f" {phase1_category}"
                f" → {corrected['category']}"
                f" (surface: {surface_type},"
                f" conf: {v_confidence})"
            )

        # Remove the flag
        corrected.pop("needs_verification", None)

        return corrected

    async def classify_photo_from_url_two_phase(
        self, photo_url: str
    ) -> dict:
        """Classify a photo from URL with 2-phase logic."""
        import httpx

        try:
            async with httpx.AsyncClient() as client:
                response = await client.get(
                    photo_url, timeout=30.0
                )
                response.raise_for_status()

                content_type = response.headers.get(
                    "content-type", "image/jpeg"
                )
                mime_type = content_type.split(";")[0].strip()

                return await self.classify_photo_two_phase(
                    response.content, mime_type
                )

        except httpx.HTTPError as e:
            logger.error(
                f"Failed to fetch image from URL: {e}"
            )
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
