from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any, Dict, List, Optional, Protocol


@dataclass
class ParsedItemDTO:
    line_item: str
    room: Optional[str] = None
    notes: Optional[str] = None
    unit_price: Optional[Decimal] = None
    quantity: Optional[Decimal] = None
    measurement: Optional[str] = None
    unit: Optional[str] = None
    source_page: Optional[int] = None
    confidence: Optional[Decimal] = None
    raw_line: Optional[str] = None
    token_offsets: Dict[str, Any] = field(default_factory=dict)
    validation_flags: List[str] = field(default_factory=list)
    # Xactimate / column-layout extras (also copied into token_offsets["xactimate"] for storage)
    item_number: Optional[int] = None
    tax: Optional[Decimal] = None
    op: Optional[Decimal] = None
    rcv: Optional[Decimal] = None
    depreciation: Optional[Decimal] = None
    acv: Optional[Decimal] = None
    is_op_item: Optional[bool] = None


@dataclass
class ExtractionPipelineResult:
    carrier: str
    merged_pages: List[str]
    items: List[ParsedItemDTO]
    metadata: Dict[str, Any]


class TextExtractor(Protocol):
    def extract_pages(self, file_path: str) -> List[str]:
        ...


class OcrExtractor(Protocol):
    def extract_missing_pages(self, file_path: str, pages_text: List[str]) -> List[str]:
        ...


class InsuranceParser(Protocol):
    def parse_pages(self, pages: List[str], carrier: Optional[str] = None) -> List[ParsedItemDTO]:
        ...


class ParserResolver(Protocol):
    def resolve(self, carrier: Optional[str]) -> InsuranceParser:
        ...
