from typing import Dict, Optional

from app.domains.insurance_extraction.interfaces import InsuranceParser
from app.domains.insurance_extraction.parsers.carriers import (
    AllstateInsuranceParser,
    FarmersInsuranceParser,
    LibertyMutualInsuranceParser,
    StateFarmInsuranceParser,
    TravelersInsuranceParser,
)
from app.domains.insurance_extraction.parsers.generic_parser import GenericInsuranceParser


class InsuranceParserResolver:
    """Resolve parser implementation by detected carrier id (pipeline `carrier` string)."""

    def __init__(self):
        generic: InsuranceParser = GenericInsuranceParser()
        self._parsers: Dict[str, InsuranceParser] = {
            "generic": generic,
            "state_farm": StateFarmInsuranceParser(),
            "allstate": AllstateInsuranceParser(),
            "farmers": FarmersInsuranceParser(),
            "liberty_mutual": LibertyMutualInsuranceParser(),
            "travelers": TravelersInsuranceParser(),
        }

    def resolve(self, carrier: Optional[str]) -> InsuranceParser:
        if not carrier:
            return self._parsers["generic"]
        return self._parsers.get(carrier, self._parsers["generic"])
