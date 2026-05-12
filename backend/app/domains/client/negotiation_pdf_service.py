"""
Negotiation PDF Service - Extract summary sections from insurance estimate PDFs

Hybrid approach:
1. Text extraction + regex parsing (free, fast) — works for most PDFs
2. GPT-4o Vision fallback — for CID-encoded or complex-layout PDFs

Sections include: Dwelling, Water Mitigation, Code Upgrade, etc.
"""

import base64
import json
import logging
import re
from typing import Any, Dict, List, Optional, Tuple

from app.core.config import settings

logger = logging.getLogger(__name__)

# Lazy-loaded OpenAI client (only for Vision fallback)
_openai_client = None


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


# ─── Text Extraction ─────────────────────────────────────────────────────────

def _extract_all_text(pdf_path: str) -> Tuple[List[str], bool]:
    """
    Extract text from all pages. Returns (pages_text_list, is_readable).
    is_readable = False when CID-encoded or garbage text detected.
    """
    pages = []
    is_readable = False

    # Try pypdf first
    try:
        try:
            from pypdf import PdfReader
        except ImportError:
            from PyPDF2 import PdfReader

        reader = PdfReader(pdf_path)
        for page in reader.pages:
            text = page.extract_text() or ""
            pages.append(text)
            if len(text) > 50 and not text.startswith("/"):
                is_readable = True

        if is_readable:
            return pages, True
    except Exception as e:
        logger.warning(f"pypdf extraction failed: {e}")

    # Fallback: pymupdf
    try:
        import fitz
        pages = []
        doc = fitz.open(pdf_path)
        for i in range(len(doc)):
            text = doc[i].get_text()
            pages.append(text)
            if len(text) > 50 and not text.startswith("\x00"):
                is_readable = True
        doc.close()
        return pages, is_readable
    except Exception as e:
        logger.warning(f"pymupdf extraction failed: {e}")

    return pages, False


# ─── Summary Page Detection ──────────────────────────────────────────────────

SUMMARY_KEYWORDS = [
    "summary for",
    "net actual cash value",
    "replacement cost value",
    "line item total",
    "general contractor overhead",
    "less depreciation",
    "total amount of claim",
    "maximum additional amounts",
    # Erie Insurance / non-Xactimate summary keywords
    "estimate subtotal",
    "estimate total",
    "total materials",
    "total labor",
    "overhead",
    "profit",
]


def _find_summary_pages(pages_text: List[str]) -> List[int]:
    """Find pages containing summary sections by keyword matching."""
    summary_pages = []
    for i, text in enumerate(pages_text):
        lower = text.lower()
        matches = sum(1 for kw in SUMMARY_KEYWORDS if kw in lower)
        if matches >= 3:
            summary_pages.append(i)
    return summary_pages


# ─── Text-Based Summary Parser (No AI) ───────────────────────────────────────

# Regex patterns for extracting dollar amounts from summary pages
_AMOUNT_PATTERN = re.compile(
    r"(?P<label>[A-Za-z][A-Za-z\s\-\(\)&/,.']+?)\s+"
    r"\$?\s*(?P<amount>[\d,]+\.?\d{0,2})\s*$",
    re.MULTILINE,
)

