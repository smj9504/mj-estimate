"""
FastAPI Backend for MJ Estimate Generator
Main application entry point with comprehensive database abstraction system
"""

from fastapi import FastAPI, Request, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse
from fastapi.exceptions import RequestValidationError
from fastapi.staticfiles import StaticFiles
from starlette.middleware.sessions import SessionMiddleware
from datetime import datetime
import logging
import sys
import os
from pathlib import Path
from contextlib import asynccontextmanager

# Import all models first to ensure SQLAlchemy relationships are properly set up
# This prevents circular dependency issues
from app.domains.sketch.models import *
from app.domains.company.models import *
from app.domains.staff.models import *
from app.domains.water_mitigation.models import *
from app.domains.reconstruction_estimate.models import *
from app.domains.material_detection.models import *

# API and core imports
from app.domains.company.api import router as company_router
from app.domains.invoice.api import router as invoice_router
from app.domains.estimate.api import router as estimate_router
from app.domains.plumber_report.api import router as plumber_report_router
from app.domains.plumber_report.templates.api import router as plumber_report_template_router
from app.domains.document.api import router as document_router
from app.domains.work_order.api import router as work_order_router
from app.domains.payment.api import router as payment_router
from app.domains.credit.api import router as credit_router
from app.domains.staff.api import router as staff_router
from app.domains.document_types.api import router as document_types_router
from app.domains.auth.api import router as auth_router
from app.domains.dashboard.api import router as dashboard_router
from app.domains.payment_config.api import router as payment_config_router
from app.domains.line_items.api import router as line_items_router
from app.domains.xactimate.api import router as xactimate_router
from app.domains.file.api import router as file_router
from app.domains.sketch.api import router as sketch_router
from app.domains.receipt.api import router as receipt_router
from app.domains.water_mitigation.api import router as water_mitigation_router
from app.domains.reconstruction_estimate.api import router as reconstruction_estimate_router
from app.domains.material_detection.api import router as material_detection_router
from app.core.config import settings
from app.core.database_factory import get_database, db_factory
# Service factory removed - using direct service instantiation
from app.core.interfaces import DatabaseException, ConnectionError, ConfigurationError

# Conditional integration imports (only if enabled)
if settings.ENABLE_INTEGRATIONS:
    from app.domains.integrations.api import router as integrations_router
    from app.domains.integrations.google_sheets.api import router as google_sheets_router
    from app.domains.integrations.google_sheets.scheduler import start_scheduler, stop_scheduler

# Configure logging system
from app.core.logging_config import setup_logging, get_access_logger, get_error_logger
logger = setup_logging()

