"""
Water Mitigation Sketch AI Service.

Uses AI Vision (Anthropic Claude or OpenAI GPT-4o) to analyze floor plan
images and extract wall segments and room boundaries that can be converted
into editable sketch overlay elements.

Provider priority: Anthropic → OpenAI (automatic fallback).
"""

import base64
import json
import logging
import os
from typing import Any, Dict, Optional
from uuid import uuid4

from app.core.config import settings

logger = logging.getLogger(__name__)

# Suppress verbose SDK debug logs (they dump full base64 image payloads)
logging.getLogger("openai._base_client").setLevel(logging.WARNING)
logging.getLogger("anthropic._base_client").setLevel(logging.WARNING)
logging.getLogger("httpx").setLevel(logging.WARNING)

# Module load diagnostic — prints on server start / reload
_ak = (getattr(settings, "ANTHROPIC_API_KEY", None) or os.getenv("ANTHROPIC_API_KEY", "") or "").strip()
_ok = (getattr(settings, "OPENAI_API_KEY", None) or os.getenv("OPENAI_API_KEY", "") or "").strip()
print(f"\n{'='*60}")
print(f"[sketch_ai_service] MODULE LOADED")
print(f"  Anthropic key: {'YES (' + str(len(_ak)) + ' chars)' if _ak else 'NO'}")
print(f"  OpenAI key:    {'YES (' + str(len(_ok)) + ' chars)' if _ok else 'NO'}")
print(f"{'='*60}\n")
del _ak, _ok

# Canvas defaults (must match frontend defaults)
DEFAULT_CANVAS_WIDTH = 1200
DEFAULT_CANVAS_HEIGHT = 900


def _encode_image_to_base64(image_bytes: bytes) -> str:
    """Encode raw image bytes to base64 string for the Vision API."""
    return base64.b64encode(image_bytes).decode("utf-8")


def _resize_image_to_canvas(
    image_bytes: bytes,
    canvas_width: int,
    canvas_height: int,
) -> tuple[bytes, str]:
    """
    Resize the image to exactly match the canvas dimensions using
    contain-fit (same logic as the frontend WMBackgroundImageLayer).
    Returns (resized_jpeg_bytes, media_type).
    """
    from PIL import Image
    from io import BytesIO

    img = Image.open(BytesIO(image_bytes))
    img_w, img_h = img.size

    # contain-fit: scale to fit, center on canvas
    scale = min(canvas_width / img_w, canvas_height / img_h)
    new_w = int(img_w * scale)
    new_h = int(img_h * scale)

    resized = img.resize((new_w, new_h), Image.LANCZOS)

    # Paste onto canvas-sized background (white)
    canvas = Image.new("RGB", (canvas_width, canvas_height), (255, 255, 255))
    offset_x = (canvas_width - new_w) // 2
    offset_y = (canvas_height - new_h) // 2
    canvas.paste(resized, (offset_x, offset_y))

    buf = BytesIO()
    canvas.save(buf, format="JPEG", quality=90)
    return buf.getvalue(), "image/jpeg"


def _detect_media_type(image_bytes: bytes) -> str:
    """Detect image media type from magic bytes."""
    if image_bytes[:8] == b'\x89PNG\r\n\x1a\n':
        return "image/png"
    if image_bytes[:2] == b'\xff\xd8':
        return "image/jpeg"
    if image_bytes[:4] == b'RIFF' and image_bytes[8:12] == b'WEBP':
        return "image/webp"
    return "image/jpeg"  # default fallback


