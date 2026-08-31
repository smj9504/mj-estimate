"""
FastAPI Backend for MJ Estimate Generator
Main application entry point with comprehensive database abstraction system
"""

# Suppress WeasyPrint GTK/Fontconfig warnings on Windows
# These are harmless warnings from Linux libraries running on Windows
import os

_fontconfig_path = os.path.join(
    os.path.expanduser('~'), 'anaconda3', 'Library', 'etc', 'fonts'
)
if os.path.isdir(_fontconfig_path):
    os.environ['FONTCONFIG_PATH'] = _fontconfig_path
    os.environ.pop('FONTCONFIG_FILE', None)  # Remove conflicting var
else:
    os.environ.setdefault('FONTCONFIG_FILE', 'NUL')
os.environ.setdefault('G_SLICE', 'always-malloc')

# Suppress GLib warnings
import warnings

warnings.filterwarnings('ignore', category=DeprecationWarning)

import asyncio
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
from app.core.scheduler import start_shared_scheduler, stop_shared_scheduler

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
    WMScopeItemCategory, WMStandardScopeItem, WMSheetPAMapping
)

# Company model (imported after its dependencies)
from app.domains.company.models import Company, CompanyContact

# Client management system models
from app.domains.client.models import Client, Claim, ClaimNegotiation, ClaimPayment, ClaimExpense, ClaimNote, ClaimTodo

# Contract system models
from app.domains.contract.models import (
    ContractTemplate, ContractInstance, ContractSignature, ClaimCompany
)

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
from app.domains.repair_spec.api import condition_router as repair_condition_router
from app.domains.repair_spec.api import template_router as repair_template_router
from app.domains.invoice.api import router as invoice_router
from app.domains.line_items.api import router as line_items_router
from app.domains.pack_calculation.api import router as pack_calculation_router
from app.domains.pack_calculation.packing_api import router as packing_estimate_router
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
from app.domains.electrician_report.api import router as electrician_report_router
from app.domains.receipt.api import router as receipt_router
from app.domains.reconstruction_estimate.api import (
    router as reconstruction_estimate_router,
)
from app.domains.sketch.api import router as sketch_router
from app.domains.staff.api import router as staff_router
from app.domains.cabinet_estimate.api import router as cabinet_estimate_router
from app.domains.cabinet_estimate.models import (
    CabinetEstimate, CabinetBox, CabinetEstimateLineItem, CabinetEstimateHistory
)
from app.domains.cabinet_estimate.sketch_models import CabinetSketch
from app.domains.bathroom_estimate.api import router as bathroom_estimate_router
from app.domains.bathroom_estimate.models import (
    BathroomEstimate, BathroomEstimateLineItem, BathroomEstimateHistory
)
from app.domains.siding_estimate.api import router as siding_estimate_router
from app.domains.siding_estimate.models import (
    SidingEstimate, SidingEstimateLineItem
)
from app.domains.roofing_estimate.api import router as roofing_estimate_router
from app.domains.roofing_estimate.models import (
    RoofingEstimate, RoofingEstimateLineItem, RoofingEstimateHistory
)
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
from app.domains.client.api import router as client_router, todo_dashboard_router
from app.domains.contract.api import router as contract_router
from app.domains.contract.signing_api import router as signing_router
from app.domains.contract.field_signing_api import router as field_signing_router
from app.domains.material_order.api import router as material_order_router
from app.domains.work_order.api import router as work_order_router
from app.domains.xactimate.api import router as xactimate_router
from app.domains.xactimate_helper.api import router as xactimate_helper_router
from app.domains.xactimate_helper.models import (  # noqa: F401
    XactLineItem, XactAssembly, XactAssemblyItem,
    XactRoom, XactCorrectionFeedback, XactItemDescription,
)
from app.domains.cheatsheet.api import router as cheatsheet_router
from app.domains.cheatsheet.models import (  # noqa: F401
    CheatsheetSection, CheatsheetRule, CheatsheetTable, CheatsheetRow,
)
from app.domains.crew_upload.api import public_router as crew_upload_public_router
from app.domains.crew_upload.api import admin_router as crew_upload_admin_router
from app.domains.water_mitigation.trash_scheduler import (
    start_trash_scheduler,
    stop_trash_scheduler,
)
from app.domains.claim_followup.reply_scheduler import (
    start_reply_scheduler,
    stop_reply_scheduler,
)
from app.domains.email_ingestion.scheduler import (
    start_email_ingestion_scheduler,
    stop_email_ingestion_scheduler,
)
from app.domains.crew_upload.models import UploadLink, UploadSession
from app.domains.insurance_extraction.models import (
    InsurancePdfExtraction,
    InsurancePdfExtractionItem,
)

