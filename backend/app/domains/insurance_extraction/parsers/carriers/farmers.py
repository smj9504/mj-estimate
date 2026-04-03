import re

from app.domains.insurance_extraction.parsers.base_parser import BaseInsuranceParser
from app.domains.insurance_extraction.parsers.generic_parser import GenericInsuranceParser


class FarmersInsuranceParser(GenericInsuranceParser):
    room_patterns = [
        *BaseInsuranceParser.room_patterns,
        re.compile(r"^\s*Building\s+section:\s*(.+)$", re.IGNORECASE),
        re.compile(r"^\s*Division:\s*(.+)$", re.IGNORECASE),
    ]