# Known field name mappings (label text → section field name)
_FIELD_MAP = {
    # Line items & tax
    "line item total": "line_item_total",
    "line item totals": "line_item_total",
    "material sales tax": "material_sales_tax",
    "subtotal": "subtotal",
    # Overhead & Profit
    "general contractor overhead": "overhead_amount",
    "overhead": "overhead_amount",
    "general contractor profit": "profit_amount",
    "profit": "profit_amount",
    # RCV
    "replacement cost value (including general contractor overhead and profit)": "rcv",
    "replacement cost value": "rcv",
    # Depreciation
    "total line item depreciation (including taxes)": "depreciation",
    "less depreciation (including taxes)": "depreciation",
    "less depreciation": "depreciation",
    # Deductible
    "less deductible": "deductible",
    "deductible": "deductible",
    # Net ACV (various carrier terms)
    "net actual cash value payment": "net_acv",
    "net actual cash value": "net_acv",
    "net claim": "net_acv",
    "actual cash value payment": "net_acv",
    # Recoverable depreciation
    "total recoverable depreciation": "recoverable_depreciation",
    "recoverable depreciation": "recoverable_depreciation",
    "replacement cost benefits": "recoverable_depreciation",
    "total maximum additional amounts available if incurred": "recoverable_depreciation",
    "total maximum additional amount available if incurred": "recoverable_depreciation",
    # Non-recoverable
    "non - recoverable depreciation": "non_recoverable_depreciation",
    "non-recoverable depreciation": "non_recoverable_depreciation",
    # Total if incurred
    "total amount of claim if incurred": "total_if_incurred",
    "net claim if depreciation is recovered": "total_if_incurred",
    # Erie Insurance / non-Xactimate format
    "estimate subtotal": "rcv",
    "estimate total on coverage dwelling": "rcv",
    "estimate total": "net_acv",
    "total materials": "line_item_total",
    "total labor": "labor_total",
    "total equipment": "equipment_total",
}

# Summary section header pattern
_SECTION_HEADER = re.compile(
    r"Summary\s+for\s+(.+?)(?:\n|$)",
    re.IGNORECASE,
)


def _parse_number(s: str) -> float:
    """Parse number string: '22,459.62' → 22459.62, '(1,000.00)' → 1000.00"""
    s = s.strip().replace(",", "")
    neg = s.startswith("(") and s.endswith(")")
    s = s.replace("(", "").replace(")", "").replace("$", "").strip()
    try:
        val = float(s)
        return abs(val)  # Depreciation/deductible always stored positive
    except ValueError:
        return 0.0


def _extract_sections_from_text(page_text: str) -> List[Dict[str, Any]]:
    """
    Parse summary sections from a single page's text using regex.
    Returns list of section dicts.
    """
    sections = []

    # Split by "Summary for ..." headers
    parts = _SECTION_HEADER.split(page_text)

    # parts[0] = text before first header (skip)
    # parts[1] = first section name, parts[2] = first section body, etc.
    if len(parts) < 3:
        # No "Summary for" header found — try parsing the whole page as one section
        # Detect section name from ESTIMATE header if present
        est_m = re.search(
            r"ESTIMATE:\s*(\w[\w\s]*?)(?:\s*\(|$)",
            page_text, re.IGNORECASE,
        )
        section_name = est_m.group(1).strip() if est_m else "Dwelling"
        section = _parse_section_body(page_text, section_name)
        if section and (section.get("rcv", 0) > 0 or section.get("net_acv", 0) > 0):
            sections.append(section)
        return sections

    for i in range(1, len(parts), 2):
        section_name = parts[i].strip()
        body = parts[i + 1] if i + 1 < len(parts) else ""
        section = _parse_section_body(body, section_name)
        if section:
            sections.append(section)

    return sections


