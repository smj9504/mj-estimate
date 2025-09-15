"""
Database type definitions for cross-database compatibility
Handles differences between SQLite and PostgreSQL/Supabase
"""

from sqlalchemy import Column, String, TypeDecorator, types
from sqlalchemy.dialects.postgresql import UUID as PostgreSQLUUID
import uuid
from app.core.config import settings


class UUIDType(TypeDecorator):
    """
    Platform-agnostic UUID type that works with both SQLite and PostgreSQL.
    - SQLite: Stores as VARCHAR(36) string with hyphens
    - PostgreSQL: Uses native UUID type
    """
    impl = String(36)
    cache_ok = True
    
    def load_dialect_impl(self, dialect):
        """Load the appropriate implementation based on the database dialect"""
        if dialect.name == 'postgresql':
            return dialect.type_descriptor(PostgreSQLUUID(as_uuid=True))
        else:
            # SQLite and others use String
            return dialect.type_descriptor(String(36))
    
    def process_bind_param(self, value, dialect):
        """Convert UUID to database format when saving"""
        if value is None:
            return value
        
        if dialect.name == 'postgresql':
            # PostgreSQL handles UUID objects natively
            if isinstance(value, str):
                return uuid.UUID(value)
            return value
        else:
            # SQLite needs string representation
            if isinstance(value, uuid.UUID):
                return str(value)
            elif isinstance(value, str):
                # Validate it's a proper UUID format
                try:
                    uuid.UUID(value)
                    return value
                except ValueError:
                    raise ValueError(f"Invalid UUID format: {value}")
            return str(value)
    
    def process_result_value(self, value, dialect):
        """Convert database value to Python UUID when loading"""
        if value is None:
            return value
        
        # Always return string for consistency
        # This ensures the application always works with string UUIDs
        if isinstance(value, uuid.UUID):
            return str(value)
        return value
    
    @property
    def python_type(self):
        return str


def get_uuid_column(**kwargs):
    """
    Create a UUID column with appropriate defaults for the current database.
    
    Usage:
        id = Column(get_uuid_column(), primary_key=True)
        foreign_id = Column(get_uuid_column(), ForeignKey("table.id"))
    """
    defaults = {
        'default': lambda: str(uuid.uuid4()),
        'nullable': False
    }
    defaults.update(kwargs)
    
    # Remove default for nullable foreign keys
    if defaults.get('nullable', False):
        defaults.pop('default', None)
    
    return UUIDType()


def generate_uuid() -> str:
    """Generate a new UUID string"""
    return str(uuid.uuid4())


# For backward compatibility
if settings.USE_SQLITE:
    # SQLite uses String
    UUID = UUIDType
else:
    # PostgreSQL can use native UUID
    UUID = UUIDType