# Email Ingestion system models
from app.domains.email_ingestion.models import EmailAccount, EmailIngestionLog
from app.domains.email_ingestion.api import router as email_ingestion_router

# Admin system settings
from app.domains.admin.models import SystemSetting
from app.domains.admin.settings_api import router as admin_settings_router

# Claim Follow-up system models
from app.domains.claim_followup.models import (
    FollowUpTask, EmailTemplate, CommunicationLog, SentEmail
)
from app.domains.claim_followup.api import router as claim_followup_router
from app.domains.claim_followup.lifecycle_api import router as lifecycle_router

# Supplement system models
from app.domains.supplement.models import (
    SupplementRequest, BidItemEstimate, SupplementFollowUp
)
from app.domains.supplement.api import router as supplement_router
from app.domains.contractor_portal.models import ContractorPortalToken  # noqa: F401
from app.domains.contractor_portal.api import (
    public_router as contractor_portal_public_router,
    admin_router as contractor_portal_admin_router,
)

# Rebuild system models
from app.domains.rebuild.models import (
    RebuildContractor, RebuildProject, RebuildCompletionDoc
)
from app.domains.rebuild.api import router as rebuild_router

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
from app.core.error_reporting import report_error_to_admin

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
    from app.domains.integrations.magicplan.api import (
        router as magicplan_router,
    )
    # AccuLynx: self-contained, removable module - see
    # app/domains/integrations/acculynx/__init__.py for the removal checklist
    if settings.ENABLE_ACCULYNX:
        from app.domains.integrations.acculynx.api import (
            router as acculynx_router,
        )

# Configure logging system
from app.core.logging_config import get_access_logger, get_error_logger, setup_logging

logger = setup_logging()

# Specialized loggers
access_logger = get_access_logger()
error_logger = get_error_logger()
app_logger = logging.getLogger(__name__)


