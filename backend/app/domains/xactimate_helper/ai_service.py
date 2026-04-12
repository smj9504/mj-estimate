"""
Xactimate Helper Tool - AI Pipeline Service

Step 1: Vision AI  (photo → keywords)
Step 2: Vector Search (keywords → Line Item candidates)
Step 3: LLM Matching (candidates → Assembly)
Step 4: Correction Feedback (prior corrections applied)
Step 5: Description AI Generation (missing descriptions)
"""

import base64
import json
import logging
from pathlib import Path
from typing import Any, Dict, List, Optional

from app.core.config import settings

logger = logging.getLogger(__name__)

# Lazy-loaded clients
_openai_client = None
_anthropic_client = None


def _get_openai():
    global _openai_client
    if _openai_client is None:
        try:
            import openai
            _openai_client = openai.OpenAI(api_key=settings.OPENAI_API_KEY)
        except Exception as e:
            logger.error(f"Failed to initialize OpenAI client: {e}")
            raise
    return _openai_client


def _get_anthropic():
    global _anthropic_client
    if _anthropic_client is None:
        try:
            import anthropic
            _anthropic_client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)
        except Exception as e:
            logger.error(f"Failed to initialize Anthropic client: {e}")
            raise
    return _anthropic_client


# ─── Step 1: Vision AI ────────────────────────────────────────────────────────


VISION_SYSTEM_PROMPT = """You are a licensed restoration estimator reviewing damage photos.
Analyze the image and output ONLY a JSON array of strings.
Each string should describe:
1. The damaged material (e.g., baseboard, drywall, carpet)
2. The required action (e.g., remove and replace, clean, inspect)
3. The likely unit of measure (LF, SF, EA, HR)
Do not include pricing. Do not explain. Output JSON only."""


async def extract_keywords_from_photo(photo_data: str) -> List[str]:
    """
    Step 1: Use Vision AI to extract damage keywords from a photo.

    Args:
        photo_data: Base64 encoded image or file path

    Returns:
        List of keyword strings describing damage and required work
    """
    vision_model = getattr(settings, "XACT_VISION_MODEL", "claude-haiku-4-5-20241022")

    try:
        # Determine if photo_data is a file path or base64
        if Path(photo_data).exists():
            with open(photo_data, "rb") as f:
                image_bytes = f.read()
            image_b64 = base64.b64encode(image_bytes).decode("utf-8")
            media_type = "image/jpeg"  # Default; could detect from extension
        else:
            image_b64 = photo_data
            media_type = "image/jpeg"

        if "claude" in vision_model.lower():
            client = _get_anthropic()
            response = client.messages.create(
                model=vision_model,
                max_tokens=1024,
                system=VISION_SYSTEM_PROMPT,
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "image",
                                "source": {
                                    "type": "base64",
                                    "media_type": media_type,
                                    "data": image_b64,
                                },
                            },
                            {
                                "type": "text",
                                "text": "Analyze this damage photo and extract line item keywords.",
                            },
                        ],
                    }
                ],
            )
            text = response.content[0].text
        else:
            # OpenAI GPT-4o-mini
            client = _get_openai()
            response = client.chat.completions.create(
                model=vision_model,
                max_tokens=1024,
                messages=[
                    {"role": "system", "content": VISION_SYSTEM_PROMPT},
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "image_url",
                                "image_url": {
                                    "url": f"data:{media_type};base64,{image_b64}"
                                },
                            },
                            {
                                "type": "text",
                                "text": "Analyze this damage photo and extract line item keywords.",
                            },
                        ],
                    },
                ],
            )
            text = response.choices[0].message.content

        # Parse JSON from response
        keywords = json.loads(text.strip())
        if isinstance(keywords, list):
            return keywords
        return [str(keywords)]

    except json.JSONDecodeError:
        logger.warning(f"Vision AI returned non-JSON: {text[:200]}")
        # Try to extract useful text anyway
        return [text.strip()] if text else []
    except Exception as e:
        logger.error(f"Vision AI failed: {e}")
        raise


# ─── Step 2: Embedding Generation ────────────────────────────────────────────


async def generate_embedding(text: str) -> List[float]:
    """
    Generate embedding vector using OpenAI text-embedding-3-small.

    Args:
        text: Text to embed

    Returns:
        1536-dimensional embedding vector
    """
    embedding_model = getattr(settings, "XACT_EMBEDDING_MODEL", "text-embedding-3-small")
    try:
        client = _get_openai()
        response = client.embeddings.create(
            model=embedding_model,
            input=text,
        )
        return response.data[0].embedding
    except Exception as e:
        logger.error(f"Embedding generation failed: {e}")
        raise


async def generate_embeddings_batch(texts: List[str]) -> List[List[float]]:
    """Batch embedding generation."""
    embedding_model = getattr(settings, "XACT_EMBEDDING_MODEL", "text-embedding-3-small")
    try:
        client = _get_openai()
        # OpenAI supports batch embedding (up to 2048 per request)
        batch_size = 100
        all_embeddings = []
        for i in range(0, len(texts), batch_size):
            batch = texts[i : i + batch_size]
            response = client.embeddings.create(
                model=embedding_model,
                input=batch,
            )
            all_embeddings.extend([d.embedding for d in response.data])
        return all_embeddings
    except Exception as e:
        logger.error(f"Batch embedding generation failed: {e}")
        raise


# ─── Step 3: LLM Assembly Matching ───────────────────────────────────────────


