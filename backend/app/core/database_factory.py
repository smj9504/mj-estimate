"""
Database Factory with comprehensive error handling, connection pooling, and retry mechanisms.
Provides database abstraction layer supporting SQLite, PostgreSQL, and Supabase.
"""

from typing import Any, Dict, Generator, List, Optional, Type, Union

from sqlalchemy import create_engine, event, text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import NullPool, QueuePool

# Conditional import for Supabase (only needed when DATABASE_TYPE=supabase)
try:
    from supabase import Client, create_client
except ImportError:
    create_client = None
    Client = None

import logging
import os
import threading
import time
import traceback
import uuid
from contextlib import contextmanager
from datetime import datetime
from functools import wraps

# Fix for Korean Windows: Set multiple environment variables to force UTF-8 encoding
# This prevents UnicodeDecodeError when Windows username contains Korean characters
os.environ.setdefault("PGCLIENTENCODING", "UTF8")
os.environ.setdefault("PYTHONUTF8", "1")  # Force Python UTF-8 mode (PEP 540)
os.environ.setdefault("PYTHONIOENCODING", "utf-8")  # Force UTF-8 for I/O

# Also set locale to UTF-8 for psycopg2
import locale
try:
    locale.setlocale(locale.LC_ALL, '')  # Use system default
    # Then force UTF-8 for various categories
    for category in [locale.LC_CTYPE, locale.LC_COLLATE]:
        try:
            locale.setlocale(category, 'en_US.UTF-8')
        except locale.Error:
            try:
                locale.setlocale(category, 'C.UTF-8')
            except locale.Error:
                pass  # Fallback to system default
except Exception:
    pass  # Silently ignore locale errors, will log later

from app.core.config import settings
from app.core.interfaces import (
    ConfigurationError,
    ConnectionError,
    DatabaseException,
    DatabaseProvider,
    DatabaseSession,
    QueryError,
    TransactionError,
    UnitOfWork,
)

logger = logging.getLogger(__name__)
logger.debug("Database factory initialized with UTF-8 encoding fixes for Korean Windows")

# Create Base for SQLAlchemy models
Base = declarative_base()


def retry_on_database_error(max_retries: int = 3, delay: float = 1.0):
    """Decorator for retrying database operations on failure"""
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            last_exception = None
            
            for attempt in range(max_retries):
                try:
                    return func(*args, **kwargs)
                except Exception as e:
                    last_exception = e
                    if attempt < max_retries - 1:
                        logger.warning(f"Database operation failed (attempt {attempt + 1}/{max_retries}): {e}")
                        time.sleep(delay * (2 ** attempt))  # Exponential backoff
                    else:
                        logger.error(f"Database operation failed after {max_retries} attempts: {e}")
                        logger.error(traceback.format_exc())
            
            raise DatabaseException(f"Operation failed after {max_retries} attempts", last_exception)
        return wrapper
    return decorator


class SQLAlchemySession(DatabaseSession):
    """SQLAlchemy session wrapper implementing DatabaseSession interface"""
    
    def __init__(self, session: Session):
        self._session = session
        self._closed = False
    
    def __enter__(self):
        """Enter context manager"""
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        """Exit context manager with automatic cleanup"""
        try:
            if exc_type is not None:
                self.rollback()
            else:
                self.commit()
        except Exception as e:
            logger.error(f"Error during session cleanup: {e}")
        finally:
            self.close()
    
    def commit(self):
        """Commit the current transaction"""
        if not self._closed:
            self._session.commit()
    
    def rollback(self):
        """Rollback the current transaction"""
        if not self._closed:
            self._session.rollback()
    
    def close(self):
        """Close the session"""
        if not self._closed:
            self._session.close()
            self._closed = True
    
    def flush(self):
        """Flush pending changes to database"""
        if not self._closed:
            self._session.flush()
    
    def add(self, instance):
        """Add instance to session"""
        if not self._closed:
            self._session.add(instance)
    
    def query(self, *args, **kwargs):
        """Query the database"""
        if self._closed:
            raise DatabaseException("Session is closed")
        return self._session.query(*args, **kwargs)
    
    def delete(self, instance):
        """Delete instance from session"""
        if not self._closed:
            self._session.delete(instance)
    
    def refresh(self, instance):
        """Refresh instance from database"""
        if not self._closed:
            self._session.refresh(instance)

    def expire(self, instance, attribute_names=None):
        """Expire instance attributes to force reload from database"""
        if not self._closed:
            self._session.expire(instance, attribute_names)

    def expire_all(self):
        """Expire all instances in the session to force reload from database"""
        if not self._closed:
            self._session.expire_all()

    def execute(self, statement, parameters=None, execution_options=None):
        """Execute a SQL statement"""
        if self._closed:
            raise DatabaseException("Session is closed")
        return self._session.execute(statement, params=parameters, execution_options=execution_options)

    @property
    def is_closed(self) -> bool:
        """Check if session is closed"""
        return self._closed


