import re
from abc import ABC, abstractmethod
from decimal import Decimal
from typing import List, Optional

from app.domains.insurance_extraction.interfaces import ParsedItemDTO
from app.domains.insurance_extraction.parsers.line_item_gating import (
    all_caps_room_candidate_is_plausible,
    line_looks_like_bogus_all_caps_room,
    line_looks_like_contact_or_header,
    line_looks_like_room_measurement_sketch_line,
    quantity_unit_pair_implausible,
    quantity_unit_price_implausible_duplicate_area,
    trim_leading_pages_before_estimate_body,
)


class BaseInsuranceParser(ABC):
    room_patterns = [
        re.compile(r"^\s*(room|area|location)\s*[:\-]\s*(.+)$", re.IGNORECASE),
        re.compile(r"^\s*([A-Z][A-Z0-9 \-/]{2,})\s*$"),
    ]
    amount_pattern = re.compile(r"\$?\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{1,2})?|[0-9]+(?:\.[0-9]{1,2})?)")
    quantity_pattern = re.compile(r"\b([0-9]+(?:\.[0-9]+)?)\b")
    # Allow thousands separators in qty (common in carrier PDF text extraction).
    measurement_pattern = re.compile(
        r"\b([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]+)?|[0-9]+(?:\.[0-9]+)?)\s*(LF|SF|EA|SY|CF|HR|DAY|MO)\b",
        re.IGNORECASE,
    )
    # O&P / overhead rows: percent + dollar amount, no SF/LF on the same text line
    # No trailing \\b: % is non-word; space before $ breaks \\b after %.
    _overhead_pct_pattern = re.compile(r"\b([0-9]+(?:\.[0-9]+)?)\s*%")
    _overhead_line_hint = re.compile(
        r"(?i)\b("
        r"overhead|contractor\s+overhead|general\s+contractor\s+overhead|"
        r"o\s*/?\s*&\s*/?\s*p|profit\s*(?:and|&)?\s*overhead"
        r")\b"
    )
    _explicit_note_line = re.compile(r"(?i)^\s*(?:note|notes)\s*[:\-]\s*\S+")
    _bullet_note_line = re.compile(r"^\s*\*\s+\S+")
    _xactimate_line_no = re.compile(r"^\s*\d{1,4}\.\s+[A-Za-z]")

    @abstractmethod
    def parse_pages(self, pages: List[str], carrier: Optional[str] = None) -> List[ParsedItemDTO]:
        raise NotImplementedError

    def parse_generic_pages(self, pages: List[str], carrier: Optional[str] = None) -> List[ParsedItemDTO]:
        pages = trim_leading_pages_before_estimate_body(pages, carrier)
        current_room = None
        extracted: List[ParsedItemDTO] = []
        for page_index, page_text in enumerate(pages, start=1):
            lines = [
                re.sub(r"\s+", " ", raw).strip()
                for raw in page_text.splitlines()
                if raw.strip()
            ]
            lead: List[str] = []
            i = 0
            while i < len(lines):
                line = lines[i]
                room = self._extract_room(line)
                if room:
                    current_room = room
                    lead = []
                    i += 1
                    continue

                if line_looks_like_contact_or_header(line):
                    lead = []
                    i += 1
                    continue

                if line_looks_like_room_measurement_sketch_line(line):
                    lead = []
                    i += 1
                    continue

                combined = (" ".join(lead) + " " + line).strip() if lead else line
                parsed_item = self._extract_line_item(combined)
                if parsed_item:
                    lead = []
                    parsed_item.room = current_room
                    parsed_item.source_page = page_index
                    parsed_item.raw_line = combined[:2000]
                    parsed_item.notes, i = self._collect_notes_and_continuation(parsed_item, lines, i + 1)
                    extracted.append(parsed_item)
                    continue

                if self._is_explicit_note_line(line) and extracted:
                    extracted[-1].notes = self._append_note_text(extracted[-1].notes, self._strip_note_line(line))
                    lead = []
                    i += 1
                    continue

                if self._is_description_lead_in(line):
                    lead.append(line)
                    if len(lead) > 10:
                        lead = lead[-10:]
                    i += 1
                    continue

                lead = []
                i += 1
        return extracted

    def _is_explicit_note_line(self, line: str) -> bool:
        if self._explicit_note_line.match(line):
            return True
        if self._bullet_note_line.match(line):
            return True
        return False

    def _strip_note_line(self, line: str) -> str:
        t = line.strip()
        t = re.sub(r"(?i)^\s*(?:note|notes)\s*[:\-]\s*", "", t).strip()
        t = re.sub(r"^\s*\*\s+", "", t).strip()
        return t

    def _append_note_text(self, existing: Optional[str], fragment: str) -> str:
        frag = fragment.strip()
        if not frag:
            return existing or ""
        if not existing:
            return frag
        return f"{existing}\n{frag}"

    def _is_description_lead_in(self, line: str) -> bool:
        s = line.strip()
        if len(s) < 4 or not re.search(r"[A-Za-z]", s):
            return False
        if line_looks_like_room_measurement_sketch_line(s):
            return False
        if self._is_explicit_note_line(s):
            return False
        if self._extract_line_item(s):
            return False
        return True

    def _is_description_continuation_after_item(self, line: str) -> bool:
        s = line.strip()
        if len(s) < 3 or not re.search(r"[A-Za-z]", s):
            return False
        if self._is_explicit_note_line(s):
            return False
        if self._extract_line_item(s):
            return False
        if self._xactimate_line_no.match(s):
            return False
        if re.match(
            r"^\s*[0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]+)?\s+(?:LF|SF|EA|SY|CF|HR|DAY|MO)\b",
            s,
            re.IGNORECASE,
        ):
            return False
        if line_looks_like_room_measurement_sketch_line(s):
            return False
        return True

    def _collect_notes_and_continuation(
        self, item: ParsedItemDTO, lines: List[str], start: int
    ) -> tuple[Optional[str], int]:
        idx = start
        note_parts: List[str] = []
        while idx < len(lines):
            nl = lines[idx]
            if self._extract_room(nl) or line_looks_like_contact_or_header(nl):
                break
            if line_looks_like_room_measurement_sketch_line(nl):
                break
            if self._extract_line_item(nl):
                break
            if self._is_explicit_note_line(nl):
                note_parts.append(self._strip_note_line(nl))
                idx += 1
                continue
            if self._is_description_continuation_after_item(nl):
                item.line_item = (item.line_item + " " + nl.strip()).strip()[:2000]
                idx += 1
                continue
            break
        notes = "\n".join(note_parts).strip() or None
        return notes, idx

    def _extract_room(self, line: str) -> Optional[str]:
        if line_looks_like_contact_or_header(line):
            return None
        for pattern in self.room_patterns:
            match = pattern.match(line)
            if not match:
                continue
            if match.lastindex and match.lastindex >= 2:
                return match.group(2).strip()
            candidate = match.group(1).strip()
            if len(candidate) > 2 and candidate.upper() == candidate:
                if line_looks_like_bogus_all_caps_room(line):
                    return None
                if not all_caps_room_candidate_is_plausible(candidate):
                    return None
                return candidate
        return None

    def _extract_line_item(self, line: str) -> Optional[ParsedItemDTO]:
        if len(line) < 8:
            return None
        if line_looks_like_contact_or_header(line):
            return None
        if line_looks_like_room_measurement_sketch_line(line):
            return None

        amounts = [self._safe_decimal(m.group(1)) for m in self.amount_pattern.finditer(line)]
        amounts = [a for a in amounts if a is not None]

        measure_match = self.measurement_pattern.search(line)
        quantity: Optional[Decimal] = None
        measurement: Optional[str] = None
        unit: Optional[str] = None

        if measure_match:
            quantity = self._safe_decimal(measure_match.group(1))
            measurement = measure_match.group(0).upper()
            unit = measure_match.group(2).upper()
            if quantity_unit_pair_implausible(quantity, unit):
                return None
        else:
            pct_m = self._overhead_pct_pattern.search(line)
            if not pct_m or not self._overhead_line_hint.search(line):
                # Scope rows use SF/LF/EA/…; bare numbers alone are PO boxes, zips, phones.
                return None
            if len(amounts) < 2:
                # Need both a percent value and a separate currency figure in the line text.
                return None
            quantity = self._safe_decimal(pct_m.group(1))
            measurement = f"{pct_m.group(1)}%"
            unit = "PCT"
            if quantity is None or quantity <= 0 or quantity > Decimal("100"):
                return None

        if measure_match:
            unit_price = self._unit_price_after_measurement(line, measure_match)
            # Prefer text before qty+unit; PDF column order is often qty+unit first, then description.
            pre = line[: measure_match.start()].strip()
            post = line[measure_match.end() :].strip()
            post_desc = self._description_after_measurement(post)
            if self._prefer_description_prefix(pre):
                line_item = pre
            elif post_desc:
                line_item = post_desc
            else:
                return None
            if self._is_obvious_non_description_fragment(line_item):
                return None
        else:
            unit_price = amounts[-1] if amounts else None
            line_item = line

        if unit_price is None:
            return None
        if unit_price <= 0 or unit_price > Decimal("999999"):
            return None
        if quantity_unit_price_implausible_duplicate_area(quantity, unit_price, unit):
            return None

        if measure_match:
            line_item = line_item.strip(" -:|")
        else:
            line_item = re.sub(self.amount_pattern, "", line_item)
            line_item = re.sub(self._overhead_pct_pattern, "", line_item)
            line_item = line_item.strip(" -:|")
        line_item = re.sub(r"\s+", " ", line_item).strip()
        if len(line_item) < 3:
            return None
        if line_looks_like_contact_or_header(line_item):
            return None

        confidence = Decimal("0.55")
        confidence += Decimal("0.20")
        confidence += Decimal("0.15")

        return ParsedItemDTO(
            line_item=line_item[:2000],
            unit_price=unit_price,
            quantity=quantity,
            measurement=measurement,
            unit=unit,
            confidence=min(confidence, Decimal("0.95")),
            token_offsets={},
            validation_flags=self._validate_item(line_item, quantity, unit_price),
        )

    _years_tail_pattern = re.compile(r"^\s*(yr|yrs|year)\b", re.IGNORECASE)
    _lifetime_noise_pattern = re.compile(
        r"\s*/\s*\d+\s*(?:yr|yrs|years)\b(?:\s*\([^)]*\))?",
        re.IGNORECASE,
    )
    _trailing_money_token = re.compile(
        r"\s+\$?\s*(?:[0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{1,2})?|[0-9]+(?:\.[0-9]{1,2})?)\s*$"
    )

    def _prefer_description_prefix(self, pre: str) -> bool:
        s = pre.strip()
        if len(s) < 3 or not re.search(r"[A-Za-z]", s):
            return False
        if re.fullmatch(r'[0-9.\s\-/#"\']+', s):
            return False
        return True

    def _is_obvious_non_description_fragment(self, text: str) -> bool:
        """Drop price-only tails with no letters (e.g. '3.27 *', '8.65'); keep any real description."""
        t = text.strip()
        if re.search(r"[A-Za-z]", t):
            return False
        if len(t) > 40:
            return False
        return bool(re.fullmatch(r"[\d\s$*.,/\-]+", t))

    def _description_after_measurement(self, post: str) -> str:
        if not post:
            return ""
        t = post.strip()
        t = self._lifetime_noise_pattern.sub("", t).strip()
        t = self._strip_trailing_monetary_tokens(t)
        return t.strip(" -:|/")

    def _strip_trailing_monetary_tokens(self, text: str) -> str:
        t = text.strip()
        for _ in range(12):
            n = self._trailing_money_token.sub("", t)
            if n == t:
                break
            t = n
        return t.strip()

    def _unit_price_after_measurement(self, line: str, measure_match: re.Match) -> Optional[Decimal]:
        """Money columns sit after qty+unit; do not use bare integers before 'yrs' as unit price."""
        tail_start = measure_match.end()
        after: List[tuple[re.Match, Decimal]] = []
        for m in self.amount_pattern.finditer(line):
            if m.start() < tail_start:
                continue
            d = self._safe_decimal(m.group(1))
            if d is not None and d > 0:
                after.append((m, d))
        after = self._drop_lifetime_year_amounts(line, after)
        if after:
            for m, d in after:
                if "$" in m.group(0):
                    return d
            return after[0][1]
        mspan = measure_match.span()
        fallback: List[Decimal] = []
        for m in self.amount_pattern.finditer(line):
            if self._spans_overlap(m.span(), mspan):
                continue
            d = self._safe_decimal(m.group(1))
            if d is not None and d > 0:
                fallback.append(d)
        return fallback[-1] if fallback else None

    def _drop_lifetime_year_amounts(
        self, line: str, pairs: List[tuple[re.Match, Decimal]]
    ) -> List[tuple[re.Match, Decimal]]:
        filtered: List[tuple[re.Match, Decimal]] = []
        for m, d in pairs:
            if d == int(d) and 1 <= int(d) <= 99:
                tail = line[m.end() : m.end() + 24]
                if self._years_tail_pattern.match(tail):
                    continue
            filtered.append((m, d))
        return filtered if filtered else pairs

    @staticmethod
    def _spans_overlap(a: tuple[int, int], b: tuple[int, int]) -> bool:
        return max(a[0], b[0]) < min(a[1], b[1])

    def _validate_item(
        self,
        line_item: str,
        quantity: Optional[Decimal],
        unit_price: Optional[Decimal],
    ) -> List[str]:
        flags: List[str] = []
        if not line_item:
            flags.append("line_item_missing")
        if quantity is None or quantity <= 0:
            flags.append("quantity_invalid")
        if unit_price is None or unit_price < 0:
            flags.append("unit_price_invalid")
        return flags

    def _safe_decimal(self, value: Optional[str]) -> Optional[Decimal]:
        if value is None:
            return None
        normalized = value.replace(",", "").replace("$", "").strip()
        try:
            return Decimal(normalized)
        except Exception:
            return None