def _parse_section_body(body: str, section_name: str) -> Optional[Dict[str, Any]]:
    """Parse dollar amounts from a section body text.
    Each line has format: 'Label text  amount' or 'Label text  (amount)'
    """
    section: Dict[str, Any] = {
        "section_name": section_name,
        "line_item_total": 0,
        "material_sales_tax": 0,
        "subtotal": 0,
        "overhead_amount": 0,
        "profit_amount": 0,
        "rcv": 0,
        "depreciation": 0,
        "deductible": 0,
        "net_acv": 0,
        "recoverable_depreciation": 0,
        "non_recoverable_depreciation": 0,
        "total_if_incurred": 0,
    }

    found_any = False
    lines = body.split("\n")

    for line in lines:
        line = line.strip()
        if not line:
            continue

        # Extract amount: match dollar amount at end of line
        # Handles: 17,643.19  |  (2,276.16)  |  $19,183.46
        amount_match = re.search(
            r"\$?\s*\(?([\d,]+\.\d{2})\)?\s*$", line
        )
        if not amount_match:
            continue

        amount_str = amount_match.group(1)
        value = _parse_number(amount_str)
        if value <= 0:
            continue

        # Get label text (everything before the amount)
        label_part = line[:amount_match.start()].strip()
        # Clean label: remove $, trailing spaces, leading junk
        label_part = re.sub(r"[$@]", "", label_part).strip()
        label_lower = label_part.lower().strip()

        # Skip lines that are just numbers or percentages (e.g., "10.0% x 6,105.10")
        if not label_lower or re.match(r"^[\d\s.%x@]+$", label_lower):
            continue

        # Match against known field names — use longest match first
        matched = False
        for known_label, field_name in sorted(_FIELD_MAP.items(), key=lambda x: -len(x[0])):
            if known_label in label_lower:
                section[field_name] = value
                found_any = True
                matched = True
                break

        if not matched:
            # Fallback: check for specific single-word labels
            if label_lower == "subtotal":
                section["subtotal"] = value
                found_any = True

    if not found_any:
        return None

    # Require RCV or net_acv > 0 — a summary section without either is invalid
    if (not section.get("rcv") or section["rcv"] <= 0) and \
       (not section.get("net_acv") or section["net_acv"] <= 0):
        return None

    # Require at least 2 meaningful fields
    # (Erie has fewer summary fields than Xactimate)
    meaningful = sum(
        1 for k in [
            "line_item_total", "subtotal", "rcv",
            "net_acv", "depreciation", "overhead_amount",
            "labor_total", "equipment_total",
        ]
        if section.get(k, 0) and section[k] > 0
    )
    if meaningful < 2:
        return None

    # Auto-compute net_acv if missing but rcv is present
    if not section.get("net_acv") and section.get("rcv", 0) > 0:
        section["net_acv"] = round(
            section["rcv"]
            - section.get("depreciation", 0)
            - section.get("deductible", 0),
            2,
        )

    return section


# ─── PDF Page to Image Rendering (for AI fallback) ───────────────────────────

def _render_pages_to_images(pdf_path: str, page_indices: List[int]) -> List[Tuple[bytes, str]]:
    """Render specific PDF pages to PNG images using pymupdf."""
    import fitz

    doc = fitz.open(pdf_path)
    images = []
    for page_idx in page_indices:
        if page_idx >= len(doc):
            continue
        page = doc[page_idx]
        mat = fitz.Matrix(2.0, 2.0)
        pix = page.get_pixmap(matrix=mat)
        images.append((pix.tobytes("png"), "image/png"))
    doc.close()
    return images


# ─── GPT-4o Vision Extraction (Fallback) ─────────────────────────────────────

EXTRACTION_SYSTEM_PROMPT = """You are an insurance estimate document parser specializing in Xactimate estimates.
Extract financial summary sections from the provided page image.
Return ONLY a valid JSON array — no markdown, no explanation.

Each object in the array represents one "Summary for ..." section. Extract these fields:
- section_name (string): The full section title, e.g. "Coverage A - Dwelling - 37 Water Damage and Freezing"
- line_item_total (number): "Line Item Total" amount
- material_sales_tax (number): "Material Sales Tax" amount
- subtotal (number): Subtotal (Line Item Total + Tax)
- overhead_amount (number): "General Contractor Overhead" amount
- profit_amount (number): "General Contractor Profit" amount
- rcv (number): "Replacement Cost Value" amount
- depreciation (number): "Less Depreciation" amount (positive number even if shown as negative)
- deductible (number): "Less Deductible" amount (positive number)
- net_acv (number): "Net Actual Cash Value Payment" amount
- recoverable_depreciation (number): Total recoverable depreciation, 0 if not shown
- non_recoverable_depreciation (number): Non-recoverable depreciation, 0 if not shown
- total_if_incurred (number): "Total Amount of Claim If Incurred", 0 if not shown

IMPORTANT:
- Parentheses around numbers like (2,276.16) mean the value should be stored as POSITIVE.
- Depreciation and deductible are ALWAYS stored as positive numbers.
- If a field is not present on the page, use 0.
- If there are multiple summary sections on the same page, include each as a separate object.
- Return [] if no summary section is found on this page."""


