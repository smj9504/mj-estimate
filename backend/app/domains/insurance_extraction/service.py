import logging
import os
import re
import tempfile
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from uuid import UUID

from sqlalchemy.orm import Session

from app.core.config import settings
from app.domains.file.models import File
from app.domains.file.service import get_storage_provider
from app.domains.insurance_extraction.repository import InsuranceExtractionRepository
from app.domains.storage.local_provider import LocalStorageProvider

logger = logging.getLogger(__name__)


class InsuranceExtractionService:
    def __init__(self, db: Session):
        self.db = db
        self.repository = InsuranceExtractionRepository(db)

        from app.domains.insurance_extraction.extractors.ocr_fallback_extractor import OcrFallbackExtractor
        from app.domains.insurance_extraction.extractors.pdf_text_extractor import PdfTextExtractor
        from app.domains.insurance_extraction.mappers.extraction_mapper import InsuranceExtractionMapper
        from app.domains.insurance_extraction.normalizers.item_normalizer import InsuranceItemNormalizer
        from app.domains.insurance_extraction.orchestrator.pipeline import InsuranceExtractionOrchestrator
        from app.domains.insurance_extraction.parsers.resolver import InsuranceParserResolver

        self.orchestrator = InsuranceExtractionOrchestrator(
            text_extractor=PdfTextExtractor(),
            ocr_extractor=OcrFallbackExtractor(),
            parser_resolver=InsuranceParserResolver(),
        )
        self.normalizer = InsuranceItemNormalizer()
        self.mapper = InsuranceExtractionMapper()

    def _resolve_pdf_path(self, stored_url: str) -> Tuple[str, Optional[str]]:
        """
        Return (absolute_path_for_pdf_reader, temp_path_to_delete_or_none).

        Local storage persists URLs relative to the storage base_dir (e.g.
        insurance_extraction/context/file.pdf), not CWD — PdfReader must get an
        absolute path under that base.
        """
        if not stored_url or not str(stored_url).strip():
            raise ValueError("File has no storage URL")

        url = str(stored_url).strip()
        if url.startswith(("http://", "https://", "gs://")):
            storage = get_storage_provider()
            data = storage.download(url)
            fd, tmp_path = tempfile.mkstemp(suffix=".pdf")
            try:
                with os.fdopen(fd, "wb") as tmp_f:
                    tmp_f.write(data)
            except Exception:
                try:
                    os.close(fd)
                except OSError:
                    pass
                if os.path.isfile(tmp_path):
                    try:
                        os.unlink(tmp_path)
                    except OSError:
                        pass
                raise
            return tmp_path, tmp_path

        rel = Path(url.replace("\\", "/"))
        storage = get_storage_provider()

        if isinstance(storage, LocalStorageProvider):
            candidate = (storage.base_dir / rel).resolve()
            if candidate.is_file():
                return str(candidate), None
            logger.warning(
                "PDF not found under storage base_dir=%s rel=%s resolved=%s",
                storage.base_dir,
                rel,
                candidate,
            )

        fallback = (settings.UPLOAD_DIR / rel).resolve()
        if fallback.is_file():
            return str(fallback), None

        raise FileNotFoundError(
            f"PDF file not on disk for stored url={url!r}. "
            f"Tried storage base {getattr(storage, 'base_dir', None)!r} and {settings.UPLOAD_DIR!r}."
        )

    def extract_from_file_id(self, file_id: str):
        file_row = self.db.query(File).filter(File.id == file_id, File.is_active == True).first()
        if not file_row:
            raise ValueError("File not found")
        if "pdf" not in (file_row.content_type or "").lower() and not file_row.original_name.lower().endswith(".pdf"):
            raise ValueError("Only PDF files are supported")

        tmp_path: Optional[str] = None
        try:
            pdf_path, tmp_path = self._resolve_pdf_path(file_row.url)
            pipeline_result = self.orchestrator.run(pdf_path)
        finally:
            if tmp_path and os.path.isfile(tmp_path):
                try:
                    os.unlink(tmp_path)
                except OSError:
                    pass

        mapped_items = self.normalizer.normalize(pipeline_result.items)
        pipeline_meta = dict(pipeline_result.metadata or {})
        # Use pre-built hierarchy from reference parser if available;
        # otherwise fall back to building it from flat items.
        if "hierarchy" in pipeline_meta and pipeline_meta["hierarchy"].get("levels"):
            logger.info("Using pre-built hierarchy from reference parser")
        else:
            pipeline_meta["hierarchy"] = self._build_hierarchy(mapped_items)
        extraction_payload = self.mapper.to_create_payload(
            file_id=file_id,
            carrier=pipeline_result.carrier,
            merged_pages=pipeline_result.merged_pages,
            item_count=len(mapped_items),
            ocr_attempted=bool(pipeline_result.metadata.get("ocr_attempted")),
            pipeline_metadata=pipeline_meta,
        )
        extraction = self.repository.create_extraction(extraction_payload)
        self.repository.bulk_create_items(extraction.id, mapped_items)
        return self.repository.get_extraction(extraction.id)

    _LEVEL_MARKERS = re.compile(
        r"^(Main Level|First Floor|1st Floor|Second Floor|2nd Floor|Third Floor|3rd Floor|"
        r"Basement|Lower Level|Upper Level|Attic|Garage|Exterior|Level\s*\d+)$",
        re.IGNORECASE,
    )
    _APPENDIX_MARKERS = re.compile(
        r"^(Debris Removal|Miscellaneous|Labor Minimums Applied|General|General Conditions|Solar Panels|Water Mitigation)$",
        re.IGNORECASE,
    )
    _SECTION_LABEL_BASE = re.compile(
        r"^(WALLS?|CEILING|PAINTING|LIGHT FIXTURES|ELECTRICAL|PLUMBING|"
        r"FLOOR COVERING - CARPET|FLOOR COVERING - WOOD|FINISH CARPENTRY / TRIMWORK|"
        r"CABINETRY|CLEANING|CONTENT MANIPULATION|GENERAL DEMOLITION|FINISH HARDWARE)$",
        re.IGNORECASE,
    )
    _SECTION_CODE_PREFIX = re.compile(r"^[A-Z]{2,4}\s+")

    def _clean_room_name(self, room: Optional[str]) -> Optional[str]:
        if not room:
            return None
        r = re.sub(r"\s+", " ", str(room)).strip()
        r = re.sub(r"(?i)^room\s*:\s*", "", r).strip()
        # strip blueprint dimension garbage prefix: 8' 6"2' 5" Basement -> Basement
        r = re.sub(r"^[\d'\"\s.]+", "", r).strip() or r
        return r

    def _normalize_section_name(self, room: str) -> str:
        r = room.strip()
        r = self._SECTION_CODE_PREFIX.sub("", r).strip()
        r = re.sub(r"\s+", " ", r)
        return r

    def _is_section_like_room(self, room: str, has_room_measurements: bool = False) -> bool:
        r = room.strip()
        if has_room_measurements:
            return False
        rn = self._normalize_section_name(r)
        if self._SECTION_LABEL_BASE.match(rn):
            return True
        if self._APPENDIX_MARKERS.match(r):
            return True
        # xactimate_parser.py room-subsection labels: CEILING, WALLS, LIGHT FIXTURES ...
        if (
            r.upper() == r
            and 1 <= len(r.split()) <= 4
            and not any(ch.isdigit() for ch in r)
            and r not in {"KITCHEN", "BATHROOM", "BASEMENT", "GARAGE", "ATTIC", "HALLWAY"}
        ):
            return True
        if " - " in r and r.upper() == r:
            return True
        if "/" in r and r.upper() == r:
            return True
        if r.upper() in {"FLOOR COVERING", "GENERAL", "DEBRIS REMOVAL", "GENERAL CONDITIONS"}:
            return True
        return False

    def _build_hierarchy(self, mapped_items: List[Dict[str, Any]]) -> Dict[str, Any]:
        levels: Dict[str, Dict[str, Any]] = {}
        sections: Dict[str, Dict[str, Any]] = {}
        unassigned: List[int] = []
        current_level = "Main Level"

        def ensure_level(name: str) -> Dict[str, Any]:
            key = name.strip()
            if key not in levels:
                levels[key] = {"name": key, "rooms": {}}
            return levels[key]

        ensure_level(current_level)

        for item in mapped_items:
            idx = int(item.get("sort_order", 0))
            room_raw = self._clean_room_name(item.get("room"))
            token = item.get("token_offsets") or {}
            xact = (token.get("xactimate") or {}) if isinstance(token, dict) else {}
            room_meta = (xact.get("room_measurements") or {}) if isinstance(xact, dict) else {}
            item_text = str(item.get("line_item") or "").strip()

            if room_raw and self._LEVEL_MARKERS.match(room_raw):
                current_level = room_raw
                ensure_level(current_level)
                continue

            if room_raw and self._is_section_like_room(
                room_raw, has_room_measurements=bool(room_meta)
            ):
                sec_name = self._normalize_section_name(room_raw)
                sec = sections.setdefault(
                    sec_name,
                    {"name": sec_name, "item_indices": [], "kind": "section", "totals": {}},
                )
                sec["item_indices"].append(idx)
                continue

            # fallback: promote known appendix-like line items into sections when room missing
            if not room_raw and self._APPENDIX_MARKERS.match(item_text):
                sec = sections.setdefault(
                    item_text,
                    {"name": item_text, "item_indices": [], "kind": "appendix", "totals": {}},
                )
                sec["item_indices"].append(idx)
                continue

            if room_raw:
                lv = ensure_level(current_level)
                room_entry = lv["rooms"].setdefault(
                    room_raw,
                    {
                        "name": room_raw,
                        "item_indices": [],
                        "dimensions": {},
                        "height_ft": None,
                    },
                )
                room_entry["item_indices"].append(idx)
                if isinstance(room_meta, dict):
                    dims = room_meta.get("dimensions") or {}
                    if isinstance(dims, dict):
                        merged_dims = dict(room_entry.get("dimensions") or {})
                        for k, v in dims.items():
                            try:
                                merged_dims[k] = float(v)
                            except Exception:
                                continue
                        room_entry["dimensions"] = merged_dims
                    if room_meta.get("height_ft") is not None and room_entry.get("height_ft") is None:
                        try:
                            room_entry["height_ft"] = float(room_meta["height_ft"])
                        except Exception:
                            pass
                continue

            unassigned.append(idx)

        levels_out: List[Dict[str, Any]] = []
        for lv in levels.values():
            rooms_out = []
            for rm in lv["rooms"].values():
                rooms_out.append(rm)
            levels_out.append({"name": lv["name"], "rooms": rooms_out})

        sections_out = list(sections.values())
        return {
            "levels": levels_out,
            "sections": sections_out,
            "unassigned_item_indices": unassigned,
        }

    def get_extraction(self, extraction_id: UUID):
        return self.repository.get_extraction(extraction_id)

    def list_extractions(self, limit: int = 50):
        return self.repository.list_extractions(limit=limit)

    def update_extraction(self, extraction_id: UUID, payload: Dict[str, Any]):
        extraction = self.repository.get_extraction(extraction_id)
        if not extraction:
            raise ValueError("Extraction not found")

        for field in ["carrier", "status", "raw_text_excerpt", "parser_metadata"]:
            if field in payload and payload[field] is not None:
                setattr(extraction, field, payload[field])

        items_payload = payload.get("items", [])
        if items_payload:
            self.repository.replace_items(extraction.id, items_payload)
        self.db.flush()
        return self.repository.get_extraction(extraction.id)

    def delete_extraction(self, extraction_id: UUID) -> None:
        extraction = self.repository.get_extraction(extraction_id)
        if not extraction:
            raise ValueError("Extraction not found")
        self.repository.delete_extraction(extraction)

    def bulk_delete_extractions(self, ids: List[UUID]) -> None:
        self.repository.bulk_delete_extractions(ids)

    def get_analysis(self, extraction_id: UUID) -> Dict[str, Any]:
        """Return surface-category analysis for all rooms in this extraction."""
        from app.domains.insurance_extraction.analyzer import analyze_extraction

        extraction = self.repository.get_extraction(extraction_id)
        if not extraction:
            raise ValueError("Extraction not found")

        hierarchy = (extraction.parser_metadata or {}).get("hierarchy")
        # Items must be sorted by sort_order to match index-based hierarchy
        sorted_items = sorted(extraction.items, key=lambda it: it.sort_order)
        result = analyze_extraction(sorted_items, hierarchy)
        result["extraction_id"] = str(extraction.id)
        return result

    def to_estimate_items(self, extraction_id: UUID) -> List[Dict[str, Any]]:
        extraction = self.repository.get_extraction(extraction_id)
        if not extraction:
            raise ValueError("Extraction not found")
        items = []
        for item in extraction.items:
            if not item.line_item:
                continue
            name = item.line_item
            if item.notes:
                name = f"{name}\n— {item.notes}"
            items.append(
                {
                    "room": item.room,
                    "name": name,
                    "quantity": float(item.quantity or 1),
                    "unit": item.unit or "EA",
                    "rate": float(item.unit_price or 0),
                    "raw_line": item.raw_line,
                    "source_page": item.source_page,
                    "confidence": float(item.confidence or 0),
                }
            )
        return items

