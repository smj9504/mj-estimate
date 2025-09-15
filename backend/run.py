#!/usr/bin/env python
"""
Unified server runner - automatically detects environment from .env
Replaces: run_dev.py, run_prod.py, run_server.py, run_with_admin.py
"""

import os
import uvicorn
import logging
from pathlib import Path
from dotenv import load_dotenv

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def load_environment():
    """Load environment from environment-specific .env files"""
    # Get environment from system env or default to development
    environment = os.getenv("ENVIRONMENT", "development")
    
    # Load environment-specific .env file
    env_file = Path(f".env.{environment}")
    if env_file.exists():
        load_dotenv(env_file, override=True)
        logger.info(f"Loaded environment from: {env_file}")
    else:
        # Fallback to development if specific file not found
        fallback_env = Path(".env.development")
        if fallback_env.exists():
            load_dotenv(fallback_env, override=True)
            logger.info(f"Fallback to development environment: {fallback_env}")
            environment = "development"
        else:
            logger.warning("No environment file found, using system environment variables only")
    
    return environment

def get_server_config(environment: str) -> dict:
    """Get server configuration based on environment"""
    
    # Base configuration
    config = {
        "app": "app.main:app",
        "host": os.getenv("HOST", "0.0.0.0"),
        "port": int(os.getenv("PORT", "8000")),
    }
    
    if environment.lower() in ["development", "dev"]:
        # Development configuration
        config.update({
            "reload": True,
            "log_level": "debug",
            "workers": None  # Single worker for development
        })
        logger.info("Running in DEVELOPMENT mode")
        
    elif environment.lower() in ["production", "prod"]:
        # Production configuration
        config.update({
            "reload": False,
            "log_level": "info",
            "workers": int(os.getenv("WORKERS", "4"))
        })
        logger.info("Running in PRODUCTION mode")
        
    else:
        # Default to development-like settings
        config.update({
            "reload": True,
            "log_level": "info",
            "workers": None
        })
        logger.info(f"Unknown environment '{environment}', using development-like settings")
    
    return config

def initialize_admin():
    """Initialize admin interface if enabled"""
    enable_admin = os.getenv("ENABLE_ADMIN", "true").lower() == "true"
    
    if not enable_admin:
        logger.info("Admin interface disabled via ENABLE_ADMIN=false")
        return False
    
    try:
        from app.main import app
        from app.core.database_factory import get_database
        from app.admin_app import create_admin
        
        # Initialize database and admin
        database = get_database()
        if hasattr(database, 'engine'):
            # Initialize database tables
            database.init_database()
            # Create admin interface
            admin = create_admin(app, database.engine)
            logger.info("SQLAdmin initialized successfully")
            return True
        else:
            logger.warning("SQLAdmin not available - database doesn't support SQLAlchemy")
            return False
            
    except Exception as e:
        logger.error(f"Failed to initialize admin: {e}")
        return False

def print_startup_info(config: dict, admin_enabled: bool):
    """Print startup information"""
    host = config['host']
    port = config['port']
    base_url = f"http://{host}:{port}" if host != "0.0.0.0" else f"http://localhost:{port}"
    
    print("=" * 60)
    print("MJ Estimate API Server Starting")
    print("=" * 60)
    print(f"API Documentation: {base_url}/docs")
    print(f"API Root: {base_url}")
    
    if admin_enabled:
        print(f"Admin Panel: {base_url}/admin")
        print("Admin Login: username='admin', password='admin123'")
    
    environment = os.getenv("ENVIRONMENT", "development")
    print(f"Environment: {environment.upper()}")
    
    if config.get('workers') and config['workers'] > 1:
        print(f"Workers: {config['workers']}")
    
    if config.get('reload'):
        print("Auto-reload: Enabled")
    
    print("=" * 60)

def main():
    """Main entry point"""
    try:
        # Load environment
        environment = load_environment()
        
        # Get server configuration
        config = get_server_config(environment)
        
        # Initialize admin if enabled (only for development/single worker)
        admin_enabled = False
        if not config.get('workers') or config['workers'] == 1:
            admin_enabled = initialize_admin()
        else:
            logger.info("Admin interface disabled in multi-worker mode")
        
        # Print startup information
        print_startup_info(config, admin_enabled)
        
        # Start server
        uvicorn.run(**config)
        
    except KeyboardInterrupt:
        logger.info("Server stopped by user")
    except Exception as e:
        logger.error(f"Server startup failed: {e}", exc_info=True)
        exit(1)

if __name__ == "__main__":
    main()