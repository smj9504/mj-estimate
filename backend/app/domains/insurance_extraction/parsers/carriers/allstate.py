import re

from app.domains.insurance_extraction.parsers.base_parser import BaseInsuranceParser
from app.domains.insurance_extraction.parsers.generic_parser import GenericInsuranceParser


class AllstateInsuranceParser(GenericInsuranceParser):
    room_patterns = [
        *BaseInsuranceParser.room_patterns,
        re.compile(r"^\s*Area\s*:\s*(.+)$", re.IGNORECASE),
        re.compile(r"^\s*Scope\s*:\s*(.+)$", re.IGNORECASE),
    ]
