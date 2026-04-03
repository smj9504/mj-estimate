import logging
import re
from typing import List, Optional

from app.domains.insurance_extraction.interfaces import (
    ExtractionPipelineResult,
    OcrExtractor,
    ParserResolver,
    TextExtractor,
)
from app.domains.insurance_extraction.parsers.xactimate_layout_parser import (
    _parse_text_layout_items,
    _xactimate_parse_trustworthy,
    parse_xactimate_pdf,
    raw_dicts_to_dtos,
)
from app.domains.insurance_extraction.parsers.xactimate_reference_parser import (
    parse_with_reference,
)

logger = logging.getLogger(__name__)


class InsuranceExtractionOrchestrator:
    def __init__(
        self,
        text_extractor: TextExtractor,
        ocr_extractor: OcrExtractor,
        parser_resolver: ParserResolver,
    ):
        self.text_extractor = text_extractor
        self.ocr_extractor = ocr_extractor
        self.parser_resolver = parser_resolver

    def run(self, file_path: str, carrier: Optional[str] = None) -> ExtractionPipelineResult:
        # Strategy 1: Reference parser (text-based, most robust)
        try:
            ref_items, ref_pages, ref_diag = parse_with_reference(file_path)
            if ref_items:
                resolved_carrier = carrier or self._detect_carrier(ref_pages)
                # Override carrier if reference parser detected one
                if ref_diag.get("header", {}).get("carrier"):
                    resolved_carrier = ref_diag["header"]["carrier"].lower().replace(" ", "_")
                return ExtractionPipelineResult(
                    carrier=resolved_carrier,
                    merged_pages=ref_pages,
                    items=ref_items,
                    metadata={
                        "ocr_attempted": False,
                        **ref_diag,
                    },
                )
            logger.info("Reference parser returned no items, falling back to layout parser")
        except Exception as e:
            logger.warning("Reference parser failed: %s, falling back", e)

        # Strategy 2: Coordinate-based layout parser (pdfplumber)
        xact_items, xact_pages, xact_diag = parse_xactimate_pdf(file_path)
        if xact_items:
            resolved_carrier = carrier or self._detect_carrier(xact_pages)
            return ExtractionPipelineResult(
                carrier=resolved_carrier,
                merged_pages=xact_pages,
                items=xact_items,
                metadata={
                    "ocr_attempted": False,
                    **xact_diag,
                },
            )

        # Strategy 3: Generic text extraction + carrier-specific parsers
        pages_text = self.text_extractor.extract_pages(file_path)
        ocr_pages = self.ocr_extractor.extract_missing_pages(file_path, pages_text)
        merged_pages = self._merge_pages(pages_text, ocr_pages)
        resolved_carrier = carrier or self._detect_carrier(merged_pages)
        parser = self.parser_resolver.resolve(resolved_carrier)
        items = parser.parse_pages(merged_pages, carrier=resolved_carrier)
        if not items:
            text_layout_raw = _parse_text_layout_items(merged_pages)
            text_layout_items = raw_dicts_to_dtos(text_layout_raw)
            if _xactimate_parse_trustworthy(text_layout_items):
                return ExtractionPipelineResult(
                    carrier=resolved_carrier,
                    merged_pages=merged_pages,
                    items=text_layout_items,
                    metadata={
                        "ocr_attempted": bool(ocr_pages),
                        "strategy": "xactimate_text_layout_ocr",
                    },
                )
        return ExtractionPipelineResult(
            carrier=resolved_carrier,
            merged_pages=merged_pages,
            items=items,
            metadata={
                "ocr_attempted": bool(ocr_pages),
                "strategy": "text_then_ocr_fallback",
            },
        )

    def _merge_pages(self, pages_text: List[str], ocr_pages: List[str]) -> List[str]:
        merged: List[str] = []
        for idx, page in enumerate(pages_text):
            ocr = ocr_pages[idx] if idx < len(ocr_pages) else ""
            source = page or ""
            if self._prefer_ocr(source, ocr):
                merged.append(ocr)
            else:
                merged.append(source if source.strip() else ocr)
        return merged

    def _prefer_ocr(self, source: str, ocr: str) -> bool:
        if not ocr or not ocr.strip():
            return False
        s = (source or "").strip()
        if len(s) < 20:
            return True
        if "(cid:" in s:
            return True
        alpha_words = re.findall(r"[A-Za-z]{2,}", s)
        if len(alpha_words) < 5:
            return True
        # pypdf CID extraction often yields many '/12 /45 /7 ...' tokens.
        slash_num_tokens = re.findall(r"/\d{1,4}\b", s)
        if len(slash_num_tokens) >= 15:
            return True
        return False

    def _detect_carrier(self, pages_text: List[str]) -> str:
        joined = "\n".join(pages_text).lower()
        carriers = {
            "state farm": "state_farm",
            "allstate": "allstate",
            "farmers": "farmers",
            "liberty mutual": "liberty_mutual",
            "travelers": "travelers",
        }
        for token, carrier_name in carriers.items():
            if token in joined:
                return carrier_name
        return "generic"
