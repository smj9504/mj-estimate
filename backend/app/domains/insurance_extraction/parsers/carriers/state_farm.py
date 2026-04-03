import re

from app.domains.insurance_extraction.parsers.base_parser import BaseInsuranceParser
from app.domains.insurance_extraction.parsers.generic_parser import GenericInsuranceParser


class StateFarmInsuranceParser(GenericInsuranceParser):
    """State Farm–style layouts: extra room / location headers common on claim estimates."""

    room_patterns = [
        *BaseInsuranceParser.room_patterns,
        re.compile(r"^\s*Location:\s*(.+)$", re.IGNORECASE),
        re.compile(r"^\s*Premises:\s*(.+)$", re.IGNORECASE),
        re.compile(r"^\s*Property\s+location:\s*(.+)$", re.IGNORECASE),
        re.compile(r"^\s*Room\s*#\s*\d+\s*[-–]\s*(.+)$", re.IGNORECASE),
    ]
