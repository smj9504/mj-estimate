import re

from app.domains.insurance_extraction.parsers.base_parser import BaseInsuranceParser
from app.domains.insurance_extraction.parsers.generic_parser import GenericInsuranceParser


class TravelersInsuranceParser(GenericInsuranceParser):
    room_patterns = [
        *BaseInsuranceParser.room_patterns,
        re.compile(r"^\s*Job\s+location:\s*(.+)$", re.IGNORECASE),
        re.compile(r"^\s*Site:\s*(.+)$", re.IGNORECASE),
    ]