class SupabaseSession(DatabaseSession):
    """Supabase client wrapper implementing DatabaseSession interface"""
    
    def __init__(self, client: Client):
        self._client = client
        self._closed = False
    
    def __enter__(self):
        """Enter context manager"""
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        """Exit context manager with automatic cleanup"""
        try:
            if exc_type is not None:
                self.rollback()
            else:
                self.commit()
        except Exception as e:
            logger.error(f"Error during Supabase session cleanup: {e}")
        finally:
            self.close()
    
    def commit(self):
        """Supabase auto-commits"""
        pass
    
    def rollback(self):
        """Supabase doesn't support transactions"""
        logger.warning("Supabase doesn't support rollback operations")
    
    def close(self):
        """Supabase client doesn't need explicit closing"""
        self._closed = True
    
    def flush(self):
        """Supabase auto-flushes"""
        pass
    
    def table(self, table_name: str):
        """Access table"""
        if self._closed:
            raise DatabaseException("Session is closed")
        return self._client.table(table_name)
    
    @property
    def is_closed(self) -> bool:
        """Check if session is closed"""
        return self._closed


class SQLAlchemyUnitOfWork(UnitOfWork):
    """Unit of Work implementation for SQLAlchemy"""
    
    def __init__(self, session_factory: sessionmaker):
        self.session_factory = session_factory
        self.session = None
        self._repositories = {}
    
    def __enter__(self):
        self.session = SQLAlchemySession(self.session_factory())
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        try:
            if exc_type is not None:
                self.rollback()
            else:
                try:
                    self.commit()
                except Exception as e:
                    self.rollback()
                    raise TransactionError("Failed to commit transaction", e)
        finally:
            if self.session:
                self.session.close()
    
    def commit(self):
        """Commit all changes in the transaction"""
        if self.session:
            self.session.commit()
    
    def rollback(self):
        """Rollback all changes in the transaction"""
        if self.session:
            self.session.rollback()
    
    def get_repository(self, repository_type: str):
        """Get repository instance within this unit of work"""
        from app.repositories import (
            get_company_repository,
            get_estimate_repository,
            get_invoice_repository,
            get_plumber_report_repository,
        )
        
        if repository_type not in self._repositories:
            if repository_type == 'company':
                self._repositories[repository_type] = get_company_repository(self.session)
            elif repository_type == 'invoice':
                self._repositories[repository_type] = get_invoice_repository(self.session)
            elif repository_type == 'estimate':
                self._repositories[repository_type] = get_estimate_repository(self.session)
            elif repository_type == 'plumber_report':
                self._repositories[repository_type] = get_plumber_report_repository(self.session)
            else:
                raise ValueError(f"Unknown repository type: {repository_type}")
        
        return self._repositories[repository_type]