_NEEDED_COLUMNS = [
    ("wm_floor_sketches", "storage_file_id", "VARCHAR(500)"),
    ("wm_floor_sketches", "storage_provider", "VARCHAR(50)"),
    ("contract_templates", "storage_file_id", "VARCHAR(500)"),
    ("invoices", "client_id", "UUID"),
    ("invoices", "claim_id", "UUID"),
    ("invoices", "is_lump_sum_document", "BOOLEAN"),
    ("invoices", "lump_sum_document_amount", "DECIMAL(15,2)"),
    ("estimates", "client_id", "UUID"),
    ("estimates", "claim_id", "UUID"),
    ("estimates", "is_lump_sum_document", "BOOLEAN"),
    ("estimates", "lump_sum_document_amount", "DECIMAL(15,2)"),
    ("work_orders", "client_id", "UUID"),
    ("work_orders", "claim_id", "UUID"),
    ("water_mitigation_jobs", "claim_id", "UUID"),
    ("clients", "normalized_address", "VARCHAR(500)"),
    ("claims", "total_insurance_paid", "DECIMAL(15,2)"),
    ("claims", "payment_status", "VARCHAR(50)"),
    ("claims", "insurance_estimate_received", "BOOLEAN"),
    ("claims", "insurance_estimate_received_date", "TIMESTAMPTZ"),
    ("claims", "insurance_estimate_file_id", "VARCHAR(255)"),
    ("claims", "insurance_estimate_file_name", "VARCHAR(500)"),
    ("claims", "needs_supplement", "BOOLEAN"),
    ("claims", "supplement_status", "VARCHAR(50)"),
    ("claims", "supplement_notes", "TEXT"),
    ("claims", "has_public_adjuster", "BOOLEAN"),
    ("claims", "pa_fee_percentage", "DECIMAL(5,2)"),
    ("claims", "pa_name", "VARCHAR(255)"),
    ("claims", "pa_company", "VARCHAR(255)"),
    ("claims", "pa_email", "VARCHAR(255)"),
    ("claims", "pa_phone", "VARCHAR(50)"),
    ("claims", "pa_contact_id", "UUID"),
    ("companies", "company_type", "VARCHAR(50)"),
    ("sent_emails", "reply_received", "BOOLEAN"),
    ("sent_emails", "reply_received_at", "TIMESTAMPTZ"),
    ("sent_emails", "reply_summary", "TEXT"),
    # pack_calculations missing columns
    ("pack_calculations", "estimate_mode", "VARCHAR(50)"),
    ("pack_calculations", "status", "VARCHAR(50)"),
    ("pack_calculations", "crew_size", "INTEGER"),
    ("pack_calculations", "region", "VARCHAR(50)"),
    ("pack_calculations", "staging_type", "VARCHAR(20)"),
    ("pack_calculations", "include_packback", "BOOLEAN"),
    ("pack_calculations", "storage_months", "INTEGER"),
    ("pack_calculations", "include_op", "BOOLEAN"),
    ("pack_calculations", "op_rate", "INTEGER"),
    ("pack_calculations", "include_contingency", "BOOLEAN"),
    ("pack_calculations", "contingency_rate", "INTEGER"),
    ("pack_calculations", "sections", "JSONB"),
    ("pack_calculations", "section_details", "JSONB"),
    ("pack_calculations", "materials_summary", "JSONB"),
    ("pack_calculations", "material_details", "JSONB"),
    ("pack_calculations", "supplements", "JSONB"),
    ("pack_calculations", "subtotal", "DOUBLE PRECISION"),
    ("pack_calculations", "op_amount", "DOUBLE PRECISION"),
    ("pack_calculations", "contingency_amount", "DOUBLE PRECISION"),
    ("pack_calculations", "supplements_total", "DOUBLE PRECISION"),
    ("pack_calculations", "grand_total", "DOUBLE PRECISION"),
    ("pack_calculations", "storage_sf", "INTEGER"),
    ("pack_calculations", "total_hours", "DOUBLE PRECISION"),
    ("pack_calculations", "total_items", "INTEGER"),
    ("pack_calculations", "special_items", "JSONB"),
    ("pack_calculations", "custom_special_items", "JSONB"),
    ("pack_calculations", "room_summaries", "JSONB"),
    # Email account signature fields
    ("email_accounts", "sender_name", "VARCHAR(255)"),
    ("email_accounts", "sender_phone", "VARCHAR(50)"),
    # Supplement followup reply tracking
    ("supplement_followups", "sent_email_id", "UUID"),
    ("supplement_followups", "reply_body_html", "TEXT"),
    ("supplement_followups", "reply_attachment_ids", "JSONB"),
    # Bathroom estimate insulation fields
    ("bathroom_estimates", "demo_insulation_walls", "BOOLEAN DEFAULT FALSE"),
    ("bathroom_estimates", "demo_insulation_walls_sf", "DOUBLE PRECISION"),
    ("bathroom_estimates", "demo_insulation_ceiling", "BOOLEAN DEFAULT FALSE"),
    ("bathroom_estimates", "demo_insulation_ceiling_sf", "DOUBLE PRECISION"),
    ("bathroom_estimates", "install_insulation_walls", "BOOLEAN DEFAULT FALSE"),
    ("bathroom_estimates", "install_insulation_walls_sf", "DOUBLE PRECISION"),
    ("bathroom_estimates", "install_insulation_ceiling", "BOOLEAN DEFAULT FALSE"),
    ("bathroom_estimates", "install_insulation_ceiling_sf", "DOUBLE PRECISION"),
    # WM payment tracking
    ("water_mitigation_jobs", "payment_status", "VARCHAR(50)"),
    ("water_mitigation_jobs", "payment_note", "TEXT"),
    # Follow-up payment tracking
    ("followup_tasks", "payment_status", "VARCHAR(50)"),
    ("followup_tasks", "payment_note", "TEXT"),
    # Email account OAuth fields
    ("email_accounts", "auth_method", "VARCHAR(20) DEFAULT 'password'"),
    ("email_accounts", "oauth_access_token", "TEXT"),
    ("email_accounts", "oauth_refresh_token", "TEXT"),
    ("email_accounts", "oauth_token_expiry", "TIMESTAMPTZ"),
    # MagicPlan metadata for WM photos
    ("wm_photos", "magicplan_metadata", "JSONB"),
    # Staff contractor company link
    ("staff", "company_id", "UUID"),
    # Contractor payment portal fields
    ("claim_payments", "payment_category", "VARCHAR(50)"),
    ("claim_payments", "check_photo_file_id", "VARCHAR(255)"),
    ("claim_payments", "pa_fee_deducted", "BOOLEAN DEFAULT TRUE"),
    ("claim_payments", "pa_fee_amount", "DECIMAL(15,2)"),
    ("claim_payments", "gross_amount", "DECIMAL(15,2)"),
    ("claim_payments", "source", "VARCHAR(50) DEFAULT 'admin'"),
    ("claim_payments", "contractor_company_id", "UUID"),
    # Storage provider defense-in-depth: authoritative source of truth for
    # which provider a stored url lives on, so download code never has to
    # re-derive it by parsing the url string (a prior bug where a
    # prefix-less url was misread as "local" caused false 404s on files
    # that were genuinely in cloud storage)
    ("files", "storage_provider", "VARCHAR(50)"),
    ("contract_instances", "filled_pdf_provider", "VARCHAR(50)"),
    ("contract_instances", "signed_pdf_provider", "VARCHAR(50)"),
]