MATCHING_SYSTEM_PROMPT = """You are a Xactimate estimator. Given the damage description and
candidate line items, select the appropriate items and calculate
quantities. Return ONLY valid JSON in this format:
{
  "assembly_name": "string",
  "items": [
    {
      "item_code": "string",
      "qty": number,
      "unit": "string",
      "reason": "string"
    }
  ]
}

Rules:
- Only select items from the provided candidates
- Calculate quantities based on the room dimensions provided
- Include a brief reason for each item selection
- Do not invent item codes that are not in the candidate list"""


async def match_candidates_to_assembly(
    keywords: List[str],
    candidates: List[Dict[str, Any]],
    room_info: Dict[str, Any],
    correction_hints: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """
    Step 3: Use LLM to match candidate line items into an assembly.

    Args:
        keywords: Extracted damage keywords from Step 1
        candidates: Top N candidate line items from Step 2 vector search
        room_info: Room dimensions, type, conditions
        correction_hints: Prior correction feedback as hint strings

    Returns:
        Assembly JSON with selected items and quantities
    """
    matching_model = getattr(settings, "XACT_MATCHING_MODEL", "claude-sonnet-4-6-20250514")

    # Build user prompt
    candidate_text = json.dumps(
        [
            {
                "item_code": c.get("item_code"),
                "description": c.get("description"),
                "unit": c.get("unit"),
                "unit_price": c.get("unit_price"),
            }
            for c in candidates
        ],
        indent=2,
    )

    user_prompt = f"""Damage keywords: {json.dumps(keywords)}

Room info:
- Name: {room_info.get('name', 'Unknown')}
- Type: {room_info.get('room_type', 'unknown')}
- Dimensions: {json.dumps(room_info.get('dimensions', {}))}
- Damage type: {room_info.get('damage_type', 'general')}
- Conditions: {json.dumps(room_info.get('condition_flags', {}))}

Candidate line items (select from these ONLY):
{candidate_text}"""

    if correction_hints:
        user_prompt += f"\n\nPrior correction hints (use these to guide selection):\n"
        for hint in correction_hints:
            user_prompt += f"- {hint}\n"

    try:
        if "claude" in matching_model.lower():
            client = _get_anthropic()
            response = client.messages.create(
                model=matching_model,
                max_tokens=2048,
                system=MATCHING_SYSTEM_PROMPT,
                messages=[{"role": "user", "content": user_prompt}],
            )
            text = response.content[0].text
        else:
            client = _get_openai()
            response = client.chat.completions.create(
                model=matching_model,
                max_tokens=2048,
                messages=[
                    {"role": "system", "content": MATCHING_SYSTEM_PROMPT},
                    {"role": "user", "content": user_prompt},
                ],
            )
            text = response.choices[0].message.content

        # Parse JSON response
        # Strip markdown code blocks if present
        text = text.strip()
        if text.startswith("```"):
            text = text.split("\n", 1)[1] if "\n" in text else text[3:]
            if text.endswith("```"):
                text = text[:-3]
            text = text.strip()

        result = json.loads(text)
        return result

    except json.JSONDecodeError:
        logger.warning(f"LLM returned non-JSON: {text[:300]}")
        return {"assembly_name": "AI Recommendation", "items": []}
    except Exception as e:
        logger.error(f"LLM matching failed: {e}")
        raise


# ─── Step 5: Description AI Generation ───────────────────────────────────────


DESCRIPTION_SYSTEM_PROMPT = """You are a public adjuster writing justification descriptions
for insurance claim estimates. Write 2-3 sentences explaining
why the line item [{item_code}: {description}] is necessary.

Context:
- Damage type: {damage_type}
- Location: {room_type}
- Relevant code/standard: {source_reference}

Rules:
- Sentence 1: State the physical damage fact
- Sentence 2: Reference the legal or industry standard obligation
- Sentence 3: Connect to the specific work required
- No emotional language. Technical and factual only.
- If citing a code, use the exact section number."""


async def generate_description(
    item_code: str,
    item_description: str,
    damage_type: str,
    room_type: str,
    description_type: str,
    source_reference: Optional[str] = None,
) -> Dict[str, str]:
    """
    Step 5: Generate justification description for a line item.

    Returns:
        Dict with 'title' and 'body'
    """
    desc_model = getattr(settings, "XACT_VISION_MODEL", "claude-haiku-4-5-20241022")

    prompt = DESCRIPTION_SYSTEM_PROMPT.format(
        item_code=item_code,
        description=item_description,
        damage_type=damage_type,
        room_type=room_type,
        source_reference=source_reference or "N/A",
    )

    type_labels = {
        "waste": "Waste Factor Justification",
        "building_code": "Building Code Requirement",
        "secondary_damage": "Secondary Damage",
        "scope_of_work": "Scope of Work",
        "industry_standard": "Industry Standard",
    }

    user_prompt = (
        f"Generate a {description_type} justification for line item {item_code}."
    )

    try:
        if "claude" in desc_model.lower():
            client = _get_anthropic()
            response = client.messages.create(
                model=desc_model,
                max_tokens=512,
                system=prompt,
                messages=[{"role": "user", "content": user_prompt}],
            )
            body = response.content[0].text.strip()
        else:
            client = _get_openai()
            response = client.chat.completions.create(
                model=desc_model,
                max_tokens=512,
                messages=[
                    {"role": "system", "content": prompt},
                    {"role": "user", "content": user_prompt},
                ],
            )
            body = response.choices[0].message.content.strip()

        title = f"{item_code} — {type_labels.get(description_type, description_type)}"

        return {"title": title, "body": body}

    except Exception as e:
        logger.error(f"Description AI generation failed: {e}")
        raise
