"""Carrier-specific insurance estimate PDF parsers (plugin-style)."""

from app.domains.insurance_extraction.parsers.carriers.allstate import AllstateInsuranceParser
from app.domains.insurance_extraction.parsers.carriers.erie import ErieInsuranceParser
from app.domains.insurance_extraction.parsers.carriers.farmers import FarmersInsuranceParser
from app.domains.insurance_extraction.parsers.carriers.liberty_mutual import LibertyMutualInsuranceParser
from app.domains.insurance_extraction.parsers.carriers.state_farm import StateFarmInsuranceParser
from app.domains.insurance_extraction.parsers.carriers.travelers import TravelersInsuranceParser

__all__ = [
    "AllstateInsuranceParser",
    "ErieInsuranceParser",
    "FarmersInsuranceParser",
    "LibertyMutualInsuranceParser",
    "StateFarmInsuranceParser",
    "TravelersInsuranceParser",
]
