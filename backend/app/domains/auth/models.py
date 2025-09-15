"""
User authentication models
"""
from sqlalchemy import Column, String, Boolean, DateTime, Enum as SQLEnum
from sqlalchemy.dialects.postgresql import UUID as PostgreSQLUUID
from sqlalchemy.types import TypeDecorator, CHAR
from datetime import datetime
import uuid
import enum

from app.core.database_factory import Base
from app.core.config import settings

# SQLite-compatible UUID type
class UUID(TypeDecorator):
    """Platform-independent UUID type.
    Uses PostgreSQL's UUID type when available, otherwise uses CHAR(36).
    """
    impl = CHAR
    cache_ok = True

    def load_dialect_impl(self, dialect):
        if dialect.name == 'postgresql':
            return dialect.type_descriptor(PostgreSQLUUID(as_uuid=True))
        else:
            return dialect.type_descriptor(CHAR(36))

    def process_bind_param(self, value, dialect):
        if value is None:
            return value
        elif dialect.name == 'postgresql':
            return value
        else:
            if isinstance(value, uuid.UUID):
                return str(value)
            else:
                return value

    def process_result_value(self, value, dialect):
        if value is None:
            return value
        elif dialect.name == 'postgresql':
            return value
        else:
            if not isinstance(value, uuid.UUID):
                value = uuid.UUID(value)
            return value


# Legacy User model removed - use Staff model from app.domains.staff.models instead