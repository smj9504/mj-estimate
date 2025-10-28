"""
Logging configuration with date-based rotation and organized file structure
"""

import logging
import logging.handlers
from datetime import datetime
from pathlib import Path
import os

from app.core.config import settings


class HealthCheckFilter(logging.Filter):
    """
    Filter out health check endpoint logs to reduce noise
    from monitoring systems (e.g., Render health checks)
    """
    def filter(self, record: logging.LogRecord) -> bool:
        # Filter out /health endpoint access logs
        message = record.getMessage()
        return '/health' not in message and 'GET /health' not in message

def setup_logging():
    """
    Setup logging system with date-based rotation
    """
    # Create logs directory
    log_dir = Path("logs")
    log_dir.mkdir(exist_ok=True)
    
    # Current date for log file naming
    current_date = datetime.now().strftime("%Y-%m-%d")
    
    # Log levels based on environment
    log_level = getattr(logging, settings.LOG_LEVEL or "INFO", logging.INFO)
    
    # Custom formatter
    formatter = logging.Formatter(
        fmt='%(asctime)s | %(levelname)-8s | %(name)-20s | %(funcName)-15s:%(lineno)-3d | %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'
    )
    
    # Root logger configuration
    root_logger = logging.getLogger()
    root_logger.setLevel(log_level)
    
    # Clear existing handlers
    root_logger.handlers.clear()
    
    # Console handler (always active)
    console_handler = logging.StreamHandler()
    console_handler.setFormatter(formatter)
    console_handler.setLevel(log_level)
    console_handler.addFilter(HealthCheckFilter())  # Filter health check logs
    root_logger.addHandler(console_handler)
    
    # File handlers (organized by type)
    handlers_config = {
        'app': {
            'filename': f'logs/app_{current_date}.log',
            'level': log_level,
            'max_bytes': 10 * 1024 * 1024,  # 10MB
            'backup_count': 5
        },
        'access': {
            'filename': f'logs/access_{current_date}.log',
            'level': logging.INFO,
            'max_bytes': 20 * 1024 * 1024,  # 20MB
            'backup_count': 10
        },
        'error': {
            'filename': f'logs/error_{current_date}.log',
            'level': logging.ERROR,
            'max_bytes': 5 * 1024 * 1024,   # 5MB
            'backup_count': 10
        },
        'debug': {
            'filename': f'logs/debug_{current_date}.log',
            'level': logging.DEBUG,
            'max_bytes': 50 * 1024 * 1024,  # 50MB
            'backup_count': 3
        }
    }
    
    # Create rotating file handlers
    for handler_name, config in handlers_config.items():
        # Only create debug logs in development
        if handler_name == 'debug' and settings.ENVIRONMENT == 'production':
            continue
            
        file_handler = logging.handlers.RotatingFileHandler(
            filename=config['filename'],
            maxBytes=config['max_bytes'],
            backupCount=config['backup_count'],
            encoding='utf-8'
        )
        file_handler.setFormatter(formatter)
        file_handler.setLevel(config['level'])
        
        # Add handler to root logger
        root_logger.addHandler(file_handler)
        
        # Create specialized loggers
        if handler_name != 'app':
            specialized_logger = logging.getLogger(handler_name)
            specialized_logger.addHandler(file_handler)
            specialized_logger.propagate = False
    
    # Database query logger (separate from general app logs)
    # SQLAlchemy 로그 레벨 설정 - 헬스체크 등 불필요한 INFO 로그 제거
    logging.getLogger('sqlalchemy.engine').setLevel(logging.WARNING)
    logging.getLogger('sqlalchemy.pool').setLevel(logging.WARNING)
    logging.getLogger('sqlalchemy.dialects').setLevel(logging.WARNING)
    logging.getLogger('sqlalchemy.orm').setLevel(logging.WARNING)

    # Suppress verbose PDF generation library logs
    # fontTools와 PIL의 DEBUG/INFO 로그 숨김 (PDF 생성 시 노이즈 제거)
    logging.getLogger('fontTools').setLevel(logging.WARNING)
    logging.getLogger('fontTools.subset').setLevel(logging.WARNING)
    logging.getLogger('fontTools.ttLib').setLevel(logging.WARNING)
    logging.getLogger('PIL').setLevel(logging.WARNING)
    logging.getLogger('PIL.PngImagePlugin').setLevel(logging.WARNING)

    # Suppress Uvicorn access logs for health checks
    uvicorn_access = logging.getLogger('uvicorn.access')
    uvicorn_access.addFilter(HealthCheckFilter())

    if log_level == logging.DEBUG:
        # 디버그 모드에서만 데이터베이스 로그 활성화 및 파일 생성
        logging.getLogger('sqlalchemy.engine').setLevel(logging.INFO)
        db_file_handler = logging.handlers.RotatingFileHandler(
            filename=f'logs/database_{current_date}.log',
            maxBytes=20 * 1024 * 1024,
            backupCount=5,
            encoding='utf-8'
        )
        db_file_handler.setFormatter(formatter)
        logging.getLogger('sqlalchemy.engine').addHandler(db_file_handler)
    
    # Application-specific loggers
    app_loggers = [
        'app.domains.auth',
        'app.domains.line_items',
        'app.domains.invoice',
        'app.domains.estimate',
        'app.core.database_factory'
    ]
    
    for logger_name in app_loggers:
        logger = logging.getLogger(logger_name)
        logger.setLevel(log_level)
    
    logging.info(f"Logging system initialized - Environment: {settings.ENVIRONMENT}, Level: {settings.LOG_LEVEL}")
    return root_logger

def get_access_logger():
    """Get access logger for API requests"""
    return logging.getLogger('access')

def get_error_logger():
    """Get error logger for application errors"""
    return logging.getLogger('error')

def get_debug_logger():
    """Get debug logger for development"""
    return logging.getLogger('debug')

def cleanup_old_logs(days_to_keep: int = 30):
    """
    Clean up log files older than specified days
    """
    log_dir = Path("logs")
    if not log_dir.exists():
        return
        
    import time
    current_time = time.time()
    cutoff_time = current_time - (days_to_keep * 24 * 60 * 60)
    
    deleted_files = []
    for log_file in log_dir.glob("*.log*"):
        if log_file.stat().st_mtime < cutoff_time:
            log_file.unlink()
            deleted_files.append(log_file.name)
    
    if deleted_files:
        logging.info(f"Cleaned up old log files: {deleted_files}")