def _extract_sections_via_vision(
    image_bytes: bytes,
    media_type: str,
) -> List[Dict[str, Any]]:
    """Send page image to GPT-4o Vision and extract summary sections."""
    client = _get_openai()
    model = getattr(settings, "NEGOTIATION_EXTRACTION_MODEL", "gpt-4o")

    image_b64 = base64.b64encode(image_bytes).decode("utf-8")
    data_url = f"data:{media_type};base64,{image_b64}"

    response = client.chat.completions.create(
        model=model,
        max_tokens=4096,
        messages=[
            {"role": "system", "content": EXTRACTION_SYSTEM_PROMPT},
            {
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": data_url, "detail": "high"}},
                    {"type": "text", "text": "Extract all financial summary sections from this insurance estimate page. Return JSON array only."},
                ],
            },
        ],
    )

    raw_text = response.choices[0].message.content.strip()

    # Strip markdown code fences if present
    if raw_text.startswith("```"):
        lines = raw_text.split("\n")
        lines = [l for l in lines if not l.startswith("```")]
        raw_text = "\n".join(lines).strip()

    try:
        sections = json.loads(raw_text)
        if not isinstance(sections, list):
            sections = [sections]
        return sections
    except json.JSONDecodeError as e:
        logger.error(f"Failed to parse GPT-4o response as JSON: {e}\nRaw: {raw_text}")
        return []


# ─── Validation ──────────────────────────────────────────────────────────────

TOLERANCE = 5.0  # Allow $5 tolerance for rounding differences


