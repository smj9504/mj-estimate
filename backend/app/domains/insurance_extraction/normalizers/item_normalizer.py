from typing import List

from app.domains.insurance_extraction.interfaces import ParsedItemDTO


class InsuranceItemNormalizer:
    def normalize(self, parsed_items: List[ParsedItemDTO]) -> List[dict]:
        normalized = []
        for idx, item in enumerate(parsed_items):
            quantity = item.quantity
            unit_price = item.unit_price
            flags = list(item.validation_flags or [])
            if quantity is not None and unit_price is not None and quantity > 0 and unit_price >= 0:
                if quantity * unit_price > 1000000:
                    flags.append("line_total_outlier")
            normalized.append(
                {
                    "room": item.room,
                    "line_item": item.line_item,
                    "notes": item.notes,
                    "unit_price": unit_price,
                    "quantity": quantity,
                    "measurement": item.measurement,
                    "unit": item.unit,
                    "source_page": item.source_page,
                    "confidence": item.confidence,
                    "raw_line": item.raw_line,
                    "token_offsets": item.token_offsets or {},
                    "validation_flags": flags,
                    "sort_order": idx,
                }
            )
        return normalized
