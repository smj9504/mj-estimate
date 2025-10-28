"""
Alembic environment configuration for MJ Estimate database migrations
"""

from logging.config import fileConfig
from sqlalchemy import engine_from_config, pool
from alembic import context
import os
import sys
from pathlib import Path
from dotenv import load_dotenv

# Add parent directory to path so we can import app modules
sys.path.append(str(Path(__file__).resolve().parents[1]))

# Load environment variables
ENVIRONMENT = os.getenv("ENVIRONMENT", "development")
env_file = Path(__file__).resolve().parents[1] / f".env.{ENVIRONMENT}"
if env_file.exists():
    load_dotenv(env_file, override=True)
else:
    load_dotenv(Path(__file__).resolve().parents[1] / ".env", override=True)

# Import Base and all models to ensure they're registered
from app.core.database_factory import Base
from app.core.config import settings

# Import all existing models
import app.domains.auth.models
import app.domains.company.models
import app.domains.invoice.models
import app.domains.estimate.models
import app.domains.document.models
import app.domains.plumber_report.models
import app.domains.document_types.models
import app.domains.work_order.models
import app.domains.payment.models
import app.domains.payment_config.models
import app.domains.credit.models
import app.domains.staff.models
import app.domains.line_items.models
import app.domains.line_items.category_models
import app.domains.file.models
import app.domains.sketch.models
import app.domains.receipt.models
import app.domains.water_mitigation.models
import app.domains.reconstruction_estimate.models

# Material detection models
import app.domains.material_detection.models

# Alembic Config
config = context.config

# Interpret the config file for Python logging
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# Set target metadata for 'autogenerate' support
target_metadata = Base.metadata

# Override sqlalchemy.url from environment
if settings.DATABASE_URL:
    config.set_main_option('sqlalchemy.url', settings.DATABASE_URL)
else:
    raise ValueError("DATABASE_URL not configured in environment")


def run_migrations_offline() -> None:
    """
    Run migrations in 'offline' mode.

    This configures the context with just a URL
    and not an Engine, though an Engine is acceptable
    here as well.  By skipping the Engine creation
    we don't even need a DBAPI to be available.

    Calls to context.execute() here emit the given string to the
    script output.
    """
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
        compare_server_default=True,
        include_schemas=False,
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """
    Run migrations in 'online' mode.

    In this scenario we need to create an Engine
    and associate a connection with the context.
    """
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
            compare_server_default=True,
            include_schemas=False,
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
