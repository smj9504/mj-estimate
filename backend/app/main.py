"""
FastAPI Backend for MJ Estimate Generator
Main application entry point with comprehensive database abstraction system
"""

# Suppress WeasyPrint GTK/Fontconfig warnings on Windows
# These are harmless warnings from Linux libraries running on Windows
import os

os.environ.setdefault('FONTCONFIG_FILE', 'NUL')
os.environ.setdefault('G_SLICE', 'always-malloc')

# Suppress GLib warnings
import warnings

warnings.filterwarnings('ignore', category=DeprecationWarning)

import logging
import os
import sys
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from starlette.middleware.sessions import SessionMiddleware

from app.core.rate_limiter import limiter, rate_limit_exceeded_handler

# Conditional model imports (only if Material Detection enabled)
from app.core.config import settings as _early_settings

# =============================================================================
# Model Imports for SQLAlchemy Relationship Registration
# =============================================================================
# These models are imported to ensure SQLAlchemy relationships are properly
# registered before the app starts. They must be imported for ORM integrity.
# =============================================================================

# Staff/Authentication system models (imported first as other models depend on it)
from app.domains.staff.models import (
    StaffRole, PermissionLevel, Staff, StaffPermission,
    StaffSession, AuditLog
)

# Water Mitigation system models
from app.domains.water_mitigation.models import (
    WaterMitigationJob, PhotoCategory, WMPhoto, WMDocument,
    WMPhotoCategory, WMJobStatusHistory, WMSyncLog, WMReportConfig,
    WMDemolitionType, WMScopeLocation, WMScopeItem, WMDebrisCalculation,
    WMScopeItemCategory, WMStandardScopeItem
)

# Company model (imported after its dependencies)
from app.domains.company.models import Company

# Packout system models
from app.domains.packout.models import (
    XactimateCategory, ItemSize, FragilityLevel, XactimateCode, PackingRule,
    ItemXactimateMapping, PhotoAnalysisPackout, PackoutTemplate
)

# Photo Analysis system models
from app.domains.photo_analysis.models import PhotoAnalysisCache, PhotoAnalysis

# Receipt system models
from app.domains.receipt.models import Receipt, ReceiptTemplate

# Reconstruction Estimate system models
from app.domains.reconstruction_estimate.models import (
    MoistureLevel, UnitType, MaterialCategory, MaterialWeight,
    DebrisCalculation, DebrisItem
)

# Interior Sketch system models
from app.domains.sketch.models import Sketch, Room, Wall, Fixture, Measurement

# Material Detection system models (conditional - only if enabled)
if getattr(_early_settings, 'ENABLE_MATERIAL_DETECTION', False):
    try:
        from app.domains.material_detection.models import (
            JobStatus, MaterialDetectionJob, DetectedMaterial
        )
    except ImportError:
        pass  # Material Detection dependencies not installed

# API and core imports
from app.core.config import settings
from app.domains.analytics.api import router as analytics_router
from app.domains.auth.api import router as auth_router
from app.domains.company.api import router as company_router
from app.domains.credit.api import router as credit_router
from app.domains.dashboard.api import router as dashboard_router
from app.domains.document.api import router as document_router
from app.domains.document_types.api import router as document_types_router
from app.domains.estimate.api import router as estimate_router
from app.domains.file.api import router as file_router
from app.domains.file.service import initialize_storage
from app.domains.insurance_extraction.api import router as insurance_extraction_router
from app.domains.invoice.api import router as invoice_router
from app.domains.line_items.api import router as line_items_router
from app.domains.pack_calculation.api import router as pack_calculation_router
from app.domains.packout.api import router as packout_router
from app.domains.payment.api import router as payment_router
from app.domains.payment_config.api import router as payment_config_router
from app.domains.pdf_editor.api import router as pdf_editor_router
from app.domains.photo_analysis.api import router as photo_analysis_router
from app.domains.photo_analysis.pack_estimate_api import router as pack_estimate_router
from app.domains.plumber_report.api import router as plumber_report_router
from app.domains.plumber_report.templates.api import (
    router as plumber_report_template_router,
)
from app.domains.receipt.api import router as receipt_router
from app.domains.reconstruction_estimate.api import (
    router as reconstruction_estimate_router,
)
from app.domains.sketch.api import router as sketch_router
from app.domains.staff.api import router as staff_router
from app.domains.water_mitigation.api import router as water_mitigation_router
from app.domains.water_mitigation.scope_api import router as wm_scope_router
from app.domains.water_mitigation.standard_scope_api import (
    router as wm_standard_scope_router,
)
from app.domains.water_mitigation.scope_category_api import (
    router as wm_scope_category_router,
)
from app.domains.water_mitigation.sketch_api import router as wm_sketch_router
from app.domains.water_mitigation.sketch_models import (
    WMFloorSketch,
    WMDemolitionZone,
    WMEquipmentPlacement,
    WMContainmentZone,
    WMFloorProtection,
)
from app.domains.work_order.api import router as work_order_router
from app.domains.xactimate.api import router as xactimate_router
from app.domains.crew_upload.api import public_router as crew_upload_public_router
from app.domains.crew_upload.api import admin_router as crew_upload_admin_router
from app.domains.crew_upload.models import UploadLink, UploadSession
from app.domains.insurance_extraction.models import (
    InsurancePdfExtraction,
    InsurancePdfExtractionItem,
)