class SQLiteDatabase(DatabaseProvider):
    """SQLite database implementation with connection pooling"""
    
    def __init__(self, database_url: str = None):
        self.database_url = database_url or f"sqlite:///./{settings.SQLITE_DB_PATH}"
        self._lock = threading.Lock()
        
        # Configure engine with connection pooling
        self.engine = create_engine(
            self.database_url,
            connect_args={
                "check_same_thread": False,
                "timeout": 20,
                "isolation_level": None  # Use autocommit mode
            },
            poolclass=NullPool,  # SQLite doesn't support connection pooling well
            echo=settings.DEBUG,
            future=True
        )
        
        self.SessionLocal = sessionmaker(
            autocommit=False, 
            autoflush=False, 
            bind=self.engine,
            expire_on_commit=False
        )
        
        logger.info(f"SQLite database initialized: {self.database_url}")
        
        # Set up connection event listeners
        self._setup_connection_events()
    
    def _setup_connection_events(self):
        """Set up SQLite-specific connection events"""
        @event.listens_for(self.engine, "connect")
        def set_sqlite_pragma(dbapi_connection, connection_record):
            """Set SQLite pragmas for better performance and reliability"""
            cursor = dbapi_connection.cursor()
            # Enable foreign keys
            cursor.execute("PRAGMA foreign_keys=ON")
            # Enable WAL mode for better concurrency
            cursor.execute("PRAGMA journal_mode=WAL")
            # Set synchronous mode for better performance
            cursor.execute("PRAGMA synchronous=NORMAL")
            # Set cache size (in KB)
            cursor.execute("PRAGMA cache_size=10000")
            # Set temp store to memory
            cursor.execute("PRAGMA temp_store=MEMORY")
            cursor.close()
    
    @retry_on_database_error(max_retries=3)
    def get_session(self) -> DatabaseSession:
        """Get SQLAlchemy session with retry logic"""
        try:
            raw_session = self.SessionLocal()
            return SQLAlchemySession(raw_session)
        except Exception as e:
            logger.error(f"Failed to create SQLite session: {e}")
            raise ConnectionError("Failed to connect to SQLite database", e)

    @retry_on_database_error(max_retries=3)
    def get_readonly_session(self) -> DatabaseSession:
        """Get read-only SQLAlchemy session with autocommit for SELECT queries"""
        try:
            # Create session with autocommit for read-only operations
            raw_session = self.SessionLocal()
            raw_session.connection(execution_options={"autocommit": True})
            return SQLAlchemySession(raw_session)
        except Exception as e:
            logger.error(f"Failed to create read-only SQLite session: {e}")
            raise ConnectionError("Failed to connect to SQLite database", e)
    
    @contextmanager
    def get_unit_of_work(self) -> SQLAlchemyUnitOfWork:
        """Get Unit of Work for transaction management"""
        with SQLAlchemyUnitOfWork(self.SessionLocal) as uow:
            yield uow
    
    def close(self):
        """Close database engine"""
        try:
            self.engine.dispose()
            logger.info("SQLite database connection closed")
        except Exception as e:
            logger.error(f"Error closing SQLite database: {e}")
    
    def init_database(self):
        """Create all tables if they don't exist"""
        try:
            # Import all models to ensure they are registered with Base
            from sqlalchemy import inspect

            import app.domains.analytics.models  # Analytics models (API usage logs)
            import app.domains.auth.models
            import app.domains.company.models
            import app.domains.credit.models
            import app.domains.document.models
            import app.domains.document_types.models
            import app.domains.estimate.models
            import app.domains.file.models  # File management 모델 추가
            import app.domains.invoice.models
            import app.domains.line_items.category_models  # Line Item Categories 모델 추가
            import app.domains.line_items.models  # Line Items 모델 추가
            import app.domains.payment.models
            import app.domains.payment_config.models  # Payment config (payment_frequencies) 모델 추가
            import app.domains.plumber_report.models
            import app.domains.staff.models
            import app.domains.work_order.models
            
            # Check if tables already exist
            inspector = inspect(self.engine)
            existing_tables = inspector.get_table_names()
            
            # Only create tables if they don't exist
            # PERFORMANCE: Skip create_all if tables exist - only create for fresh databases
            if not existing_tables:
                Base.metadata.create_all(bind=self.engine)
                logger.info("SQLite tables created successfully")
            else:
                logger.info(f"SQLite tables already exist ({len(existing_tables)} tables). Skipping create_all.")
        except Exception as e:
            logger.error(f"Failed to initialize SQLite database: {e}")
            raise ConfigurationError("Failed to initialize database", e)
    
    @retry_on_database_error(max_retries=2)
    def health_check(self) -> bool:
        """Check if SQLite database is healthy"""
        try:
            with self.get_session() as session:
                # Execute a simple query to test the connection
                result = session._session.execute(text("SELECT 1"))
                result.fetchone()
            return True
        except Exception as e:
            logger.error(f"SQLite health check failed: {e}")
            return False
    
    @property
    def provider_name(self) -> str:
        """Name of the database provider"""
        return "sqlite"