def _auto_add_columns_with_conn(conn):
    """Add new nullable columns using an existing connection (no extra round trip)."""
    from sqlalchemy import text

    target_tables = list({t for t, _, _ in _NEEDED_COLUMNS})
    rows = conn.execute(text(
        "SELECT table_name, column_name "
        "FROM information_schema.columns "
        "WHERE table_schema = 'public' "
        "AND table_name = ANY(:tables)"
    ), {"tables": target_tables}).fetchall()

    existing = {}
    for table_name, column_name in rows:
        existing.setdefault(table_name, set()).add(column_name)

    for table, col, col_type in _NEEDED_COLUMNS:
        if col not in existing.get(table, set()):
            # Each column is its own savepoint so one failure (lock
            # timeout, type conflict, etc.) can't block every column
            # after it in the list — previously a single failed ALTER
            # aborted the whole outer transaction, silently skipping
            # all subsequent columns on every future restart too.
            try:
                with conn.begin_nested():
                    conn.execute(text(
                        f"ALTER TABLE {table} ADD COLUMN {col} {col_type}"
                    ))
                print(f"[MIGRATION] Added {table}.{col}")
            except Exception as e:
                print(f"[MIGRATION] Failed to add {table}.{col}: {e}")

    # Rename 'mode' → 'estimate_mode' (conflicts with PG aggregate)
    pc_cols = existing.get("pack_calculations", set())
    if "mode" in pc_cols and "estimate_mode" not in pc_cols:
        try:
            with conn.begin_nested():
                conn.execute(text(
                    'ALTER TABLE pack_calculations '
                    'RENAME COLUMN "mode" TO estimate_mode'
                ))
            print("[MIGRATION] Renamed pack_calculations.mode → estimate_mode")
        except Exception as e:
            print(f"[MIGRATION] Failed to rename pack_calculations.mode: {e}")