def _build_analysis_prompt(
    canvas_width: int,
    canvas_height: int,
    scale_pixels_per_foot: float,
) -> str:
    """Build the prompt for floor plan analysis."""
    return f"""You are an expert floor plan analyzer. Analyze this floor plan image and extract:
1. **Walls** — line segments representing walls
2. **Rooms** — labeled areas with boundary polygons

The canvas coordinate system:
- Origin (0,0) is top-left
- Canvas size: {canvas_width}px wide × {canvas_height}px tall
- Scale: {scale_pixels_per_foot} pixels per foot
- IMPORTANT: This image has been resized to exactly {canvas_width}x{canvas_height} pixels. Pixel coordinates in the image map 1:1 to canvas coordinates. No offset or scaling needed.

Return a JSON object with this exact structure (no markdown, no explanation, just pure JSON):
{{
  "walls": [
    {{
      "start_x": <number>,
      "start_y": <number>,
      "end_x": <number>,
      "end_y": <number>,
      "thickness": 4,
      "color": "#333333",
      "length_ft": <calculated length in feet>
    }}
  ],
  "rooms": [
    {{
      "name": "<room name like 'Living Room', 'Kitchen', 'Bedroom 1'>",
      "boundary": [
        {{"x": <number>, "y": <number>}},
        ...
      ],
      "color": "rgba(173, 216, 230, 0.3)",
      "height_ft": 8,
      "area_sqft": <calculated area in square feet>
    }}
  ]
}}

Important rules:
- Map wall positions to canvas pixel coordinates ({canvas_width}x{canvas_height}), estimating where walls appear in the image
- Calculate length_ft using the scale ({scale_pixels_per_foot} px/ft)
- Wall endpoints should snap together — shared corners should have identical coordinates
- Room boundaries should be closed polygons (vertices in order, the system will close them automatically)
- Room area_sqft should be calculated from the polygon area converted using the scale
- Name rooms based on any labels visible in the image, or use generic names (Room 1, Room 2, etc.)
- If you cannot identify the floor plan clearly, return {{"walls": [], "rooms": []}}
- Prefer simple, clean wall layouts over noisy detection
- Connect walls at corners where they meet"""


def _parse_ai_response(
    raw_content: str,
    floor_sketch_id: str,
) -> Dict[str, Any]:
    """Parse the AI response JSON and build overlay-compatible data."""
    json_str = raw_content.strip()
    if json_str.startswith("```"):
        lines = json_str.split("\n")
        lines = [l for l in lines if not l.strip().startswith("```")]
        json_str = "\n".join(lines)

    parsed = json.loads(json_str)

    fid = floor_sketch_id or ""
    walls = []
    for w in parsed.get("walls", []):
        walls.append({
            "id": str(uuid4()),
            "floor_sketch_id": fid,
            "start_x": float(w.get("start_x", 0)),
            "start_y": float(w.get("start_y", 0)),
            "end_x": float(w.get("end_x", 0)),
            "end_y": float(w.get("end_y", 0)),
            "thickness": int(w.get("thickness", 4)),
            "color": w.get("color", "#333333"),
            "length_ft": float(w.get("length_ft", 0)),
        })

    rooms = []
    for r in parsed.get("rooms", []):
        boundary = [
            {"x": float(pt.get("x", 0)), "y": float(pt.get("y", 0))}
            for pt in r.get("boundary", [])
        ]
        rooms.append({
            "id": str(uuid4()),
            "floor_sketch_id": fid,
            "name": r.get("name", "Room"),
            "boundary": boundary,
            "color": r.get("color", "rgba(173, 216, 230, 0.3)"),
            "height_ft": float(r.get("height_ft", 8)),
            "area_sqft": float(r.get("area_sqft", 0)),
            "wall_ids": [],
        })

    return {"walls": walls, "rooms": rooms}


# ---------------------------------------------------------------------------
# Provider-specific calls
# ---------------------------------------------------------------------------

async def _call_anthropic(
    b64_image: str,
    media_type: str,
    prompt: str,
    api_key: str = "",
) -> str:
    """Call Anthropic Claude Vision API and return the raw text response."""
    import asyncio
    import anthropic

    key = (
        api_key
        or getattr(settings, "ANTHROPIC_API_KEY", "")
        or os.getenv("ANTHROPIC_API_KEY", "")
    )
    # Use synchronous client (matches rest of codebase) via asyncio.to_thread
    client = anthropic.Anthropic(api_key=key)

    def _sync_call():
        return client.messages.create(
            model=os.getenv("SKETCH_AI_MODEL", "claude-haiku-4-5-20251001"),
            max_tokens=4096,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": media_type,
                                "data": b64_image,
                            },
                        },
                        {
                            "type": "text",
                            "text": prompt,
                        },
                    ],
                }
            ],
        )

    response = await asyncio.to_thread(_sync_call)
    return "".join(
        block.text for block in response.content
        if block.type == "text"
    )