class PostgreSQLDatabase(DatabaseProvider):
    """PostgreSQL database implementation with connection pooling"""
    
    def __init__(self, database_url: str):
        # Fix for Korean Windows: Ensure database_url is properly encoded as UTF-8 string
        if isinstance(database_url, bytes):
            try:
                database_url = database_url.decode('utf-8')
            except UnicodeDecodeError:
                # Try to decode with error handling
                database_url = database_url.decode('utf-8', errors='replace')
        
        # Remove any BOM or invalid characters
        database_url = database_url.strip().strip('\ufeff')
        
        # Ensure it's a valid string
        if not isinstance(database_url, str):
            database_url = str(database_url)
        
        self.database_url = database_url
        self._lock = threading.Lock()
        
        # Configure engine with connection pooling using config values
        # Render/NeonDB compatibility: Use smaller pool sizes to avoid connection limits
        # Korean Windows fix: Force UTF-8 encoding to avoid CP949/EUC-KR issues
        try:
            # NeonDB free tier: Databases auto-suspend after 5 minutes of inactivity
            # First connection attempt may take 15-30 seconds to wake up the database
            # Increase timeout to accommodate cold starts
            connect_timeout = 30 if "neon.tech" in self.database_url else 10

            self.engine = create_engine(
                self.database_url,
                poolclass=QueuePool,
                pool_size=settings.DB_POOL_SIZE,
                max_overflow=settings.DB_MAX_OVERFLOW,
                pool_pre_ping=True,  # Verify connections before using
                pool_recycle=settings.DB_POOL_RECYCLE,  # Recycle connections to prevent stale connections
                pool_timeout=settings.DB_POOL_TIMEOUT,  # Timeout for getting connection from pool
                echo=settings.DEBUG,
                future=True,
                connect_args={
                    "client_encoding": "utf8",  # Fix for Korean Windows encoding
                    "connect_timeout": connect_timeout,  # Longer timeout for NeonDB cold starts
                    "options": f"-c statement_timeout={settings.DB_QUERY_TIMEOUT * 1000} -c client_encoding=UTF8"  # Force UTF-8
                }
            )

            logger.info(f"PostgreSQL engine created with connect_timeout={connect_timeout}s (NeonDB cold start aware)")
        except UnicodeDecodeError as e:
            logger.error(f"Unicode decode error when creating database engine: {e}")
            logger.error(f"Database URL (first 100 chars): {self.database_url[:100]}")
            logger.error("This usually happens on Korean Windows with non-UTF8 system locale")
            # Try to sanitize the URL and retry
            import urllib.parse
            try:
                # Parse and reconstruct the URL to ensure proper encoding
                parsed = urllib.parse.urlparse(self.database_url)
                # Reconstruct with proper encoding
                sanitized_url = urllib.parse.urlunparse(parsed)

                connect_timeout = 30 if "neon.tech" in sanitized_url else 10

                self.engine = create_engine(
                    sanitized_url,
                    poolclass=QueuePool,
                    pool_size=settings.DB_POOL_SIZE,
                    max_overflow=settings.DB_MAX_OVERFLOW,
                    pool_pre_ping=True,
                    pool_recycle=settings.DB_POOL_RECYCLE,
                    pool_timeout=settings.DB_POOL_TIMEOUT,
                    echo=settings.DEBUG,
                    future=True,
                    connect_args={
                        "client_encoding": "utf8",
                        "connect_timeout": connect_timeout,
                        "options": f"-c statement_timeout={settings.DB_QUERY_TIMEOUT * 1000} -c client_encoding=UTF8"
                    }
                )
                self.database_url = sanitized_url
                logger.info("Database engine created successfully after URL sanitization")
            except Exception as e2:
                logger.error(f"Failed to sanitize and recreate database URL: {e2}")
                logger.error("Please check: 1) NeonDB is active, 2) Network allows outbound port 5432, 3) Windows locale is UTF-8")
                raise
        
        self.SessionLocal = sessionmaker(
            autocommit=False, 
            autoflush=False, 
            bind=self.engine,
            expire_on_commit=False
        )
        
        # Log pool configuration for debugging
        max_connections = settings.DB_POOL_SIZE + settings.DB_MAX_OVERFLOW
        logger.info(
            f"PostgreSQL database initialized: {self.database_url} "
            f"(pool_size={settings.DB_POOL_SIZE}, max_overflow={settings.DB_MAX_OVERFLOW}, "
            f"max_connections={max_connections})"
        )
    
    @retry_on_database_error(max_retries=1)  # Reduced retries for faster failure
    def get_session(self) -> DatabaseSession:
        """Get SQLAlchemy session with retry logic"""
        try:
            logger.debug("Creating new PostgreSQL session")
            # SessionLocal() doesn't actually connect - connection happens on first query
            # But we can test the connection pool availability
            raw_session = self.SessionLocal()
            logger.debug("PostgreSQL session created successfully")
            
            # Lazy initialization: ensure tables exist on first use
            # This handles cases where DB was unavailable at server startup
            # Only if DB_AUTO_INIT is enabled
            if settings.DB_AUTO_INIT and not hasattr(self, '_tables_initialized'):
                try:
                    self.init_database()
                    self._tables_initialized = True
                except Exception as init_error:
                    # Log but don't fail - tables might already exist
                    logger.debug(f"Table initialization check: {init_error}")
                    self._tables_initialized = True  # Mark as attempted
            
            return SQLAlchemySession(raw_session)
        except Exception as e:
            logger.error(f"Failed to create PostgreSQL session: {e}")
            logger.error(traceback.format_exc())
            # Don't raise ConnectionError - let it be handled by get_db()
            raise

    @retry_on_database_error(max_retries=3)
    def get_readonly_session(self) -> DatabaseSession:
        """Get read-only SQLAlchemy session with autocommit for SELECT queries"""
        try:
            # Create session with autocommit for read-only operations
            raw_session = self.SessionLocal()
            raw_session.connection(execution_options={"autocommit": True})
            return SQLAlchemySession(raw_session)
        except Exception as e:
            logger.error(f"Failed to create read-only PostgreSQL session: {e}")
            raise ConnectionError("Failed to connect to PostgreSQL database", e)
    
    @contextmanager
    def get_unit_of_work(self) -> SQLAlchemyUnitOfWork:
        """Get Unit of Work for transaction management"""
        with SQLAlchemyUnitOfWork(self.SessionLocal) as uow:
            yield uow
    
    def close(self):
        """Close database engine"""
        try:
            self.engine.dispose()
            logger.info("PostgreSQL database connection closed")
        except Exception as e:
            logger.error(f"Error closing PostgreSQL database: {e}")
    
    def init_database(self):
        """Create all tables if they don't exist"""
        try:
            # Import all models to ensure they are registered with Base - PostgreSQL 전용
            from sqlalchemy import inspect

            import app.domains.analytics.models  # Analytics models (API usage logs)
            import app.domains.auth.models
            import app.domains.company.models
            import app.domains.credit.models
            import app.domains.document.models
            import app.domains.document_types.models
            import app.domains.estimate.models
            import app.domains.file.models  # File management 모델 추가
            import app.domains.invoice.models
            import app.domains.line_items.category_models  # Line Item Categories 모델 추가
            import app.domains.line_items.models  # Line Items 모델 추가
            import app.domains.payment.models
            import app.domains.payment_config.models  # 추가 - PaymentMethod 테이블을 위해 필요
            import app.domains.plumber_report.models
            import app.domains.staff.models
            import app.domains.work_order.models
            
            # Check if tables already exist with timeout
            try:
                inspector = inspect(self.engine)
                existing_tables = inspector.get_table_names()
            except Exception as inspect_error:
                logger.warning(
                    f"Could not inspect database tables (connection may be unavailable): "
                    f"{inspect_error}"
                )
                # If we can't inspect, try to create tables anyway (checkfirst will handle it)
                existing_tables = []
            
            # Only create tables if they don't exist
            # PERFORMANCE: Skip create_all if tables exist - use Alembic for migrations
            # create_all with checkfirst=True causes 50+ table existence checks (~15 seconds on remote DB)
            if not existing_tables:
                Base.metadata.create_all(bind=self.engine)
                logger.info("PostgreSQL tables created successfully")
            else:
                logger.info(f"PostgreSQL tables already exist ({len(existing_tables)} tables). Skipping create_all.")
                # DISABLED: This was causing 15+ second delays on remote databases
                # Use Alembic migrations instead: alembic upgrade head
                # Base.metadata.create_all(bind=self.engine, checkfirst=True)
        except Exception as e:
            logger.error(f"Failed to initialize PostgreSQL database: {e}")
            # Don't raise - let it fail gracefully so server can still start
            # The error will be logged and can be retried later
            # Just log the error and return - don't raise exception
            logger.warning(
                "Database initialization will be retried on first connection. "
                "Server will continue to start."
            )
    
    @retry_on_database_error(max_retries=2)
    def health_check(self) -> bool:
        """Check if PostgreSQL database is healthy"""
        try:
            with self.get_session() as session:
                # Execute a simple query to test the connection
                result = session._session.execute(text("SELECT 1"))
                result.fetchone()
            logger.debug("PostgreSQL health check passed")
            return True
        except Exception as e:
            logger.error(f"PostgreSQL health check failed: {e}")
            if "UnicodeDecodeError" in str(e) or "utf-8" in str(e).lower():
                logger.error("UTF-8 encoding issue detected. Consider moving project to ASCII-only path (e.g., C:\\dev\\mjestimate\\)")
            elif "timeout" in str(e).lower():
                logger.error("Connection timeout - NeonDB may be sleeping (free tier auto-suspends after 5min). First connection takes 15-30s to wake up.")
            return False
    
    @property
    def provider_name(self) -> str:
        """Name of the database provider"""
        return "postgresql"