# Specialized loggers
access_logger = get_access_logger()
error_logger = get_error_logger()
app_logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Application lifespan manager for startup and shutdown events.
    Handles database initialization and cleanup.
    """
    logger.info(f"Starting MJ Estimate API in {settings.ENVIRONMENT} environment")
    
    try:
        # Initialize database system
        database = get_database()
        logger.info(f"Database system initialized: {database.provider_name}")
        
        # Perform health check
        if database.health_check():
            logger.info("Database health check passed")
        else:
            logger.warning("Database health check failed, but continuing...")
        
        # Services now use database directly via dependency injection
        
        # Initialize database tables
        if hasattr(database, 'init_database'):
            database.init_database()
            logger.info("Database tables initialized")

        # Start integration services if enabled
        if settings.ENABLE_INTEGRATIONS:
            start_scheduler()
            logger.info("Integration services started (Google Sheets scheduler)")

        logger.info("Application startup completed successfully")
        yield
        
    except ConfigurationError as e:
        logger.error(f"Configuration error during startup: {e}")
        raise
    except ConnectionError as e:
        logger.error(f"Database connection error during startup: {e}")
        raise
    except Exception as e:
        logger.error(f"Unexpected error during startup: {e}")
        raise
    finally:
        # Cleanup on shutdown
        logger.info("Shutting down application...")
        try:
            # Stop integration services if enabled
            if settings.ENABLE_INTEGRATIONS:
                stop_scheduler()
                logger.info("Integration services stopped")

            db_factory.reset()
            # Services cleanup handled individually
            logger.info("Application shutdown completed")
        except Exception as e:
            logger.error(f"Error during shutdown: {e}")


# Create FastAPI app with lifespan management
app = FastAPI(
    title="MJ Estimate API",
    description="API for MJ Estimate Generator with modular database system",
    version="2.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan
)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Add session middleware for SQLAdmin authentication
app.add_middleware(
    SessionMiddleware,
    secret_key=settings.SECRET_KEY,
)


# Exception handlers
@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    """Custom handler for validation errors to provide more details"""
    logger.error(f"Validation error on {request.url}: {exc.errors()}")
    logger.error(f"Request body: {exc.body}")
    
    return JSONResponse(
        status_code=422,
        content={
            "detail": exc.errors(),
            "body": str(exc.body),
            "message": "Request validation failed",
            "timestamp": datetime.utcnow().isoformat()
        }
    )


@app.exception_handler(DatabaseException)
async def database_exception_handler(request: Request, exc: DatabaseException):
    """Custom handler for database errors"""
    import traceback
    logger.error(f"Database error on {request.url}: {exc}")
    logger.error(f"Full traceback: {traceback.format_exc()}")
    
    # Include the actual error message
    return JSONResponse(
        status_code=500,
        content={
            "message": "Database error occurred",
            "detail": str(exc),
            "error_type": str(type(exc).__name__),
            "traceback": traceback.format_exc(),
            "timestamp": datetime.utcnow().isoformat(),
            "type": "database_error"
        }
    )


@app.exception_handler(ConnectionError)
async def connection_exception_handler(request: Request, exc: ConnectionError):
    """Custom handler for connection errors"""
    logger.error(f"Connection error on {request.url}: {exc}")
    
    return JSONResponse(
        status_code=503,
        content={
            "message": "Database connection error",
            "detail": "Service temporarily unavailable",
            "timestamp": datetime.utcnow().isoformat(),
            "type": "connection_error"
        }
    )


@app.exception_handler(ConfigurationError)
async def configuration_exception_handler(request: Request, exc: ConfigurationError):
    """Custom handler for configuration errors"""
    logger.error(f"Configuration error on {request.url}: {exc}")
    
    return JSONResponse(
        status_code=500,
        content={
            "message": "Configuration error",
            "detail": "Service misconfigured",
            "timestamp": datetime.utcnow().isoformat(),
            "type": "configuration_error"
        }
    )


# Setup SQLAdmin directly on the FastAPI app
# This must happen AFTER middleware setup
# Temporarily disabled due to SQLAlchemy model compatibility issues
# database = get_database()
# if hasattr(database, 'engine'):
#     try:
#         from sqladmin import Admin
#         from app.admin import (
#             AdminAuth, CompanyAdmin, InvoiceAdmin, InvoiceItemAdmin, 
#             EstimateAdmin, EstimateItemAdmin, PlumberReportAdmin, DocumentAdmin,
#             DocumentTypeAdmin, TradeAdmin
#         )
#         
#         # Create authentication backend
#         authentication_backend = AdminAuth(secret_key=settings.SECRET_KEY)
#         
#         # Create admin instance directly on the FastAPI app
#         # Do NOT specify base_url parameter
#         admin = Admin(
#             app, 
#             database.engine,
#             title="MJ Estimate Database Admin",
#             authentication_backend=authentication_backend
#         )
#         
#         # Add all model views
#         admin.add_view(CompanyAdmin)
#         admin.add_view(InvoiceAdmin)
#         admin.add_view(InvoiceItemAdmin)
#         admin.add_view(EstimateAdmin)
#         admin.add_view(EstimateItemAdmin)
#         admin.add_view(PlumberReportAdmin)
#         admin.add_view(DocumentAdmin)
#         admin.add_view(DocumentTypeAdmin)
#         admin.add_view(TradeAdmin)
#         
#         logger.info("SQLAdmin successfully initialized at /admin")
#     except Exception as e:
#         logger.error(f"Failed to initialize SQLAdmin: {e}", exc_info=True)
# else:
#     logger.warning("Database does not have engine attribute - SQLAdmin not initialized")

# Include routers AFTER SQLAdmin setup
# Authentication endpoints
app.include_router(auth_router, prefix="/api/auth", tags=["Authentication"])

# Removed old modular endpoints - migrated to domain-driven structure

# New domain-driven endpoints
app.include_router(company_router, prefix="/api/companies", tags=["Companies"])
app.include_router(invoice_router, prefix="/api/invoices", tags=["Invoices"])
app.include_router(estimate_router, prefix="/api/estimates", tags=["Estimates"])
app.include_router(plumber_report_router, prefix="/api/plumber-reports", tags=["Plumber Reports"])
app.include_router(plumber_report_template_router, prefix="/api", tags=["Plumber Report Templates"])
app.include_router(document_router, prefix="/api/documents", tags=["Documents"])

# New Work Order System endpoints
app.include_router(work_order_router, prefix="/api/work-orders", tags=["Work Orders"])
app.include_router(payment_router, prefix="/api/payments", tags=["Payments & Billing"])
app.include_router(credit_router, prefix="/api/credits", tags=["Credits & Discounts"])
app.include_router(staff_router, prefix="/api/staff", tags=["Staff Management"])

# Line Items System endpoints
app.include_router(line_items_router, prefix="/api/line-items", tags=["Line Items"])
app.include_router(xactimate_router, prefix="/api/xactimate", tags=["Xactimate"])

# Dashboard and Analytics endpoints
app.include_router(dashboard_router, prefix="/api/dashboard", tags=["Dashboard & Analytics"])

# Document Types and Trades endpoints
app.include_router(document_types_router, prefix="/api", tags=["Document Types & Trades"])

# Trade endpoints

# Payment Configuration endpoints (internal use)
app.include_router(payment_config_router, prefix="/api/payment-config", tags=["Payment Configuration"])

# File Management endpoints
app.include_router(file_router, prefix="/api/files", tags=["File Management"])

# Interior Sketch System endpoints
app.include_router(sketch_router, prefix="/api/sketches", tags=["Interior Sketches"])

# Receipt System endpoints
app.include_router(receipt_router, prefix="/api/receipts", tags=["Receipts & Templates"])

# Water Mitigation System endpoints
app.include_router(water_mitigation_router, prefix="/api")

# Reconstruction Estimate System endpoints
app.include_router(reconstruction_estimate_router)

# Material Detection endpoints (conditionally loaded)
if getattr(settings, 'ENABLE_MATERIAL_DETECTION', True):
    app.include_router(material_detection_router, prefix="/api/material-detection", tags=["Material Detection"])
    logger.info("Material Detection routes registered")

# External Integrations endpoints (conditionally loaded)
if settings.ENABLE_INTEGRATIONS:
    app.include_router(integrations_router, prefix="/api/integrations", tags=["External Integrations"])
    app.include_router(google_sheets_router, prefix="/api/integrations/google-sheets", tags=["Google Sheets Integration"])
    logger.info("Integration routes registered (CompanyCam, Google Sheets, Slack)")


# System information endpoints
@app.get("/")
async def root():
    """Root endpoint with system information"""
    return {
        "name": "MJ Estimate API",
        "version": "2.0.0",
        "status": "active",
        "environment": settings.ENVIRONMENT,
        "database": get_database().provider_name,
        "docs": "/docs",
        "api_versions": {
            "v1": "/api",
            "v2": "/api/v2"
        }
    }


@app.get("/health")
async def health_check():
    """Comprehensive health check endpoint"""
    try:
        database = get_database()
        db_healthy = database.health_check()
        
        # Services are domain-based now
        service_info = {"status": "domain-based", "healthy": True}
        
        return {
            "status": "healthy" if db_healthy else "degraded",
            "timestamp": datetime.utcnow().isoformat(),
            "service": "mj-estimate-api",
            "version": "2.0.0",
            "environment": settings.ENVIRONMENT,
            "database": {
                "provider": database.provider_name,
                "healthy": db_healthy,
                "info": db_factory.get_database_info()
            },
            "services": service_info,
            "components": {
                "api": "healthy",
                "database": "healthy" if db_healthy else "unhealthy",
                "services": "healthy"
            }
        }
    except Exception as e:
        logger.error(f"Health check failed: {e}")
        return JSONResponse(
            status_code=503,
            content={
                "status": "unhealthy",
                "timestamp": datetime.utcnow().isoformat(),
                "service": "mj-estimate-api",
                "error": str(e)
            }
        )


@app.get("/system/info")
async def system_info():
    """Get detailed system information"""
    try:
        database = get_database()
        # Services are domain-based now
        
        return {
            "application": {
                "name": "MJ Estimate API",
                "version": "2.0.0",
                "environment": settings.ENVIRONMENT,
                "debug": settings.DEBUG
            },
            "database": db_factory.get_database_info(),
            "services": {"status": "domain-based", "healthy": True},
            "configuration": {
                "cors_origins": settings.CORS_ORIGINS,
                "log_level": settings.LOG_LEVEL,
                "api_prefix": settings.API_PREFIX
            },
            "features": {
                "modular_database": True,
                "service_factory": False,
                "error_handling": True,
                "connection_pooling": True,
                "retry_mechanisms": True,
                "health_monitoring": True
            }
        }
    except Exception as e:
        logger.error(f"Failed to get system info: {e}")
        raise


@app.get("/system/database/switch/{provider}")
async def switch_database_provider(provider: str):
    """
    Switch database provider (for testing/development only).
    
    WARNING: This endpoint should not be available in production.
    """
    if settings.ENVIRONMENT == "production":
        raise HTTPException(
            status_code=403, 
            detail="Database switching not allowed in production"
        )
    
    try:
        # Reset current connections
        db_factory.reset()
        
        # Create new database with specified provider
        database = db_factory.create_database(provider)
        # Services now use database directly via dependency injection
        
        return {
            "message": f"Successfully switched to {provider} database",
            "provider": database.provider_name,
            "healthy": database.health_check(),
            "timestamp": datetime.utcnow().isoformat()
        }
        
    except Exception as e:
        logger.error(f"Failed to switch database provider: {e}")
        return JSONResponse(
            status_code=500,
            content={
                "message": "Failed to switch database provider",
                "error": str(e),
                "timestamp": datetime.utcnow().isoformat()
            }
        )


# Mount uploads directory for local file serving (development only)
# In production, files will be served from cloud storage
if settings.ENVIRONMENT in ["development", "dev", "local"]:
    uploads_path = Path(__file__).parent.parent / "uploads"
    if not uploads_path.exists():
        uploads_path.mkdir(parents=True, exist_ok=True)
        logger.info(f"Created uploads directory at: {uploads_path.absolute()}")

    logger.info(f"[DEV] Mounting uploads directory from: {uploads_path.absolute()}")
    app.mount("/uploads", StaticFiles(directory=str(uploads_path)), name="uploads")
else:
    logger.info(f"[PROD] Uploads will be served from cloud storage")

# Serve React build files in production (optional)
# Check if frontend build directory exists
frontend_build_path = Path(__file__).parent.parent.parent / "frontend" / "build"
frontend_static_path = frontend_build_path / "static"

# Log the actual paths being checked for debugging
logger.info(f"Looking for frontend build at: {frontend_build_path.absolute()}")
logger.info(f"Frontend build exists: {frontend_build_path.exists()}")
logger.info(f"Frontend static exists: {frontend_static_path.exists()}")

if frontend_build_path.exists() and frontend_static_path.exists():
    logger.info(f"Serving static files from {frontend_build_path}")

    # Mount static files for assets
    app.mount("/static", StaticFiles(directory=str(frontend_static_path)), name="static")
else:
    logger.info(f"Frontend build directory not found at {frontend_build_path}")
    logger.info("Running in API-only mode. To serve the React app from FastAPI, run 'npm run build' in the frontend directory")


if __name__ == "__main__":
    import uvicorn
    
    logger.info(f"Starting server on {settings.HOST}:{settings.PORT}")
    logger.info(f"Environment: {settings.ENVIRONMENT}")
    logger.info(f"Debug mode: {settings.DEBUG}")
    
    uvicorn.run(
        "app.main:app",
        host=settings.HOST,
        port=settings.PORT,
        reload=settings.DEBUG,
        log_level=settings.LOG_LEVEL.lower() if settings.LOG_LEVEL else "info"
    )