@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Application lifespan manager for startup and shutdown events.
    Handles database initialization and cleanup.
    """
    # Log immediately to show startup progress
    print(f"[STARTUP] Starting MJ Estimate API in {settings.ENVIRONMENT} environment")
    logger.info(f"Starting MJ Estimate API in {settings.ENVIRONMENT} environment")

    # Diagnostic: Log AI classification config status
    _gemini_set = bool(settings.GEMINI_API_KEY)
    _gemini_len = len(settings.GEMINI_API_KEY) if settings.GEMINI_API_KEY else 0
    _gemini_raw = bool(os.environ.get("GEMINI_API_KEY"))
    print(f"[STARTUP] AI Config: ENABLE_AI={settings.ENABLE_AI_PHOTO_CLASSIFICATION}, "
          f"GEMINI_KEY_in_settings={_gemini_set} (len={_gemini_len}), "
          f"GEMINI_KEY_in_os_env={_gemini_raw}")
    
    try:
        # ULTRA-FAST STARTUP: Skip all heavy initialization
        # Everything lazy-loads on first API request
        print("[STARTUP] Ultra-fast startup - services initialize on demand")

        # Register all scheduled jobs, then start the single shared scheduler
        if settings.ENABLE_INTEGRATIONS:
            try:
                start_scheduler()
                print("[STARTUP] Google Sheets sync job registered")
            except Exception as e:
                print(f"[STARTUP] Google Sheets scheduler skipped: {e}")

        try:
            start_trash_scheduler()
            print("[STARTUP] Trash cleanup job registered (daily at 3AM ET)")
        except Exception as e:
            print(f"[STARTUP] Trash scheduler skipped: {e}")

        try:
            start_reply_scheduler()
            print("[STARTUP] Reply check job registered (every 10 min)")
        except Exception as e:
            print(f"[STARTUP] Reply scheduler skipped: {e}")

        try:
            start_email_ingestion_scheduler()
            print("[STARTUP] Email ingestion poll job registered (daily at 6AM ET)")
        except Exception as e:
            print(f"[STARTUP] Email ingestion scheduler skipped: {e}")

        # Start the single shared scheduler (1 thread for all jobs)
        start_shared_scheduler()
        print("[STARTUP] Shared scheduler started")

        # Defer heavy initialization to background thread so port binds quickly
        # This prevents Render's port scan timeout during deployment
        def _background_init():
            """Run DB migration + SQLAdmin + Storage init in background."""
            try:
                from app.core.database_factory import get_database
                _db = get_database()
                if hasattr(_db, 'engine'):
                    from sqlalchemy import text, inspect
                    from app.domains.material_order.models import MaterialOrder, MaterialOrderItem
                    from app.core.database_factory import Base

                    # Add enum values outside transaction (PG requirement)
                    try:
                        with _db.engine.connect().execution_options(
                            isolation_level="AUTOCOMMIT"
                        ) as enum_conn:
                            enum_conn.execute(text(
                                "ALTER TYPE staffrole ADD VALUE IF NOT EXISTS 'contractor'"
                            ))
                            print("[MIGRATION] Ensured 'contractor' in staffrole enum")
                    except Exception as e:
                        print(f"[MIGRATION] staffrole enum: {e}")

                    with _db.engine.begin() as conn:
                        existing = set(inspect(conn).get_table_names())
                        tables_to_create = [
                            t for t in Base.metadata.sorted_tables
                            if t.name not in existing
                        ]
                        if tables_to_create:
                            Base.metadata.create_all(
                                bind=conn, tables=tables_to_create
                            )
                            print(f"[STARTUP] Created {len(tables_to_create)} new tables")
                        else:
                            print("[STARTUP] All tables exist")

                        _auto_add_columns_with_conn(conn)
                        print("[STARTUP] Column migration done")

                        # Backfill updated_at for rows created before the
                        # column had a server_default (was onupdate-only,
                        # so never-updated rows had updated_at = NULL).
                        for backfill_table in ("estimates", "invoices"):
                            if backfill_table in existing or backfill_table in {t.name for t in tables_to_create}:
                                try:
                                    with conn.begin_nested():
                                        result = conn.execute(text(
                                            f"UPDATE {backfill_table} SET updated_at = created_at "
                                            "WHERE updated_at IS NULL"
                                        ))
                                    if result.rowcount:
                                        print(f"[MIGRATION] Backfilled updated_at for {result.rowcount} rows in {backfill_table}")
                                except Exception as e:
                                    print(f"[MIGRATION] Failed to backfill updated_at for {backfill_table}: {e}")

                    _db._tables_initialized = True

                    # Seed default repair spec data
                    try:
                        from app.domains.repair_spec.seed import seed_default_data
                        seed_session = _db.SessionLocal()
                        try:
                            seed_default_data(seed_session)
                            seed_session.commit()
                        except Exception as seed_err:
                            seed_session.rollback()
                            print(f"[STARTUP] Repair spec seed skipped: {seed_err}")
                        finally:
                            seed_session.close()
                    except Exception as seed_import_err:
                        print(f"[STARTUP] Repair spec seed import failed: {seed_import_err}")
            except Exception as e:
                print(f"[STARTUP] Table/migration skipped: {e}")

            # SQLAdmin init
            _init_sqladmin()

            # Storage provider init
            try:
                initialize_storage()
                print("[STARTUP] Storage provider initialized")
            except Exception as e:
                print(f"[STARTUP] Storage init deferred: {e}")

            print("[STARTUP] Background initialization complete")

        threading.Thread(target=_background_init, daemon=True).start()

        print("[STARTUP] Ready")
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
            # Remove individual jobs
            if settings.ENABLE_INTEGRATIONS:
                stop_scheduler()
            stop_trash_scheduler()
            stop_reply_scheduler()
            stop_email_ingestion_scheduler()

            # Stop the single shared scheduler
            stop_shared_scheduler()

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

# Add session middleware for SQLAdmin authentication
app.add_middleware(
    SessionMiddleware,
    secret_key=settings.SECRET_KEY,
)

# Configure CORS — MUST be added last so it's the outermost middleware.
# This ensures CORS headers are always present, even on error responses.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
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

    # Sanitize errors: convert non-serializable ctx values
    errors = []
    for err in exc.errors():
        clean = {**err}
        if 'ctx' in clean and isinstance(clean['ctx'], dict):
            clean['ctx'] = {
                k: str(v) if not isinstance(
                    v, (str, int, float, bool, type(None))
                ) else v
                for k, v in clean['ctx'].items()
            }
        errors.append(clean)

    return JSONResponse(
        status_code=422,
        content={
            "detail": errors,
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


def _cors_headers_for(request: Request) -> dict:
    """
    Manually mirror CORS headers for the catch-all handler's response.

    Starlette wires @app.exception_handler(Exception) to ServerErrorMiddleware,
    which sits OUTSIDE CORSMiddleware in the stack (CORSMiddleware only wraps
    ExceptionMiddleware, which is where HTTPException/RequestValidationError/
    DatabaseException/etc are handled). Without this, a truly unhandled
    exception would return a 500 with no Access-Control-Allow-Origin header,
    and the browser would block the frontend from reading it (shows up as a
    generic network error instead of our JSON body).
    """
    origin = request.headers.get("origin")
    if not origin:
        return {}
    if "*" in settings.CORS_ORIGINS or origin in settings.CORS_ORIGINS:
        return {
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Credentials": "true",
            "Vary": "Origin",
        }
    return {}


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    """
    Catch-all handler for any exception not covered above.

    HTTPException, RequestValidationError, DatabaseException, ConnectionError,
    ConfigurationError and RateLimitExceeded all have more specific handlers
    registered and are resolved before this one via Starlette's MRO-based
    exception handler lookup - this handler only fires for genuinely
    unexpected errors (AttributeError, KeyError, TypeError, un-wrapped
    third-party exceptions, etc).

    Reports the error to admins via Slack (throttled, fire-and-forget) and
    returns the same JSON response shape as the handlers above.
    """
    import traceback
    request_id = _get_request_id(request)
    tb_str = traceback.format_exc()
    logger.error(f"[{request_id[:8]}] Unhandled error on {request.method} {request.url}: {exc}")
    logger.error(f"[{request_id[:8]}] Full traceback: {tb_str}")

    # Use the matched route template (e.g. "/api/work-orders/{id}") instead
    # of the resolved path when available, so errors on the same endpoint
    # across many different record IDs are grouped under one throttle
    # signature instead of flooding Slack with one alert per ID.
    route = request.scope.get("route")
    route_path = route.path if route is not None else request.url.path

    # Fire-and-forget: never block or fail the error response on Slack.
    asyncio.create_task(
        report_error_to_admin(
            request_id=request_id,
            method=request.method,
            path=route_path,
            exc=exc,
            traceback_str=tb_str,
        )
    )

    content = {
        "message": "An unexpected error occurred",
        "detail": str(exc) if settings.DEBUG else "An internal error occurred",
        "error_type": str(type(exc).__name__),
        "timestamp": datetime.utcnow().isoformat(),
        "type": "internal_error",
        "request_id": request_id
    }
    if settings.DEBUG:
        content["traceback"] = tb_str

    return JSONResponse(
        status_code=500,
        content=content,
        headers={"X-Request-ID": request_id, **_cors_headers_for(request)}
    )


# SQLAdmin initialization moved to lifespan to avoid competing for NeonDB connection
import threading


def _init_sqladmin():
    # Skip SQLAdmin in production to save ~30-50MB RAM
    if settings.ENVIRONMENT == "production" and not os.getenv("ENABLE_SQLADMIN", "").lower() == "true":
        logger.info("SQLAdmin disabled in production (set ENABLE_SQLADMIN=true to enable)")
        return
    try:
        database = get_database()
        if hasattr(database, 'engine'):
            from app.admin import setup_admin
            setup_admin(app, database.engine)
            logger.info("SQLAdmin successfully initialized at /admin")
    except ImportError as e:
        logger.warning(f"SQLAdmin not available (missing dependency): {e}")
    except Exception as e:
        logger.error(f"Failed to initialize SQLAdmin: {e}", exc_info=True)


# Include routers
# Authentication endpoints
app.include_router(auth_router, prefix="/api/auth", tags=["Authentication"])

# Removed old modular endpoints - migrated to domain-driven structure

# New domain-driven endpoints
app.include_router(company_router, prefix="/api/companies", tags=["Companies"])
app.include_router(client_router, prefix="/api/clients", tags=["Clients"])
app.include_router(todo_dashboard_router, prefix="/api/claim-todos", tags=["Claim Todos"])
app.include_router(contract_router, prefix="/api/contracts", tags=["Contracts"])
app.include_router(signing_router, prefix="/api/sign", tags=["Contract Signing (Public)"])
app.include_router(field_signing_router, prefix="/api/field-sign", tags=["Field Signing (Public)"])
app.include_router(invoice_router, prefix="/api/invoices", tags=["Invoices"])
app.include_router(estimate_router, prefix="/api/estimates", tags=["Estimates"])
app.include_router(plumber_report_router, prefix="/api/plumber-reports", tags=["Plumber Reports"])
app.include_router(plumber_report_template_router, prefix="/api", tags=["Plumber Report Templates"])
app.include_router(electrician_report_router, prefix="/api/electrician-reports", tags=["Electrician Reports"])
app.include_router(document_router, prefix="/api/documents", tags=["Documents"])

# New Work Order System endpoints
app.include_router(work_order_router, prefix="/api/work-orders", tags=["Work Orders"])
app.include_router(payment_router, prefix="/api/payments", tags=["Payments & Billing"])
app.include_router(credit_router, prefix="/api/credits", tags=["Credits & Discounts"])
app.include_router(staff_router, prefix="/api/staff", tags=["Staff Management"])

# Line Items System endpoints
app.include_router(line_items_router, prefix="/api/line-items", tags=["Line Items"])
app.include_router(xactimate_router, prefix="/api/xactimate", tags=["Xactimate"])
app.include_router(xactimate_helper_router, prefix="/api/xactimate", tags=["Xactimate Helper"])
app.include_router(cheatsheet_router, prefix="/api/cheatsheet", tags=["Cheat Sheet"])

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
app.include_router(repair_condition_router, prefix="/api/repair-conditions", tags=["Repair Conditions"])
app.include_router(repair_template_router, prefix="/api/repair-templates", tags=["Repair Templates"])

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

# Cabinet Estimate System endpoints
app.include_router(cabinet_estimate_router, prefix="/api", tags=["Cabinet Estimates"])
app.include_router(bathroom_estimate_router, prefix="/api", tags=["Bathroom Estimates"])
app.include_router(siding_estimate_router, prefix="/api", tags=["Siding Estimates"])
app.include_router(roofing_estimate_router, prefix="/api", tags=["Roofing Estimates"])

# Material Order System endpoints
app.include_router(material_order_router, prefix="/api", tags=["Material Orders"])

# Reconstruction Estimate System endpoints
app.include_router(reconstruction_estimate_router)

# Pack-In/Out Calculation System endpoints
app.include_router(pack_calculation_router, prefix="/api")
app.include_router(packing_estimate_router, prefix="/api")

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

# Email Ingestion endpoints
app.include_router(email_ingestion_router, prefix="/api/email-ingestion", tags=["Email Ingestion"])

# Admin system settings endpoints (router already declares its own /api/admin/settings prefix)
app.include_router(admin_settings_router)

# Claim Follow-up endpoints
app.include_router(claim_followup_router, prefix="/api/claim-followup", tags=["Claim Follow-up"])
app.include_router(lifecycle_router, prefix="/api/claims", tags=["Claims Lifecycle"])

# Supplement endpoints
app.include_router(supplement_router, prefix="/api", tags=["Supplements"])
app.include_router(contractor_portal_public_router, prefix="/api/contractor-portal", tags=["Contractor Portal"])
app.include_router(contractor_portal_admin_router, prefix="/api/contractor-portal/admin", tags=["Contractor Portal Admin"])

# Rebuild endpoints
app.include_router(rebuild_router, prefix="/api", tags=["Rebuild Projects"])

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
    app.include_router(magicplan_router, prefix="/api/integrations/magicplan", tags=["MagicPlan Integration"])
    logger.info("Integration routes registered (CompanyCam, Google Sheets, Slack, MagicPlan)")
    logger.info(f"Webhook endpoint available at: /api/integrations/companycam/webhook")
    # AccuLynx: self-contained, removable module (see acculynx/__init__.py)
    if settings.ENABLE_ACCULYNX:
        app.include_router(acculynx_router, prefix="/api/integrations/acculynx", tags=["AccuLynx Integration"])
        logger.info("AccuLynx integration routes registered")
else:
    logger.warning("⚠️ ENABLE_INTEGRATIONS is False - Integration endpoints disabled")


# System information endpoints
@app.api_route("/", methods=["GET", "HEAD"])
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


@app.api_route("/health", methods=["GET", "HEAD"])
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
            "ai_classification": {
                "enabled": settings.ENABLE_AI_PHOTO_CLASSIFICATION,
                "gemini_key_configured": bool(settings.GEMINI_API_KEY),
                "gemini_key_length": len(settings.GEMINI_API_KEY) if settings.GEMINI_API_KEY else 0,
                "gemini_key_in_os_env": bool(os.environ.get("GEMINI_API_KEY")),
                "gemini_model": settings.GEMINI_MODEL,
            },
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