class SupabaseDatabase(DatabaseProvider):
    """Supabase database implementation with connection management"""
    
    def __init__(self, url: str, key: str):
        self.url = url
        self.key = key
        self._clients = {}
        self._lock = threading.Lock()
        
        # Create default client
        self.client = self._create_client()
        logger.info("Supabase client initialized")
    
    def _create_client(self) -> Client:
        """Create a new Supabase client"""
        try:
            return create_client(self.url, self.key)
        except Exception as e:
            logger.error(f"Failed to create Supabase client: {e}")
            raise ConnectionError("Failed to connect to Supabase", e)
    
    @retry_on_database_error(max_retries=3)
    def get_session(self) -> DatabaseSession:
        """Get Supabase client session"""
        try:
            # For thread safety, we could create per-thread clients
            thread_id = threading.get_ident()
            
            with self._lock:
                if thread_id not in self._clients:
                    self._clients[thread_id] = self._create_client()
                
                return SupabaseSession(self._clients[thread_id])
        except Exception as e:
            logger.error(f"Failed to create Supabase session: {e}")
            raise ConnectionError("Failed to connect to Supabase", e)
    
    def close(self):
        """Close all Supabase clients"""
        with self._lock:
            self._clients.clear()
        logger.info("Supabase clients cleared")
    
    def init_database(self):
        """Supabase tables should be created via Supabase dashboard or migrations"""
        logger.info("Supabase database ready (tables should be created via dashboard)")
    
    @retry_on_database_error(max_retries=2)
    def health_check(self) -> bool:
        """Check if Supabase database is healthy"""
        try:
            with self.get_session() as session:
                # Try to query a system table
                response = session.table('companies').select('id').limit(1).execute()
                return True
        except Exception as e:
            logger.error(f"Supabase health check failed: {e}")
            return False
    
    @property
    def provider_name(self) -> str:
        """Name of the database provider"""
        return "supabase"