# Conditional Material Detection imports (only if enabled)
material_detection_available = False
training_api_available = False

if settings.ENABLE_MATERIAL_DETECTION:
    try:
        from app.domains.material_detection.api import (
            router as material_detection_router,
        )
        from app.domains.material_detection.service import initialize_material_detection
        material_detection_available = True
        print("[INFO] Material Detection module loaded successfully")
    except ImportError as e:
        print(f"[WARNING] Material Detection dependencies missing: {e}")
        settings.ENABLE_MATERIAL_DETECTION = False

    # Try to import training API (optional)
    if material_detection_available:
        try:
            from app.domains.material_detection.training.api import (
                router as training_router,
            )
            training_api_available = True
            print("[INFO] Training API module loaded successfully")
        except ImportError as e:
            print(f"[WARNING] Training API dependencies missing (optional): {e}")
from app.core.database_factory import db_factory, get_database

# Service factory removed - using direct service instantiation
from app.core.interfaces import ConfigurationError, ConnectionError, DatabaseException

# Conditional integration imports (only if enabled)
if settings.ENABLE_INTEGRATIONS:
    from app.domains.integrations.api import router as integrations_router
    from app.domains.integrations.google_sheets.api import (
        router as google_sheets_router,
    )
    from app.domains.integrations.google_sheets.scheduler import (
        start_scheduler,
        stop_scheduler,
    )

# Configure logging system
from app.core.logging_config import get_access_logger, get_error_logger, setup_logging

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
    # Log immediately to show startup progress
    print(f"[STARTUP] Starting MJ Estimate API in {settings.ENVIRONMENT} environment")
    logger.info(f"Starting MJ Estimate API in {settings.ENVIRONMENT} environment")
    
    try:
        # ULTRA-FAST STARTUP: Skip all heavy initialization
        # Everything lazy-loads on first API request
        print("[STARTUP] Ultra-fast startup - services initialize on demand")

        # Only start scheduler (lightweight, non-blocking)
        if settings.ENABLE_INTEGRATIONS:
            try:
                start_scheduler()
                print("[STARTUP] Background scheduler started")
            except Exception as e:
                print(f"[STARTUP] Scheduler skipped: {e}")

        print("[STARTUP] Ready - database/storage initialize on first use")
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

# Add rate limiter to app state (required by slowapi)
app.state.limiter = limiter

# Add rate limit exceeded exception handler
app.add_exception_handler(RateLimitExceeded, rate_limit_exceeded_handler)

# Add SlowAPI middleware for rate limiting
app.add_middleware(SlowAPIMiddleware)

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


# Request logging middleware with Request ID tracking
@app.middleware("http")
async def log_requests(request: Request, call_next):
    """Log all incoming requests with timing and Request ID tracking"""
    import time
    import uuid

    start_time = time.time()

    # Generate or use existing Request ID for tracing
    request_id = request.headers.get("X-Request-ID", str(uuid.uuid4()))

    # Store request_id in request state for access in handlers
    request.state.request_id = request_id

    # Log incoming request (skip health checks)
    if "/health" not in request.url.path:
        app_logger.info(
            f"→ [{request_id[:8]}] {request.method} {request.url.path} "
            f"from {request.client.host if request.client else 'unknown'}"
        )

    try:
        response = await call_next(request)

        # Calculate response time
        process_time = (time.time() - start_time) * 1000  # Convert to ms

        # Log response (skip health checks)
        if "/health" not in request.url.path:
            app_logger.info(
                f"← [{request_id[:8]}] {request.method} {request.url.path} "
                f"Status: {response.status_code} "
                f"Time: {process_time:.2f}ms"
            )

        # Add timing and request ID headers
        response.headers["X-Process-Time"] = str(process_time)
        response.headers["X-Request-ID"] = request_id
        return response

    except Exception as e:
        # Log errors with request ID
        error_logger.error(
            f"✗ [{request_id[:8]}] {request.method} {request.url.path} "
            f"Error: {str(e)}"
        )
        raise


# Helper to get request_id from request state
def _get_request_id(request: Request) -> str:
    """Get request ID from request state, or generate new one"""
    return getattr(request.state, 'request_id', 'unknown')


