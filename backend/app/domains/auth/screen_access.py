"""
Which sidebar screens a staff member may open.

Each role has a default set of screens (role_screen_access). A staff member
can have their own list (staff.screen_access) that replaces the role's set.
Admins always see every screen so they can never lock themselves out.

This decides what the frontend shows; the API routes behind the screens are
not checked against it yet, except where a route asks for require_screen.

water_mitigation_view opens the Water Mitigation pages with less on them
(job details, photos, documents, trash; no AI photo tools, no invoice
editing). Someone who has water_mitigation as well gets the full pages.
"""
from typing import Dict, Iterable, List, Optional

from app.domains.staff.models import RoleScreenAccess, Staff, StaffRole

# Keep in sync with SCREEN_GROUPS in frontend/src/constants/screens.ts
SCREEN_KEYS: tuple = (
    # Jobs & Claims
    "onsite_signing",
    "claims_lifecycle",
    "claim_followup",
    "water_mitigation",
    "water_mitigation_view",
    "rebuild_projects",
    "work_orders",
    "clients",
    "supplements",
    # Estimates
    "pack_calculator",
    "cabinet_estimates",
    "bathroom_estimates",
    "roofing_estimates",
    "siding_estimates",
    "material_prices",
    "pricing_settings",
    # Documents
    "estimates",
    "invoices",
    "material_orders",
    "plumber_reports",
    "electrician_reports",
    "contract_templates",
    "repair_templates",
    "repair_estimate",
    # Tools & Data
    "line_items",
    "insurance_extractions",
    "material_detection",
    "debris_calculator",
    "cheat_sheet",
    "wm_templates",
    "wm_scope_items",
    "photo_metadata",
    "room_dimensions",
    "pdf_editor",
    "email_ingestion",
)

ALL_SCREENS_ROLES = (StaffRole.admin, StaffRole.super_admin)

# The todo board is open to everyone, so it isn't a screen to grant
HOME_TODOS = "todos"


def _session(db):
    return db._session if hasattr(db, "_session") else db


def validate_screen_keys(screens: Iterable[str]) -> List[str]:
    """Return the keys in catalog order; raise ValueError on an unknown key."""
    wanted = set(screens)
    unknown = wanted - set(SCREEN_KEYS)
    if unknown:
        raise ValueError(f"Unknown screen keys: {', '.join(sorted(unknown))}")
    return [key for key in SCREEN_KEYS if key in wanted]


def validate_home_screen(value: Optional[str]) -> Optional[str]:
    """What "/" may open: the todo board or any screen. None keeps the todo board."""
    if value is None or value == HOME_TODOS or value in SCREEN_KEYS:
        return value
    raise ValueError(f"Unknown home screen: {value}")


def _role_value(role) -> str:
    return role.value if isinstance(role, StaffRole) else str(role)


def role_defaults(db) -> Dict[str, List[str]]:
    """Default screens for every role, filling in roles with no row."""
    rows = {
        row.role: row.screens
        for row in _session(db).query(RoleScreenAccess).all()
    }
    result = {}
    for role in StaffRole:
        if role in ALL_SCREENS_ROLES or role.value not in rows:
            result[role.value] = list(SCREEN_KEYS)
        else:
            result[role.value] = [k for k in SCREEN_KEYS if k in set(rows[role.value] or [])]
    return result


def set_role_defaults(db, role: StaffRole, screens: List[str]) -> List[str]:
    screens = validate_screen_keys(screens)
    session = _session(db)
    row = session.get(RoleScreenAccess, role.value)
    if row is None:
        row = RoleScreenAccess(role=role.value, screens=screens)
        session.add(row)
    else:
        row.screens = screens
    session.commit()
    return screens


def effective_screens(db, staff: Staff) -> List[str]:
    """The screens this staff member may open right now."""
    if staff.role in ALL_SCREENS_ROLES:
        return list(SCREEN_KEYS)

    own: Optional[list] = getattr(staff, "screen_access", None)
    if own is not None:
        allowed = set(own)
    else:
        row = _session(db).get(RoleScreenAccess, _role_value(staff.role))
        if row is None:
            return list(SCREEN_KEYS)
        allowed = set(row.screens or [])
    return [key for key in SCREEN_KEYS if key in allowed]


def may_open(db, staff: Staff, key: str) -> bool:
    return key in effective_screens(db, staff)
