"""
Configuration settings for the application
"""

from typing import List, Optional
from pydantic_settings import BaseSettings
import os
from pathlib import Path
from dotenv import load_dotenv

# Get the base directory (2 levels up from this file)
BASE_DIR = Path(__file__).resolve().parent.parent.parent.parent

# Load environment-specific .env file
ENVIRONMENT = os.getenv("ENVIRONMENT", "development")
env_file = f".env.{ENVIRONMENT}"
if Path(env_file).exists():
    load_dotenv(env_file, override=True)
else:
    load_dotenv(".env", override=True)  # Fallback to default .env

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
    DB_POOL_SIZE: int = 10
    DB_MAX_OVERFLOW: int = 20
    DB_POOL_TIMEOUT: int = 30
    DB_POOL_RECYCLE: int = 3600  # 1 hour
    
    # Database Operation Settings
    DB_RETRY_ATTEMPTS: int = 3
    DB_RETRY_DELAY: float = 1.0
    DB_QUERY_TIMEOUT: int = 30
    REMOVE_NONE_VALUES: bool = True
    
    # Server Settings
    HOST: str = os.getenv("HOST", "0.0.0.0")
    PORT: int = int(os.getenv("PORT", "8000"))
    DEBUG: bool = os.getenv("DEBUG", "true").lower() == "true"
    
    # CORS Settings - use default list, override with env variable if provided
    CORS_ORIGINS: List[str] = [
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
    # CompanyCam Integration
    COMPANYCAM_API_KEY: str = os.getenv("COMPANYCAM_API_KEY", "")
    COMPANYCAM_WEBHOOK_TOKEN: str = os.getenv("COMPANYCAM_WEBHOOK_TOKEN", "")

    # Slack Integration
    SLACK_WEBHOOK_URL: str = os.getenv("SLACK_WEBHOOK_URL", "")
    SLACK_CHANNEL: str = os.getenv("SLACK_CHANNEL", "#work-orders")

    # Frontend URL (for generating links in notifications)
    FRONTEND_URL: str = os.getenv("FRONTEND_URL", "http://localhost:3000")

    # Google Sheets Integration (future)
    GOOGLE_SHEETS_CREDENTIALS: Optional[str] = os.getenv("GOOGLE_SHEETS_CREDENTIALS")
    GOOGLE_SHEETS_SPREADSHEET_ID: Optional[str] = os.getenv("GOOGLE_SHEETS_SPREADSHEET_ID")

    class Config:
        env_file = f".env.{os.getenv('ENVIRONMENT', 'development')}"
        case_sensitive = True
        extra = "ignore"  # Ignore extra fields from env

# Create settings instance
settings = Settings()

# Create necessary directories
settings.UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
settings.PDF_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)