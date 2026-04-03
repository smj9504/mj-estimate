from typing import List, Optional

from app.domains.insurance_extraction.interfaces import ParsedItemDTO
from app.domains.insurance_extraction.parsers.base_parser import BaseInsuranceParser


class GenericInsuranceParser(BaseInsuranceParser):
    def parse_pages(self, pages: List[str], carrier: Optional[str] = None) -> List[ParsedItemDTO]:
        return self.parse_generic_pages(pages, carrier=carrier)
