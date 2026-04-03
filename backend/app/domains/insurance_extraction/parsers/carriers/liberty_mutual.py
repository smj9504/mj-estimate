import re

from app.domains.insurance_extraction.parsers.base_parser import BaseInsuranceParser
from app.domains.insurance_extraction.parsers.generic_parser import GenericInsuranceParser


class LibertyMutualInsuranceParser(GenericInsuranceParser):
    room_patterns = [
        *BaseInsuranceParser.room_patterns,
        re.compile(r"^\s*Structure:\s*(.+)$", re.IGNORECASE),
        re.compile(r"^\s*Unit\s*/\s*Suite:\s*(.+)$", re.IGNORECASE),
    ]