# Exception handlers
@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    """Custom handler for validation errors to provide more details"""
    request_id = _get_request_id(request)
    logger.error(f"[{request_id[:8]}] Validation error on {request.url}: {exc.errors()}")
    logger.error(f"[{request_id[:8]}] Request body: {exc.body}")

    return JSONResponse(
        status_code=422,
        content={
            "detail": exc.errors(),
            "body": str(exc.body),
            "message": "Request validation failed",
            "timestamp": datetime.utcnow().isoformat(),
            "request_id": request_id
        },
        headers={"X-Request-ID": request_id}
    )


@app.exception_handler(DatabaseException)
async def database_exception_handler(request: Request, exc: DatabaseException):
    """Custom handler for database errors"""
    import traceback
    request_id = _get_request_id(request)
    logger.error(f"[{request_id[:8]}] Database error on {request.url}: {exc}")
    logger.error(f"[{request_id[:8]}] Full traceback: {traceback.format_exc()}")

    # Only include traceback in debug mode (security: hide internals in production)
    content = {
        "message": "Database error occurred",
        "detail": str(exc) if settings.DEBUG else "An internal error occurred",
        "error_type": str(type(exc).__name__),
        "timestamp": datetime.utcnow().isoformat(),
        "type": "database_error",
        "request_id": request_id
    }

    # Only include traceback in development/debug mode
    if settings.DEBUG:
        content["traceback"] = traceback.format_exc()

    return JSONResponse(
        status_code=500,
        content=content,
        headers={"X-Request-ID": request_id}
    )


@app.exception_handler(ConnectionError)
async def connection_exception_handler(request: Request, exc: ConnectionError):
    """Custom handler for connection errors"""
    request_id = _get_request_id(request)
    logger.error(f"[{request_id[:8]}] Connection error on {request.url}: {exc}")

    return JSONResponse(
        status_code=503,
        content={
            "message": "Database connection error",
            "detail": "Service temporarily unavailable",
            "timestamp": datetime.utcnow().isoformat(),
            "type": "connection_error",
            "request_id": request_id
        },
        headers={"X-Request-ID": request_id}
    )


@app.exception_handler(ConfigurationError)
async def configuration_exception_handler(request: Request, exc: ConfigurationError):
    """Custom handler for configuration errors"""
    request_id = _get_request_id(request)
    logger.error(f"[{request_id[:8]}] Configuration error on {request.url}: {exc}")

    return JSONResponse(
        status_code=500,
        content={
            "message": "Configuration error",
            "detail": "Service misconfigured",
            "timestamp": datetime.utcnow().isoformat(),
            "type": "configuration_error",
            "request_id": request_id
        },
        headers={"X-Request-ID": request_id}
    )


# Setup SQLAdmin directly on the FastAPI app
# This must happen AFTER middleware setup
database = get_database()
if hasattr(database, 'engine'):
    try:
        from app.admin import setup_admin
        setup_admin(app, database.engine)
        logger.info("SQLAdmin successfully initialized at /admin")
    except ImportError as e:
        logger.warning(f"SQLAdmin not available (missing dependency): {e}")
    except Exception as e:
        logger.error(f"Failed to initialize SQLAdmin: {e}", exc_info=True)
else:
    logger.warning("Database does not have engine attribute - SQLAdmin not initialized")

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
app.include_router(
    insurance_extraction_router,
    prefix="/api/insurance-extractions",
    tags=["Insurance Extractions"],
)

# Interior Sketch System endpoints
app.include_router(sketch_router, prefix="/api/sketches", tags=["Interior Sketches"])

# Receipt System endpoints
app.include_router(receipt_router, prefix="/api/receipts", tags=["Receipts & Templates"])

# Water Mitigation System endpoints
app.include_router(water_mitigation_router, prefix="/api")
app.include_router(wm_scope_router, prefix="/api/water-mitigation")
app.include_router(wm_standard_scope_router, prefix="/api/water-mitigation")
app.include_router(wm_scope_category_router, prefix="/api/water-mitigation")
app.include_router(
    wm_sketch_router, prefix="/api/water-mitigation/sketch"
)

# Reconstruction Estimate System endpoints
app.include_router(reconstruction_estimate_router)

# Pack-In/Out Calculation System endpoints
app.include_router(pack_calculation_router, prefix="/api")

# Analytics endpoints
app.include_router(analytics_router, prefix="/api", tags=["Analytics"])

# Photo Analysis endpoints (AI-powered room analysis)
app.include_router(photo_analysis_router, prefix="/api/photo-analysis", tags=["Photo Analysis"])

# Pack Estimate endpoints (AI-powered pack-out estimate generation)
app.include_router(pack_estimate_router, prefix="/api/photo-analysis", tags=["Pack Estimate"])

# Packout Analysis endpoints (Xactimate-based content packout estimation)
app.include_router(packout_router, prefix="/api", tags=["Packout Analysis"])

