"""
Configuration settings for the application
"""

import os
from pathlib import Path
from typing import List, Optional

from dotenv import load_dotenv
from pydantic import field_validator
from pydantic_settings import BaseSettings

# Get the base directory (2 levels up from this file)
BASE_DIR = Path(__file__).resolve().parent.parent.parent.parent

# Load environment-specific .env file
# Fix for Korean Windows: Explicitly use UTF-8 encoding when loading .env files
ENVIRONMENT = os.getenv("ENVIRONMENT", "development")
env_file = f".env.{ENVIRONMENT}"
if Path(env_file).exists():
    load_dotenv(env_file, override=True, encoding="utf-8")
else:
    load_dotenv(".env", override=True, encoding="utf-8")  # Fallback to default .env

class Settings(BaseSettings):
    # Environment
    ENVIRONMENT: str = os.getenv("ENVIRONMENT", "development")
    
    # API Settings
    PROJECT_NAME: str = "MJ Estimate API"
    VERSION: str = "2.0.0"
    API_PREFIX: str = "/api"
    
    # Database Settings
    DATABASE_URL: Optional[str] = None
    DATABASE_TYPE: Optional[str] = None  # sqlite, postgresql, supabase
    LOG_LEVEL: Optional[str] = "INFO"
    
    @field_validator('DATABASE_URL', mode='before')
    @classmethod
    def validate_database_url(cls, v):
        """Ensure DATABASE_URL is properly decoded as UTF-8 string"""
        if v is None:
            return None
        
        # If it's bytes, decode it
        if isinstance(v, bytes):
            try:
                v = v.decode('utf-8')
            except UnicodeDecodeError:
                # Try with error handling
                v = v.decode('utf-8', errors='replace')
        
        # Ensure it's a string
        if not isinstance(v, str):
            v = str(v)
        
        # Remove BOM and strip whitespace
        v = v.strip().strip('\ufeff')
        
        return v
    
    # SQLite Database Settings
    SQLITE_DB_PATH: str = "mjestimate_dev.db"
    USE_SQLITE: bool = False  # Default to PostgreSQL for development
    
    # PostgreSQL Settings
    POSTGRES_HOST: Optional[str] = None
    POSTGRES_PORT: Optional[int] = 5432
    POSTGRES_USER: Optional[str] = None
    POSTGRES_PASSWORD: Optional[str] = None
    POSTGRES_DB: Optional[str] = None
    
    # Connection Pool Settings
    # Render/NeonDB free tier typically allows 5-10 connections
    # Adjust these via environment variables if needed
    DB_POOL_SIZE: int = int(os.getenv("DB_POOL_SIZE", "5"))  # Reduced from 10 for Render compatibility
    DB_MAX_OVERFLOW: int = int(os.getenv("DB_MAX_OVERFLOW", "5"))  # Reduced from 20 for Render compatibility
    DB_POOL_TIMEOUT: int = int(os.getenv("DB_POOL_TIMEOUT", "10"))  # Reduced from 30 to 10 seconds for faster failure
    DB_POOL_RECYCLE: int = int(os.getenv("DB_POOL_RECYCLE", "3600"))  # 1 hour
    
    # Database Operation Settings
    DB_RETRY_ATTEMPTS: int = 3
    DB_RETRY_DELAY: float = 1.0
    DB_QUERY_TIMEOUT: int = 30
    REMOVE_NONE_VALUES: bool = True
    # Auto-initialize database tables on startup (set to false if using migrations)
    DB_AUTO_INIT: bool = os.getenv("DB_AUTO_INIT", "true").lower() == "true"
    
    # Server Settings
    HOST: str = os.getenv("HOST", "0.0.0.0")
    PORT: int = int(os.getenv("PORT", "8000"))
    DEBUG: bool = os.getenv("DEBUG", "true").lower() == "true"

    # Production Safety Flag - Explicit production marker
    # This flag must be explicitly set to "true" in production environments
    # Used for additional safety checks on development-only features
    IS_PRODUCTION: bool = os.getenv("IS_PRODUCTION", "false").lower() == "true"
    
    # CORS Settings - parse from env or use default list
    @property
    def CORS_ORIGINS(self) -> List[str]:
        cors_env = os.getenv("CORS_ORIGINS")
        if cors_env:
            # Parse JSON array from env variable
            import json
            try:
                return json.loads(cors_env)
            except json.JSONDecodeError:
                # Fallback: split by comma
                return [origin.strip() for origin in cors_env.split(",")]

        # Default CORS origins for development
        return [
            "http://localhost:3000",
            "http://localhost:3001",
            "http://127.0.0.1:3000",
            "http://127.0.0.1:3001",
        ]
    
    # Supabase Settings
    SUPABASE_URL: str = os.getenv("SUPABASE_URL", "")
    SUPABASE_KEY: str = os.getenv("SUPABASE_KEY", "")
    SUPABASE_SERVICE_KEY: Optional[str] = None
    SUPABASE_JWT_SECRET: Optional[str] = None
    
    # Security
    SECRET_KEY: str = os.getenv("SECRET_KEY", "your-secret-key-here-change-in-production")
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    
    # File Storage
    UPLOAD_DIR: Path = BASE_DIR / "uploads"
    MAX_UPLOAD_SIZE: int = 10 * 1024 * 1024  # 10MB
    
    # PDF Generation
    PDF_OUTPUT_DIR: Path = BASE_DIR / "data" / "pdfs"
    TEMPLATE_DIR: Path = BASE_DIR / "templates"

    # External Integrations
    # Integration Feature Toggle
    ENABLE_INTEGRATIONS: bool = os.getenv("ENABLE_INTEGRATIONS", "true").lower() == "true"

    # CompanyCam Integration
    COMPANYCAM_API_KEY: str = os.getenv("COMPANYCAM_API_KEY", "")
    COMPANYCAM_WEBHOOK_TOKEN: str = os.getenv("COMPANYCAM_WEBHOOK_TOKEN", "")

    # MagicPlan Integration
    MAGICPLAN_API_KEY: str = os.getenv("MAGICPLAN_API_KEY", "")
    MAGICPLAN_CUSTOMER_ID: str = os.getenv("MAGICPLAN_CUSTOMER_ID", "")

    # AccuLynx Integration (self-contained/removable module - see app/domains/integrations/acculynx/__init__.py)
    ENABLE_ACCULYNX: bool = os.getenv("ENABLE_ACCULYNX", "false").lower() == "true"
    ACCULYNX_API_KEY: str = os.getenv("ACCULYNX_API_KEY", "")
    # Fallback/default AccuLynx document folder (used for generic claim files and as
    # the catch-all when a more specific folder below isn't configured). AccuLynx
    # itself calls its catch-all folder "Other".
    ACCULYNX_DOCUMENT_FOLDER_ID: str = os.getenv("ACCULYNX_DOCUMENT_FOLDER_ID", "")
    # Optional per-document-type folder overrides (see acculynx/service.py:_resolve_document_folder_id)
    ACCULYNX_DOCUMENT_FOLDER_ID_INVOICE: str = os.getenv("ACCULYNX_DOCUMENT_FOLDER_ID_INVOICE", "")
    ACCULYNX_DOCUMENT_FOLDER_ID_WATER_MITIGATION: str = os.getenv("ACCULYNX_DOCUMENT_FOLDER_ID_WATER_MITIGATION", "")

    # Slack Integration
    SLACK_WEBHOOK_URL: str = os.getenv("SLACK_WEBHOOK_URL", "")
    SLACK_CHANNEL: str = os.getenv("SLACK_CHANNEL", "#work-orders")
    SLACK_BOT_TOKEN: str = os.getenv("SLACK_BOT_TOKEN", "")  # OAuth Bot Token (xoxb-...)
    SLACK_APP_TOKEN: str = os.getenv("SLACK_APP_TOKEN", "")  # App-level token (xapp-...)

    # Frontend URL (for generating links in notifications)
    FRONTEND_URL: str = os.getenv("FRONTEND_URL", "http://localhost:3000")

    # Backend public URL (for links/pixels embedded in outbound emails, e.g. open tracking)
    BACKEND_PUBLIC_URL: str = os.getenv("BACKEND_PUBLIC_URL", "http://localhost:8000")

    # Email Settings (for password reset, notifications, etc.)
    SMTP_HOST: str = os.getenv("SMTP_HOST", "smtp.gmail.com")
    SMTP_PORT: int = int(os.getenv("SMTP_PORT", "587"))
    SMTP_USER: str = os.getenv("SMTP_USER", "")
    SMTP_PASSWORD: str = os.getenv("SMTP_PASSWORD", "")
    SMTP_FROM_EMAIL: str = os.getenv("SMTP_FROM_EMAIL", "noreply@mjestimate.com")
    SMTP_FROM_NAME: str = os.getenv("SMTP_FROM_NAME", "SimpleWorks")
    EMAIL_ENABLED: bool = os.getenv("EMAIL_ENABLED", "false").lower() == "true"

    # Google Sheets Integration
    GOOGLE_API_KEY: str = os.getenv("GOOGLE_API_KEY", "")

    # Multiple Google Sheets support
    GOOGLE_SHEETS_WATER_MITIGATION_ID: Optional[str] = os.getenv("GOOGLE_SHEETS_WATER_MITIGATION_ID")
    GOOGLE_SHEETS_WATER_MITIGATION_SHEET_NAME: str = os.getenv("GOOGLE_SHEETS_WATER_MITIGATION_SHEET_NAME", "Sheet1")
    # Multiple sheet tabs support (comma-separated, e.g., "Angel,Vanessa")
    GOOGLE_SHEETS_WATER_MITIGATION_SHEET_NAMES: str = os.getenv("GOOGLE_SHEETS_WATER_MITIGATION_SHEET_NAMES", "")

    @property
    def water_mitigation_sheet_names(self) -> list:
        """Get list of Water Mitigation sheet names to sync"""
        if self.GOOGLE_SHEETS_WATER_MITIGATION_SHEET_NAMES:
            return [name.strip() for name in self.GOOGLE_SHEETS_WATER_MITIGATION_SHEET_NAMES.split(",") if name.strip()]
        # Fallback to single sheet name
        return [self.GOOGLE_SHEETS_WATER_MITIGATION_SHEET_NAME]

    GOOGLE_SHEETS_WORK_ORDER_ID: Optional[str] = os.getenv("GOOGLE_SHEETS_WORK_ORDER_ID")
    GOOGLE_SHEETS_WORK_ORDER_SHEET_NAME: str = os.getenv("GOOGLE_SHEETS_WORK_ORDER_SHEET_NAME", "Sheet1")

    GOOGLE_SHEETS_INVOICE_ID: Optional[str] = os.getenv("GOOGLE_SHEETS_INVOICE_ID")
    GOOGLE_SHEETS_INVOICE_SHEET_NAME: str = os.getenv("GOOGLE_SHEETS_INVOICE_SHEET_NAME", "Sheet1")

    # Legacy support
    GOOGLE_SHEETS_CREDENTIALS: Optional[str] = os.getenv("GOOGLE_SHEETS_CREDENTIALS")
    GOOGLE_SHEETS_SPREADSHEET_ID: Optional[str] = os.getenv("GOOGLE_SHEETS_SPREADSHEET_ID")

    # Material Detection Feature Toggle
    ENABLE_MATERIAL_DETECTION: bool = os.getenv("ENABLE_MATERIAL_DETECTION", "true").lower() == "true"

    # Roboflow API
    ROBOFLOW_API_KEY: str = os.getenv("ROBOFLOW_API_KEY", "")
    ROBOFLOW_WORKSPACE: str = os.getenv("ROBOFLOW_WORKSPACE", "")
    ROBOFLOW_MODEL_ID: str = os.getenv("ROBOFLOW_MODEL_ID", "construction-materials")
    ROBOFLOW_MODEL_VERSION: str = os.getenv("ROBOFLOW_MODEL_VERSION", "1")

    # Google Cloud Vision API
    GOOGLE_CLOUD_VISION_KEY: Optional[str] = os.getenv("GOOGLE_CLOUD_VISION_KEY")
    GOOGLE_VISION_ENABLED: bool = os.getenv("GOOGLE_VISION_ENABLED", "true").lower() == "true"

    # Custom ViT Model
    CUSTOM_VIT_MODEL_NAME: str = os.getenv("CUSTOM_VIT_MODEL_NAME", "google/vit-base-patch16-224")
    CUSTOM_VIT_MODEL_PATH: Optional[str] = os.getenv("CUSTOM_VIT_MODEL_PATH")

    # Ensemble Settings
    ENSEMBLE_STRATEGY: str = os.getenv("ENSEMBLE_STRATEGY", "voting")
    ENSEMBLE_AGGREGATION: str = os.getenv("ENSEMBLE_AGGREGATION", "weighted_mean")
    ENSEMBLE_MIN_PROVIDERS: int = int(os.getenv("ENSEMBLE_MIN_PROVIDERS", "2"))

    # Material Detection Settings
    MATERIAL_DETECTION_CONFIDENCE_THRESHOLD: float = float(os.getenv("MATERIAL_DETECTION_CONFIDENCE_THRESHOLD", "0.70"))
    MATERIAL_DETECTION_MAX_IMAGES_PER_JOB: int = int(os.getenv("MATERIAL_DETECTION_MAX_IMAGES_PER_JOB", "50"))

    # Photo Analysis Settings (AI-powered room analysis)
    OPENAI_API_KEY: str = os.getenv("OPENAI_API_KEY", "")
    PHOTO_ANALYSIS_CACHE_ENABLED: bool = os.getenv("PHOTO_ANALYSIS_CACHE_ENABLED", "true").lower() == "true"
    PHOTO_ANALYSIS_CACHE_TTL_DAYS: int = int(os.getenv("PHOTO_ANALYSIS_CACHE_TTL_DAYS", "30"))
    PHOTO_ANALYSIS_MODEL: str = os.getenv("PHOTO_ANALYSIS_MODEL", "gpt-4o")  # gpt-4-vision-preview is deprecated

    # Gemini Vision API Settings (AI-powered photo classification)
    GEMINI_API_KEY: str = os.getenv("GEMINI_API_KEY", "")
    GEMINI_MODEL: str = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
    ENABLE_AI_PHOTO_CLASSIFICATION: bool = os.getenv("ENABLE_AI_PHOTO_CLASSIFICATION", "true").lower() == "true"

    # Storage Configuration
    STORAGE_PROVIDER: str = os.getenv("STORAGE_PROVIDER", "local")  # local, gdrive, gcs, s3, azure
    STORAGE_BASE_DIR: str = os.getenv("STORAGE_BASE_DIR", "uploads")

    # Google Cloud Storage (GCS) Settings
    GCS_SERVICE_ACCOUNT_FILE: Optional[str] = os.getenv("GCS_SERVICE_ACCOUNT_FILE")
    GCS_BUCKET_NAME: Optional[str] = os.getenv("GCS_BUCKET_NAME")
    GCS_PROJECT_ID: Optional[str] = os.getenv("GCS_PROJECT_ID")

    # Google Drive Storage Settings
    GDRIVE_SERVICE_ACCOUNT_FILE: Optional[str] = os.getenv("GDRIVE_SERVICE_ACCOUNT_FILE")
    GDRIVE_ROOT_FOLDER_ID: Optional[str] = os.getenv("GDRIVE_ROOT_FOLDER_ID")
    GDRIVE_SHARED_DRIVE_ID: Optional[str] = os.getenv("GDRIVE_SHARED_DRIVE_ID")  # Required for Service Accounts

    # Google Service Account JSON (for cloud deployments like Render)
    # Set this environment variable with the full JSON content of the service account key
    # This allows authentication without uploading a file to the server
    GOOGLE_SERVICE_ACCOUNT_JSON: Optional[str] = os.getenv("GOOGLE_SERVICE_ACCOUNT_JSON")

    # Google OAuth 2.0 Settings (for user-level Google Drive access)
    GOOGLE_OAUTH_CLIENT_ID: Optional[str] = os.getenv("GOOGLE_OAUTH_CLIENT_ID")
    GOOGLE_OAUTH_CLIENT_SECRET: Optional[str] = os.getenv("GOOGLE_OAUTH_CLIENT_SECRET")
    GOOGLE_OAUTH_REDIRECT_URI: str = os.getenv("GOOGLE_OAUTH_REDIRECT_URI", "http://localhost:3000/oauth/google/callback")

    # Xactimate Helper Tool Settings
    ANTHROPIC_API_KEY: str = os.getenv("ANTHROPIC_API_KEY", "")
    XACT_VISION_MODEL: str = os.getenv("XACT_VISION_MODEL", "claude-haiku-4-5-20241022")
    XACT_MATCHING_MODEL: str = os.getenv("XACT_MATCHING_MODEL", "claude-sonnet-4-6-20250514")
    XACT_EMBEDDING_MODEL: str = os.getenv("XACT_EMBEDDING_MODEL", "text-embedding-3-small")
    XACT_SIMILARITY_THRESHOLD_EXACT: float = float(os.getenv("XACT_SIMILARITY_THRESHOLD_EXACT", "0.92"))
    XACT_SIMILARITY_THRESHOLD_HINT: float = float(os.getenv("XACT_SIMILARITY_THRESHOLD_HINT", "0.85"))
    XACT_CORRECTION_AUTO_APPLY_THRESHOLD: int = int(os.getenv("XACT_CORRECTION_AUTO_APPLY_THRESHOLD", "3"))
    XACT_CANDIDATE_ITEM_LIMIT: int = int(os.getenv("XACT_CANDIDATE_ITEM_LIMIT", "8"))

    # Plumber Report AI Generation Settings
    # OpenAI is shared with Photo Analysis above — this only controls whether
    # the plumber report generator tries it. Default off: OpenAI account has
    # no credits right now, so trying it just adds a guaranteed-failure delay
    # before falling through to Anthropic. Flip to "true" once credits are added.
    PLUMBER_REPORT_USE_OPENAI: bool = os.getenv("PLUMBER_REPORT_USE_OPENAI", "false").lower() == "true"

    # Email Ingestion Settings
    ENABLE_EMAIL_INGESTION: bool = os.getenv("ENABLE_EMAIL_INGESTION", "true").lower() == "true"
    EMAIL_ENCRYPTION_KEY: Optional[str] = os.getenv("EMAIL_ENCRYPTION_KEY")

    # Redis Cache Settings
    REDIS_HOST: str = os.getenv("REDIS_HOST", "localhost")
    REDIS_PORT: int = int(os.getenv("REDIS_PORT", "6379"))
    REDIS_DB: int = int(os.getenv("REDIS_DB", "0"))
    REDIS_PASSWORD: Optional[str] = os.getenv("REDIS_PASSWORD")
    # For services like Upstash or Render Redis
    REDIS_URL: Optional[str] = os.getenv("REDIS_URL")

    class Config:
        env_file = f".env.{os.getenv('ENVIRONMENT', 'development')}"
        case_sensitive = True
        extra = "ignore"  # Ignore extra fields from env

# Create settings instance
settings = Settings()

# Create necessary directories
settings.UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
settings.PDF_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)