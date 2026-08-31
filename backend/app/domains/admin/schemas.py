"""
Admin system settings schemas.
"""

from pydantic import BaseModel


class RoutePersonalAccountsSetting(BaseModel):
    enabled: bool
