from typing import Any, Dict, List, Optional


class InsuranceExtractionMapper:
    def to_create_payload(
        self,
        file_id: str,
        carrier: str,
        merged_pages: List[str],
        item_count: int,
        ocr_attempted: bool,
        pipeline_metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        raw_text = "\n\n".join(merged_pages)
        strategy = (pipeline_metadata or {}).get("strategy", "text_then_ocr_fallback")
        meta: Dict[str, Any] = {
            "pipeline": strategy,
            "ocr_attempted": ocr_attempted,
            "parsed_item_count": item_count,
        }
        if pipeline_metadata:
            for key, val in pipeline_metadata.items():
                if val is not None and key != "strategy":
                    meta[key] = val
        return {
            "file_id": file_id,
            "carrier": carrier,
            "status": "completed",
            "pages": len(merged_pages),
            "raw_text_excerpt": raw_text[:2000],
            "raw_text": raw_text[:100000],
            "parser_metadata": meta,
        }