def validate_sections(sections: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Cross-validate extracted section amounts for accuracy."""
    warnings = []

    for sec in sections:
        name = sec.get("section_name", "Unknown")
        subtotal = sec.get("subtotal", 0) or 0
        overhead = sec.get("overhead_amount", 0) or 0
        profit = sec.get("profit_amount", 0) or 0
        rcv = sec.get("rcv", 0) or 0
        depreciation = sec.get("depreciation", 0) or 0
        deductible = sec.get("deductible", 0) or 0
        net_acv = sec.get("net_acv", 0) or 0
        line_item_total = sec.get("line_item_total", 0) or 0
        tax = sec.get("material_sales_tax", 0) or 0

        if subtotal > 0 and line_item_total > 0:
            expected = line_item_total + tax
            diff = abs(expected - subtotal)
            if diff > TOLERANCE:
                warnings.append(
                    f"[{name}] Subtotal mismatch: {line_item_total} + {tax} = {expected}, "
                    f"but Subtotal = {subtotal} (diff: ${diff:.2f})"
                )

        if rcv > 0 and subtotal > 0:
            expected = subtotal + overhead + profit
            diff = abs(expected - rcv)
            if diff > TOLERANCE:
                warnings.append(
                    f"[{name}] RCV mismatch: Subtotal + O&P = {expected}, "
                    f"but RCV = {rcv} (diff: ${diff:.2f})"
                )

        if net_acv > 0 and rcv > 0:
            expected = rcv - depreciation - deductible
            diff = abs(expected - net_acv)
            if diff > TOLERANCE:
                warnings.append(
                    f"[{name}] Net ACV mismatch: RCV - Dep - Ded = {expected}, "
                    f"but Net ACV = {net_acv} (diff: ${diff:.2f})"
                )

    return {"is_valid": len(warnings) == 0, "warnings": warnings}


# ─── Totals Computation ─────────────────────────────────────────────────────

def compute_totals(sections: List[Dict[str, Any]]) -> Dict[str, float]:
    """Compute aggregated flat amounts from all sections."""
    return {
        "rcv_amount": round(sum(sec.get("rcv", 0) or 0 for sec in sections), 2),
        "acv_amount": round(sum(sec.get("net_acv", 0) or 0 for sec in sections), 2),
        "depreciation_amount": round(sum(sec.get("depreciation", 0) or 0 for sec in sections), 2),
        "deductible": round(sum(sec.get("deductible", 0) or 0 for sec in sections), 2),
    }


# ─── Main Extraction Pipeline ───────────────────────────────────────────────

def extract_summary_from_pdf(pdf_path: str) -> Dict[str, Any]:
    """
    Main entry point: extract summary sections from an insurance estimate PDF.
    Strategy 1: Text extraction + regex (free, fast)
    Strategy 2: GPT-4o Vision fallback (for CID-encoded or failed text parsing)
    """
    model = getattr(settings, "NEGOTIATION_EXTRACTION_MODEL", "gpt-4o")

    # Step 1: Extract text from all pages
    pages_text, is_readable = _extract_all_text(pdf_path)
    strategy = "text_regex"

    all_sections = []

    if is_readable:
        # Strategy 1: Text-based parsing (no AI cost)
        summary_page_indices = _find_summary_pages(pages_text)
        logger.info(f"[Text] Found {len(summary_page_indices)} summary pages: {summary_page_indices}")

        for idx in summary_page_indices:
            page_sections = _extract_sections_from_text(pages_text[idx])
            all_sections.extend(page_sections)
            logger.info(f"[Text] Page {idx}: extracted {len(page_sections)} sections")

        # Check if text parsing found meaningful data
        has_meaningful_data = any(
            sec.get("rcv", 0) > 0 or sec.get("net_acv", 0) > 0
            for sec in all_sections
        )

        if not has_meaningful_data:
            logger.info("[Text] No meaningful amounts found, falling back to AI Vision")
            all_sections = []  # Reset for Vision fallback
        else:
            logger.info(f"[Text] Successfully extracted {len(all_sections)} sections without AI")

    if not all_sections:
        # Strategy 2: GPT-4o Vision fallback
        strategy = "gpt4o_vision"
        logger.info("[Vision] Using GPT-4o Vision fallback")

        if is_readable:
            summary_page_indices = _find_summary_pages(pages_text)
        else:
            summary_page_indices = []

        if not summary_page_indices:
            import fitz
            doc = fitz.open(pdf_path)
            total_pages = len(doc)
            doc.close()
            summary_page_indices = list(range(min(5, total_pages)))
            logger.warning(f"[Vision] No summary pages detected, trying first {len(summary_page_indices)} pages")

        images = _render_pages_to_images(pdf_path, summary_page_indices)
        for i, (img_bytes, media_type) in enumerate(images):
            page_sections = _extract_sections_via_vision(img_bytes, media_type)
            all_sections.extend(page_sections)
            logger.info(f"[Vision] Page {summary_page_indices[i]}: extracted {len(page_sections)} sections")

    # Deduplicate sections by name
    seen_names = set()
    unique_sections = []
    for sec in all_sections:
        name = sec.get("section_name", "").strip()
        if name and name not in seen_names:
            seen_names.add(name)
            unique_sections.append(sec)
        elif not name:
            unique_sections.append(sec)

    # Validate and compute totals
    validation = validate_sections(unique_sections)
    totals = compute_totals(unique_sections)

    return {
        "sections": unique_sections,
        "totals": totals,
        "validation": validation,
        "metadata": {
            "model": model if strategy == "gpt4o_vision" else "text_regex",
            "strategy": strategy,
            "pages_scanned": len(summary_page_indices) if 'summary_page_indices' in dir() else 0,
            "sections_extracted": len(unique_sections),
        },
    }
