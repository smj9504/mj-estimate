"""
Several bathrooms on one job, and the costs they share.

Each bathroom is its own estimate group (its restoration and options). The
job's bathrooms are the groups on the same claim, or with no claim at the
same address for the same company, that have been priced. A dumpster,
permit, trip (mobilization) and lead RRP setup serve the whole job, so one
bathroom carries them: the oldest priced one. Its dumpster is sized for
every bathroom's debris; the others leave those lines off and name the
estimate that has them (owner, 2026-11-19).

calculator.calculate_estimate takes a JobShare; with one bathroom there is
none and it prices exactly as before. The service keeps the bathrooms in
step: when one is priced or deleted, the others' job lines are replaced
(JOB_LINE_PREFIXES), never their other lines, which may be edited by hand.
"""

from dataclasses import dataclass, field
from typing import Any, Dict, List

# A bathroom by its designation
BATH_NAMES = {
    "master": "Master Bathroom",
    "hall": "Hall Bathroom",
    "powder": "Powder Room",
    "three_quarter": "Bathroom",
    "jack_jill": "Jack & Jill Bathroom",
}

def _typed(designation) -> str:
    """A bathroom's type as stored: a listed one's key, or a name typed in"""
    return " ".join(str(designation or "").split())


def bathroom_name(designation) -> str:
    """A bathroom's name: a listed type's ("Master Bathroom"), a name typed in
    as typed ("Basement bath"), or "Bathroom" without either"""
    typed = _typed(designation)
    return BATH_NAMES.get(typed) or typed or "Bathroom"


def bathroom_type_label(designation) -> str:
    """Its type for a description line: a listed type title-cased ("Master",
    "Three Quarter"), a name typed in as typed; empty without either"""
    typed = _typed(designation)
    return typed.replace("_", " ").title() if typed in BATH_NAMES else typed


# The lines a bathroom's place in the job decides (calculator descriptions)
JOB_LINE_PREFIXES = (
    "Dumpster rental (",
    "Debris disposal (",
    "Mobilization / setup",
    "Lead paint RRP compliance",
    "Building permit (required)",
    "Permit allowance (verify required)",
)
_ELSEWHERE = " - on the "


def elsewhere_line(parts: List[str], carrier_name: str) -> str:
    """The line a bathroom shows for the job costs another one carries"""
    return f"{', '.join(parts)}{_ELSEWHERE}{carrier_name} estimate"


def is_elsewhere_line(description: str) -> bool:
    """The $0 line naming the bathroom that carries the job costs"""
    d = description or ""
    return _ELSEWHERE in d and d.endswith(" estimate")


def is_job_line(description: str) -> bool:
    d = description or ""
    return d.startswith(JOB_LINE_PREFIXES) or is_elsewhere_line(d)


@dataclass
class JobShare:
    """One bathroom's place among the job's bathrooms"""

    # This bathroom has the job's dumpster, permit, trip and lead RRP
    carries: bool
    carrier_name: str
    bathrooms: int
    # The other bathrooms: name, debris_cy, rough_change, permit, mobilization, lead_rrp
    others: List[Dict[str, Any]] = field(default_factory=list)

    @property
    def other_debris_cy(self) -> float:
        return sum(float(o.get("debris_cy") or 0) for o in self.others)

    def any_other(self, flag: str) -> bool:
        return any(o.get(flag) for o in self.others)

    def debris_note(self, own_cy: float) -> str:
        parts = [f"this bathroom {own_cy:.1f} CY"] + [
            f"{o['name']} {float(o.get('debris_cy') or 0):.1f} CY" for o in self.others
        ]
        return f"One dumpster for the whole job ({self.bathrooms} bathrooms): " + " + ".join(parts)

    @property
    def whole_job(self) -> str:
        return f"Whole job ({self.bathrooms} bathrooms)"
