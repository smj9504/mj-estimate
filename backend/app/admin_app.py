"""
SQLAdmin application factory
"""

from sqladmin import Admin
from starlette.applications import Starlette
from starlette.middleware import Middleware
from starlette.middleware.sessions import SessionMiddleware
from app.admin import (
    AdminAuth, CompanyAdmin, InvoiceAdmin, InvoiceItemAdmin, 
    EstimateAdmin, EstimateItemAdmin, PlumberReportAdmin, DocumentAdmin
)
from app.core.config import settings
import logging

logger = logging.getLogger(__name__)

def create_admin_app(engine):
    """
    Create a standalone Starlette app for SQLAdmin
    """
    # Create middleware
    middleware = [
        Middleware(SessionMiddleware, secret_key=settings.SECRET_KEY)
    ]
    
    # Create Starlette app for admin
    admin_app = Starlette(middleware=middleware)
    
    # Create authentication backend
    authentication_backend = AdminAuth(secret_key=settings.SECRET_KEY)
    
    # Create admin instance
    admin = Admin(
        admin_app,
        engine,
        title="MJ Estimate Database Admin",
        authentication_backend=authentication_backend,
    )
    
    # Add all model views
    admin.add_view(CompanyAdmin)
    admin.add_view(InvoiceAdmin)
    admin.add_view(InvoiceItemAdmin)
    admin.add_view(EstimateAdmin)
    admin.add_view(EstimateItemAdmin)
    admin.add_view(PlumberReportAdmin)
    admin.add_view(DocumentAdmin)
    
    logger.info("SQLAdmin app created successfully")
    return admin_app