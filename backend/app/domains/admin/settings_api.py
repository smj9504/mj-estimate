"""
Admin system settings API endpoints.
"""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database_factory import get_db_session as get_db
from app.domains.auth.dependencies import require_admin
from app.domains.staff.models import Staff
from app.domains.admin.schemas import RoutePersonalAccountsSetting
from app.domains.admin.settings_service import (
    ROUTE_PERSONAL_ACCOUNTS_THROUGH_FALLBACK_KEY,
    get_bool_setting,
    set_bool_setting,
)
from app.core.config import settings as app_settings

router = APIRouter(prefix="/api/admin/settings", tags=["Admin - Settings"])


@router.get("/route-personal-accounts", response_model=RoutePersonalAccountsSetting)
async def get_route_personal_accounts_setting(
    db: Session = Depends(get_db),
    current_user: Staff = Depends(require_admin),
):
    """Whether sending through a personal Gmail/Outlook/Yahoo EmailAccount
    is routed through the system's send-only fallback (e.g. Resend)."""
    enabled = get_bool_setting(
        ROUTE_PERSONAL_ACCOUNTS_THROUGH_FALLBACK_KEY,
        default=app_settings.ROUTE_PERSONAL_ACCOUNTS_THROUGH_FALLBACK,
    )
    return {"enabled": enabled}


@router.put("/route-personal-accounts", response_model=RoutePersonalAccountsSetting)
async def update_route_personal_accounts_setting(
    data: RoutePersonalAccountsSetting,
    db: Session = Depends(get_db),
    current_user: Staff = Depends(require_admin),
):
    set_bool_setting(ROUTE_PERSONAL_ACCOUNTS_THROUGH_FALLBACK_KEY, data.enabled)
    return {"enabled": data.enabled}
