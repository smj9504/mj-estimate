"""
Insurance extraction pipeline — orchestrates multiple parsing strategies.

Key optimization: PDF is opened ONCE for pdfplumber-based strategies (1 & 2),
then only text is reused for strategies 3-5.
"""

import logging
from typing import List, Optional

from app.domains.insurance_extraction.interfaces import (
    ExtractionPipelineResult,
    OcrExtractor,
    ParserResolver,
    TextExtractor,
)
from app.domains.insurance_extraction.parsers.ai_fallback_parser import (
    parse_with_ai,
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

# Maximum pages to process to prevent OOM on large PDFs
MAX_PAGES = 40


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

    def run(
        self, file_path: str, carrier: Optional[str] = None
    ) -> ExtractionPipelineResult:
        strategy_log: List[str] = []

        # Strategy 1: Reference parser (text-based, most robust)
        # This opens the PDF once with pdfplumber internally.
        try:
            ref_items, ref_pages, ref_diag = parse_with_reference(
                file_path, max_pages=MAX_PAGES
            )
            if ref_items:
                resolved_carrier = (
                    carrier or self._detect_carrier(ref_pages)
                )
                if ref_diag.get("header", {}).get("carrier"):
                    resolved_carrier = (
                        ref_diag["header"]["carrier"]
                        .lower()
                        .replace(" ", "_")
                    )
                return ExtractionPipelineResult(
                    carrier=resolved_carrier,
                    merged_pages=ref_pages,
                    items=ref_items,
                    metadata={
                        "ocr_attempted": False,
                        "strategy_log": strategy_log
                        + ["reference:OK"],
                        **ref_diag,
                    },
                )
            reason = ref_diag.get("reference_skipped", "no_items")
            strategy_log.append(f"reference:FAIL({reason})")
            # Reuse page_texts from reference parser for subsequent
            # strategies to avoid reopening the PDF.
            page_texts = ref_pages
            logger.info(
                "Reference parser: no items (%s), trying layout",
                reason,
            )
        except Exception as e:
            strategy_log.append(f"reference:ERROR({e})")
            logger.warning("Reference parser failed: %s", e)
            page_texts = None

        # Strategy 2: Coordinate-based layout parser (pdfplumber)
        # This must re-open the PDF for word coordinates, but we skip
        # it if the reference parser already extracted page texts and
        # had structural success (rooms found = valid Xactimate PDF).
        try:
            xact_items, xact_pages, xact_diag = parse_xactimate_pdf(
                file_path, max_pages=MAX_PAGES
            )
            if xact_items:
                resolved_carrier = carrier or self._detect_carrier(
                    xact_pages
                )
                return ExtractionPipelineResult(
                    carrier=resolved_carrier,
                    merged_pages=xact_pages,
                    items=xact_items,
                    metadata={
                        "ocr_attempted": False,
                        "strategy_log": strategy_log + ["layout:OK"],
                        **xact_diag,
                    },
                )
            reason = xact_diag.get("xactimate_skipped", "no_items")
            strategy_log.append(f"layout:FAIL({reason})")
            # Use layout parser's page_texts if reference didn't provide
            if page_texts is None:
                page_texts = xact_pages
        except Exception as e:
            strategy_log.append(f"layout:ERROR({e})")
            logger.warning("Layout parser failed: %s", e)

        # Strategy 3: Generic text-based carrier parsers
        # Reuse already-extracted page_texts — no PDF re-open needed.
        if page_texts is None:
            # Fallback: extract with lightweight pypdf
            try:
                page_texts = self.text_extractor.extract_pages(file_path)
            except Exception as e:
                logger.error("Text extraction failed: %s", e)
                return ExtractionPipelineResult(
                    carrier=carrier or "generic",
                    merged_pages=[],
                    items=[],
                    metadata={
                        "strategy": "extraction_failed",
                        "strategy_log": strategy_log
                        + [f"text_extract:ERROR({e})"],
                    },
                )

        resolved_carrier = carrier or self._detect_carrier(page_texts)
        parser = self.parser_resolver.resolve(resolved_carrier)
        items = parser.parse_pages(page_texts, carrier=resolved_carrier)

        if not items:
            # Sub-strategy: text layout items
            text_layout_raw = _parse_text_layout_items(page_texts)
            text_layout_items = raw_dicts_to_dtos(text_layout_raw)
            if _xactimate_parse_trustworthy(text_layout_items):
                strategy_log.append("text_layout:OK")
                return ExtractionPipelineResult(
                    carrier=resolved_carrier,
                    merged_pages=page_texts,
                    items=text_layout_items,
                    metadata={
                        "ocr_attempted": False,
                        "strategy": "xactimate_text_layout",
                        "strategy_log": strategy_log,
                    },
                )

        if items:
            strategy_log.append("generic:OK")
            return ExtractionPipelineResult(
                carrier=resolved_carrier,
                merged_pages=page_texts,
                items=items,
                metadata={
                    "ocr_attempted": False,
                    "strategy": "generic_parser",
                    "strategy_log": strategy_log,
                },
            )
        strategy_log.append("generic:FAIL")

        # Strategy 4: AI/LLM fallback for unknown formats
        try:
            ai_items, ai_meta = parse_with_ai(page_texts)
            if ai_items:
                if ai_meta.get("ai_carrier"):
                    resolved_carrier = (
                        ai_meta["ai_carrier"]
                        .lower()
                        .replace(" ", "_")
                    )
                strategy_log.append("ai:OK")
                return ExtractionPipelineResult(
                    carrier=resolved_carrier,
                    merged_pages=page_texts,
                    items=ai_items,
                    metadata={
                        "ocr_attempted": False,
                        "strategy": "ai_fallback",
                        "strategy_log": strategy_log,
                        **ai_meta,
                    },
                )
            reason = ai_meta.get("ai_error", "no_items")
            strategy_log.append(f"ai:FAIL({reason})")
        except Exception as e:
            strategy_log.append(f"ai:ERROR({e})")
            logger.warning("AI fallback parser failed: %s", e)

        logger.warning(
            "All extraction strategies exhausted: %s",
            " -> ".join(strategy_log),
        )
        return ExtractionPipelineResult(
            carrier=resolved_carrier,
            merged_pages=page_texts,
            items=[],
            metadata={
                "ocr_attempted": False,
                "strategy": "all_strategies_exhausted",
                "strategy_log": strategy_log,
            },
        )

    def _detect_carrier(self, pages_text: List[str]) -> str:
        joined = "\n".join(pages_text).lower()
        carriers = {
            "state farm": "state_farm",
            "allstate": "allstate",
            "farmers": "farmers",
            "liberty mutual": "liberty_mutual",
            "travelers": "travelers",
            "erie insurance": "erie",
        }
        for token, carrier_name in carriers.items():
            if token in joined:
                return carrier_name
        return "generic"
