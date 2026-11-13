"""
Our words for the price list's lines (owner, 2026-11-13): a rebuild
estimate doesn't print Xactimate's descriptions as they are.

Each line is worded, by its code and the activity it is added as, from:
  1. the company's own wording, saved from a line the estimator reworded
     (rebuild_wordings; one saved with no company is everyone's), else
  2. the wording below, written for the repairs most estimates need, else
  3. nothing: the line comes in in Xactimate's words, marked, for the
     estimator to write it our way (and save that wording for next time).

{S} is the surface the line is on: Walls, Ceiling, Floor.
"""

from typing import Any, Dict, Optional, Tuple

SURFACES = {"wall": "Walls", "ceiling": "Ceiling", "floor": "Floor", "other": "Surfaces"}

# The same words for any line that has a name: what each activity does to it
_ACTION = {
    "&": "remove & replace", "+": "install", "-": "remove", "R": "detach & reset",
    "M": "material only", "I": "labor only",
}


def _drywall(size: str) -> Dict[str, str]:
    return {
        "name": f'Drywall {size}',
        "&": f'Drywall {size} - tear out, hang new, tape & finish',
        "+": f'Drywall {size} - hang, tape & finish',
        "-": f'Drywall {size} - tear out',
    }


def _insulation(rating: str, faced: str, wall: str) -> Dict[str, str]:
    return {"name": f"Insulation {rating} {faced} batt ({wall} wall)"}


OURS: Dict[str, Dict[str, str]] = {
    # Drywall
    "DRY1/2": _drywall('1/2"'),
    "DRY5/8": _drywall('5/8"'),
    "DRY1/2-": {
        "name": 'Drywall 1/2" for texture',
        "&": 'Drywall 1/2" - tear out, hang new & tape for texture',
        "+": 'Drywall 1/2" - hang & tape for texture',
    },
    "DRY1/2H": {
        "name": 'Drywall 1/2", hung only',
        "&": 'Drywall 1/2" - tear out & hang new (no taping)',
        "+": 'Drywall 1/2" - hang only (no taping)',
    },
    "DRYTEX-": {"+": "Drywall texture - machine sprayed"},
    "DRYTEX": {"+": "Drywall texture - light, by hand"},
    "DRYTEX+": {"+": "Drywall texture - heavy, by hand"},
    "DRYTEXMK": {"+": "Drywall texture - knockdown"},
    "DRYTEX++": {"+": "Drywall skim coat - smooth finish"},
    # Insulation
    "INSBT4": _insulation("R-11", "unfaced", "2x4"),
    "INSBT4+": _insulation("R-13", "unfaced", "2x4"),
    "INSBTF4": _insulation("R-11", "faced", "2x4"),
    "INSBTF4+": _insulation("R-13", "faced", "2x4"),
    "INSBTF4++": _insulation("R-15", "faced", "2x4"),
    "INSBT6": _insulation("R-19", "unfaced", "2x6"),
    "INSBT6+": _insulation("R-21", "unfaced", "2x6"),
    # Paint
    "PNTSP": {"name": "{S} - seal/prime & paint", "+": "{S} - seal/prime & paint, 1 coat each"},
    "PNTSP2": {"name": "{S} - seal/prime & paint", "+": "{S} - seal/prime 1 coat, paint 2 coats"},
    "PNTSP+": {"name": "{S} - seal/prime & paint", "+": "{S} - seal/prime & paint, 1 coat each, two colors"},
    "PNTP": {"name": "{S} - paint", "+": "{S} - paint, 1 coat"},
    "PNTP2": {"name": "{S} - paint", "+": "{S} - paint, 2 coats"},
    "PNTS": {"+": "{S} - stain-blocking seal, 1 coat"},
    "PNTB": {"+": "Baseboard - paint, 1 coat"},
    "PNTB2": {"+": "Baseboard - paint, 2 coats"},
    "PNTC": {"+": "Door casing - paint, 1 coat"},
    "PNTTRIM1": {"+": "Trim - paint, 1 coat"},
    "PNTMASKLF": {"+": "Masking & paint prep - plastic, paper & tape"},
    "PNTMASKLFP": {"+": "Masking & paint prep - paper & tape"},
    "PNTMASKFL": {"+": "Floor protection - adhesive film"},
    # Cleaning, wet work
    "CLNFINALR": {"+": "Final construction clean-up"},
    "CLNSTD": {"+": "Stud wall - clean"},
    "WTRDRYW": {"-": "Wet drywall - tear out, bag & clean up"},
    "WTRGRM": {"+": "{S} - anti-microbial treatment"},
}


def built_in(code: str, activity: str) -> Optional[str]:
    entry = OURS.get(code)
    if not entry:
        return None
    if entry.get(activity):
        return entry[activity]
    name = entry.get("name")
    if name:
        return f"{name} - {_ACTION[activity]}"
    plus = entry.get("+")
    if plus and activity in ("M", "I"):
        return f"{plus} - {_ACTION[activity]}"
    return None


def saved_wordings(session: Any, company_id: Optional[str]) -> Dict[Tuple[str, str], str]:
    """(code, activity) -> words: everyone's, with the company's over them"""
    from .models import RebuildWording

    query = session.query(RebuildWording)
    rows = query.filter(RebuildWording.company_id.is_(None)).all()
    if company_id:
        rows += query.filter(RebuildWording.company_id == str(company_id)).all()
    return {(r.item_code, r.activity): r.text for r in rows}


def wording_for(code: str, activity: str, saved: Dict[Tuple[str, str], str]) -> Optional[str]:
    return saved.get((code, activity)) or built_in(code, activity)


def worded_codes(saved: Dict[Tuple[str, str], str]):
    return set(OURS) | {code for code, _ in saved}


def save_wording(session: Any, company_id: Optional[str], code: str, activity: str, text: str,
                 staff_id: Optional[str] = None) -> None:
    from .models import RebuildWording

    query = session.query(RebuildWording).filter(
        RebuildWording.item_code == code, RebuildWording.activity == activity,
    )
    query = query.filter(RebuildWording.company_id == str(company_id)) if company_id else query.filter(
        RebuildWording.company_id.is_(None))
    row = query.first()
    if row is None:
        session.add(RebuildWording(company_id=str(company_id) if company_id else None, item_code=code,
                                   activity=activity, text=text, updated_by_id=staff_id))
    else:
        row.text = text
        row.updated_by_id = staff_id
    session.flush()