class DatabaseFactory:
    """Factory class to create appropriate database instance with comprehensive features"""
    
    _instance = None
    _database = None
    _lock = threading.Lock()
    
    def __new__(cls):
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
        return cls._instance
    
    @classmethod
    def create_database(cls, db_type: str = None) -> DatabaseProvider:
        """
        Create database instance based on type
        
        Args:
            db_type: Type of database ('sqlite', 'postgresql', 'supabase')
                    If None, will be determined from settings
        
        Returns:
            DatabaseProvider instance
        
        Raises:
            ConfigurationError: If configuration is invalid
            ConnectionError: If unable to connect to database
        """
        with cls._lock:
            if cls._database is not None:
                return cls._database
            
            # Determine database type from settings if not provided
            if db_type is None:
                db_type = cls._determine_db_type()
            
            # Validate configuration
            cls._validate_configuration(db_type)
            
            # Create appropriate database instance
            try:
                if db_type == "sqlite":
                    cls._database = SQLiteDatabase()
                elif db_type == "postgresql":
                    cls._database = PostgreSQLDatabase(settings.DATABASE_URL)
                elif db_type == "supabase":
                    cls._database = SupabaseDatabase(settings.SUPABASE_URL, settings.SUPABASE_KEY)
                else:
                    raise ValueError(f"Unsupported database type: {db_type}")
                
                # Initialize database (optional - controlled by DB_AUTO_INIT setting)
                # Skip if DB_AUTO_INIT=false (useful when using migrations like Alembic)
                if settings.DB_AUTO_INIT:
                    try:
                        cls._database.init_database()
                        logger.info(f"Database tables initialized successfully")
                    except Exception as init_error:
                        logger.warning(
                            f"Database initialization failed (will retry on first use): "
                            f"{init_error}"
                        )
                        logger.warning(
                            "Server will continue to start. Database will be initialized "
                            "on first connection attempt."
                        )
                else:
                    logger.info(
                        "Database auto-initialization disabled (DB_AUTO_INIT=false). "
                        "Using migrations or manual table creation."
                    )
                
                # Perform health check (non-blocking)
                try:
                    if not cls._database.health_check():
                        logger.warning(
                            f"{db_type} database health check failed. "
                            "Will retry on first use."
                        )
                except Exception as health_error:
                    logger.warning(
                        f"Database health check failed (will retry on first use): "
                        f"{health_error}"
                    )
                
                logger.info(f"Database factory created {db_type} database successfully")
                return cls._database
                
            except Exception as e:
                logger.error(f"Failed to create {db_type} database: {e}")
                cls._database = None
                raise ConfigurationError(f"Failed to create {db_type} database", e)
    
    @classmethod
    def _determine_db_type(cls) -> str:
        """Determine database type from settings"""
        # Priority order: explicit DATABASE_TYPE > DATABASE_URL detection > environment defaults
        if hasattr(settings, 'DATABASE_TYPE') and settings.DATABASE_TYPE:
            db_type = settings.DATABASE_TYPE.lower()
            logger.info(f"Using explicit DATABASE_TYPE: {db_type}")
            return db_type

        if settings.DATABASE_URL:
            if "postgresql" in settings.DATABASE_URL.lower() or "postgres" in settings.DATABASE_URL.lower():
                logger.info("Detected PostgreSQL from DATABASE_URL")
                return "postgresql"
            elif "sqlite" in settings.DATABASE_URL.lower():
                logger.info("Detected SQLite from DATABASE_URL")
                return "sqlite"
            else:
                logger.warning(f"Unknown database URL format: {settings.DATABASE_URL}")

        # Environment-based logic - PostgreSQL is now default for development
        if settings.ENVIRONMENT == "development":
            # Default to PostgreSQL for development (Docker PostgreSQL)
            # Only use SQLite if explicitly enabled
            if hasattr(settings, 'USE_SQLITE') and settings.USE_SQLITE:
                logger.info("USE_SQLITE=true in development, using SQLite")
                return "sqlite"
            logger.info("Development environment: defaulting to PostgreSQL (Docker)")
            return "postgresql"
        elif settings.SUPABASE_URL and settings.SUPABASE_KEY:
            logger.info("Production environment: using Supabase")
            return "supabase"
        else:
            logger.warning("No database configuration found, defaulting to PostgreSQL")
            return "postgresql"
    
    @classmethod
    def _validate_configuration(cls, db_type: str):
        """Validate database configuration"""
        if db_type == "postgresql":
            if not settings.DATABASE_URL:
                raise ConfigurationError("DATABASE_URL required for PostgreSQL")
            if not settings.DATABASE_URL.startswith(('postgresql://', 'postgres://')):
                raise ConfigurationError("Invalid PostgreSQL DATABASE_URL format")
        
        elif db_type == "supabase":
            if not settings.SUPABASE_URL or not settings.SUPABASE_KEY:
                raise ConfigurationError("SUPABASE_URL and SUPABASE_KEY required for Supabase")
            if not settings.SUPABASE_URL.startswith('http'):
                raise ConfigurationError("Invalid SUPABASE_URL format")
    
    @classmethod
    def get_database(cls) -> DatabaseProvider:
        """Get current database instance"""
        if cls._database is None:
            cls._database = cls.create_database()
        return cls._database
    
    @classmethod
    def reset(cls):
        """Reset database instance (useful for testing)"""
        with cls._lock:
            if cls._database:
                try:
                    cls._database.close()
                except Exception as e:
                    logger.error(f"Error closing database during reset: {e}")
            cls._database = None
    
    @classmethod
    def get_database_info(cls) -> Dict[str, Any]:
        """Get information about current database configuration"""
        db = cls.get_database()
        return {
            "provider": db.provider_name,
            "healthy": db.health_check(),
            "environment": settings.ENVIRONMENT,
            "timestamp": datetime.utcnow().isoformat()
        }