async def _call_openai(
    b64_image: str,
    media_type: str,
    prompt: str,
    api_key: str = "",
) -> str:
    """Call OpenAI GPT-4o Vision API and return the raw text response."""
    from openai import AsyncOpenAI

    key = api_key or getattr(settings, "OPENAI_API_KEY", "") or os.getenv("OPENAI_API_KEY", "")
    client = AsyncOpenAI(api_key=key)
    response = await client.chat.completions.create(
        model="gpt-4o",
        messages=[
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:{media_type};base64,{b64_image}",
                            "detail": "high",
                        },
                    },
                ],
            }
        ],
        max_tokens=4096,
        temperature=0.1,
    )
    return response.choices[0].message.content or ""


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

async def analyze_floor_plan(
    image_bytes: bytes,
    canvas_width: int = DEFAULT_CANVAS_WIDTH,
    canvas_height: int = DEFAULT_CANVAS_HEIGHT,
    scale_pixels_per_foot: float = 20.0,
    floor_sketch_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Analyze a floor plan image using AI Vision and return
    extracted walls and rooms as overlay-compatible data.

    Provider priority: Anthropic Claude → OpenAI GPT-4o (automatic fallback).
    """
    # Try settings first, fall back to os.getenv (handles .env loading edge cases)
    anthropic_key = (
        getattr(settings, "ANTHROPIC_API_KEY", None)
        or os.getenv("ANTHROPIC_API_KEY", "")
        or ""
    ).strip()
    openai_key = (
        getattr(settings, "OPENAI_API_KEY", None)
        or os.getenv("OPENAI_API_KEY", "")
        or ""
    ).strip()

    # Use print() to guarantee visibility regardless of log level config
    print(f"[sketch_ai] AI keys — Anthropic: {'YES' if anthropic_key else 'NO'} ({len(anthropic_key)} chars), OpenAI: {'YES' if openai_key else 'NO'} ({len(openai_key)} chars)")

    if not anthropic_key and not openai_key:
        raise ValueError(
            "No AI API key configured. "
            "Set ANTHROPIC_API_KEY or OPENAI_API_KEY in your .env file."
        )

    # Resize image to exact canvas dimensions (eliminates contain-fit offset guessing)
    try:
        resized_bytes, media_type = _resize_image_to_canvas(
            image_bytes, canvas_width, canvas_height
        )
        print(f"[sketch_ai] Image resized to {canvas_width}x{canvas_height}")
    except Exception:
        # Fallback: use original image if PIL fails
        resized_bytes = image_bytes
        media_type = _detect_media_type(image_bytes)
        print("[sketch_ai] Image resize failed, using original")

    b64_image = _encode_image_to_base64(resized_bytes)
    prompt = _build_analysis_prompt(canvas_width, canvas_height, scale_pixels_per_foot)
    fid = floor_sketch_id or ""

    # Build provider call order: prefer Anthropic, fallback to OpenAI
    providers: list[tuple[str, Any, str]] = []
    if anthropic_key:
        providers.append(("Anthropic Claude", _call_anthropic, anthropic_key))
    if openai_key:
        providers.append(("OpenAI GPT-4o", _call_openai, openai_key))

    print(f"[sketch_ai] Provider order: {[name for name, _, _ in providers]}")

    last_error = None
    for provider_name, call_fn, key in providers:
        try:
            logger.info("Attempting floor plan analysis with %s", provider_name)
            raw_content = await call_fn(b64_image, media_type, prompt, api_key=key)
            logger.info(
                "%s analysis completed. Response length: %d",
                provider_name,
                len(raw_content),
            )

            result = _parse_ai_response(raw_content, fid)
            logger.info(
                "AI analysis extracted %d walls and %d rooms (via %s)",
                len(result["walls"]),
                len(result["rooms"]),
                provider_name,
            )
            return result

        except json.JSONDecodeError as exc:
            print(f"[sketch_ai] {provider_name} returned invalid JSON: {exc}")
            last_error = exc
        except Exception as exc:
            print(f"[sketch_ai] {provider_name} FAILED: {type(exc).__name__}: {exc}")
            last_error = exc

    # All providers failed
    raise ValueError(
        f"AI analysis failed with all providers. Last error: {last_error}"
    )