# PDF Editor endpoints
app.include_router(pdf_editor_router, prefix="/api", tags=["PDF Editor"])

# Material Detection endpoints (conditionally loaded)
if material_detection_available:
    app.include_router(material_detection_router, prefix="/api/material-detection", tags=["Material Detection"])
    logger.info("Material Detection routes registered")

    # Training API (optional)
    if training_api_available:
        app.include_router(training_router, prefix="/api/material-detection", tags=["ML Training"])
        logger.info("Training API routes registered")

# Crew Upload endpoints (public + admin)
app.include_router(
    crew_upload_public_router,
    prefix="/api/crew-upload",
    tags=["Crew Upload (Public)"]
)
app.include_router(
    crew_upload_admin_router,
    prefix="/api/crew-upload/admin",
    tags=["Crew Upload (Admin)"]
)

# External Integrations endpoints (conditionally loaded)
if settings.ENABLE_INTEGRATIONS:
    app.include_router(integrations_router, prefix="/api/integrations", tags=["External Integrations"])
    app.include_router(google_sheets_router, prefix="/api/integrations/google-sheets", tags=["Google Sheets Integration"])
    logger.info("Integration routes registered (CompanyCam, Google Sheets, Slack)")
    logger.info(f"Webhook endpoint available at: /api/integrations/companycam/webhook")
else:
    logger.warning("⚠️ ENABLE_INTEGRATIONS is False - Integration endpoints disabled")


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
async def health_check(request: Request):
    """
    Lightweight health check endpoint for monitoring systems.
    Fast response - minimal checks for Render deployment health.
    """
    # Return immediate success - app is running
    return {
        "status": "healthy",
        "timestamp": datetime.utcnow().isoformat(),
        "service": "mj-estimate-api",
        "version": "2.0.0"
    }


async def _check_external_services() -> dict:
    """
    Check health of external integrations.
    Returns status for each configured external service.
    """
    external_services = {}

    # Only check if integrations are enabled
    if not settings.ENABLE_INTEGRATIONS:
        return {"status": "disabled", "message": "Integrations not enabled"}

    # Check Google Sheets
    try:
        if settings.GOOGLE_SHEETS_CREDENTIALS_FILE:
            external_services["google_sheets"] = {
                "status": "configured",
                "healthy": True,
                "credentials_file": bool(settings.GOOGLE_SHEETS_CREDENTIALS_FILE)
            }
        else:
            external_services["google_sheets"] = {
                "status": "not_configured",
                "healthy": None
            }
    except Exception as e:
        external_services["google_sheets"] = {
            "status": "error",
            "healthy": False,
            "error": str(e)
        }

    # Check CompanyCam
    try:
        if settings.COMPANYCAM_API_KEY:
            external_services["companycam"] = {
                "status": "configured",
                "healthy": True,
                "api_key_set": bool(settings.COMPANYCAM_API_KEY)
            }
        else:
            external_services["companycam"] = {"status": "not_configured", "healthy": None}
    except Exception as e:
        external_services["companycam"] = {"status": "error", "healthy": False, "error": str(e)}

    # Check Slack
    try:
        if settings.SLACK_WEBHOOK_URL:
            external_services["slack"] = {
                "status": "configured",
                "healthy": True,
                "webhook_set": bool(settings.SLACK_WEBHOOK_URL)
            }
        else:
            external_services["slack"] = {"status": "not_configured", "healthy": None}
    except Exception as e:
        external_services["slack"] = {"status": "error", "healthy": False, "error": str(e)}

    return external_services


@app.get("/health/detailed")
async def detailed_health_check(request: Request):
    """
    Detailed health check with database and service checks.
    Use this for monitoring, not for deployment health checks.
    """
    try:
        database = get_database()
        db_healthy = database.health_check()

        # Check external services
        external_services = await _check_external_services()

        # Determine overall external services health
        external_healthy = all(
            svc.get("healthy", True) is not False
            for svc in external_services.values()
            if isinstance(svc, dict)
        )

        # Overall status
        overall_healthy = db_healthy and external_healthy

        # Detailed response
        return {
            "status": "healthy" if overall_healthy else "degraded",
            "timestamp": datetime.utcnow().isoformat(),
            "service": "mj-estimate-api",
            "version": "2.0.0",
            "environment": settings.ENVIRONMENT,
            "database": {
                "provider": database.provider_name,
                "healthy": db_healthy,
                "info": db_factory.get_database_info()
            },
            "external_services": external_services,
            "components": {
                "api": "healthy",
                "database": "healthy" if db_healthy else "unhealthy",
                "external_integrations": "healthy" if external_healthy else "degraded"
            }
        }
    except Exception as e:
        logger.error(f"Detailed health check failed: {e}")
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