# Create global database factory instance
db_factory = DatabaseFactory()


def get_database() -> DatabaseProvider:
    """Get database instance for dependency injection"""
    return db_factory.get_database()


@contextmanager
def get_database_session():
    """Context manager for database sessions with automatic cleanup"""
    database = get_database()
    session = database.get_session()

    try:
        yield session
        if hasattr(session, 'commit'):
            session.commit()
    except Exception as e:
        if hasattr(session, 'rollback'):
            session.rollback()

        # Only log actual database/system errors, not HTTP exceptions like 401/403
        from fastapi import HTTPException
        if not isinstance(e, HTTPException):
            logger.error(f"Database session error: {e}")

        raise
    finally:
        session.close()


def get_db():
    """Get database session for FastAPI dependency injection"""
    logger.debug("get_db: Getting database instance")
    try:
        database = get_database()
        logger.debug("get_db: Getting database session")
        session = database.get_session()
        logger.debug("get_db: Database session obtained")
    except Exception as db_error:
        logger.error(f"get_db: Failed to get database session: {db_error}")
        from fastapi import HTTPException
        raise HTTPException(
            status_code=503,
            detail="Database service temporarily unavailable. Please try again later."
        )
    
    try:
        yield session
        # Commit the transaction if no errors occurred
        logger.debug("get_db: Committing transaction")
        if hasattr(session, 'commit'):
            session.commit()
        logger.debug("get_db: Transaction committed")
    except Exception as e:
        logger.error(f"get_db: Exception occurred: {type(e).__name__}: {e}")
        if hasattr(session, 'rollback'):
            logger.debug("get_db: Rolling back transaction")
            try:
                session.rollback()
            except Exception as rollback_error:
                logger.error(f"get_db: Rollback failed: {rollback_error}")

        # Only log actual database/system errors, not HTTP exceptions like 401/403
        from fastapi import HTTPException
        if not isinstance(e, HTTPException):
            logger.error(f"Database session error: {e}")
            # Check if it's a connection timeout error
            error_str = str(e).lower()
            if 'timeout' in error_str or 'connection' in error_str:
                raise HTTPException(
                    status_code=503,
                    detail="Database connection timeout. Please try again later."
                )
            logger.error(traceback.format_exc())

        raise
    finally:
        logger.debug("get_db: Closing session")
        try:
            session.close()
            logger.debug("get_db: Session closed")
        except Exception as close_error:
            logger.error(f"get_db: Error closing session: {close_error}")

# Alias for backward compatibility
get_db_session = get_db