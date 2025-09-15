"""
Core interfaces and abstract base classes for the database abstraction layer.
This module defines the contracts that all database implementations must follow.
"""

from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional, TypeVar, Generic, Union, Tuple
from datetime import datetime
from contextlib import asynccontextmanager
import logging

# Type variables for generic repository classes
T = TypeVar('T')  # Entity type
ID = TypeVar('ID')  # ID type

logger = logging.getLogger(__name__)


class DatabaseSession(ABC):
    """Abstract database session interface"""
    
    @abstractmethod
    def commit(self):
        """Commit the current transaction"""
        pass
    
    @abstractmethod
    def rollback(self):
        """Rollback the current transaction"""
        pass
    
    @abstractmethod
    def close(self):
        """Close the session"""
        pass
    
    @abstractmethod
    def flush(self):
        """Flush pending changes to database"""
        pass


class DatabaseProvider(ABC):
    """Abstract database provider interface"""
    
    @abstractmethod
    def get_session(self) -> DatabaseSession:
        """Get a database session"""
        pass
    
    @abstractmethod
    def close(self):
        """Close database connections"""
        pass
    
    @abstractmethod
    def init_database(self):
        """Initialize database (create tables, etc.)"""
        pass
    
    @abstractmethod
    def health_check(self) -> bool:
        """Check if database is healthy and accessible"""
        pass
    
    @property
    @abstractmethod
    def provider_name(self) -> str:
        """Name of the database provider"""
        pass


class Repository(Generic[T, ID], ABC):
    """
    Abstract base repository class providing CRUD operations.
    All concrete repositories must implement these methods.
    """
    
    def __init__(self, session: DatabaseSession):
        self.session = session
    
    @abstractmethod
    def create(self, entity_data: Dict[str, Any]) -> T:
        """Create a new entity"""
        pass
    
    @abstractmethod
    def get_by_id(self, entity_id: ID) -> Optional[T]:
        """Get entity by ID"""
        pass
    
    @abstractmethod
    def get_all(self, 
                filters: Optional[Dict[str, Any]] = None,
                order_by: Optional[str] = None,
                limit: Optional[int] = None,
                offset: Optional[int] = None) -> List[T]:
        """Get all entities with optional filters and pagination"""
        pass
    
    @abstractmethod
    def update(self, entity_id: ID, update_data: Dict[str, Any]) -> Optional[T]:
        """Update entity by ID"""
        pass
    
    @abstractmethod
    def delete(self, entity_id: ID) -> bool:
        """Delete entity by ID"""
        pass
    
    @abstractmethod
    def exists(self, entity_id: ID) -> bool:
        """Check if entity exists"""
        pass
    
    @abstractmethod
    def count(self, filters: Optional[Dict[str, Any]] = None) -> int:
        """Count entities with optional filters"""
        pass
    
    def bulk_create(self, entities_data: List[Dict[str, Any]]) -> List[T]:
        """Create multiple entities (default implementation)"""
        return [self.create(data) for data in entities_data]
    
    def bulk_update(self, updates: List[Tuple[ID, Dict[str, Any]]]) -> List[T]:
        """Update multiple entities (default implementation)"""
        results = []
        for entity_id, update_data in updates:
            result = self.update(entity_id, update_data)
            if result:
                results.append(result)
        return results
    
    def bulk_delete(self, entity_ids: List[ID]) -> int:
        """Delete multiple entities (default implementation)"""
        deleted_count = 0
        for entity_id in entity_ids:
            if self.delete(entity_id):
                deleted_count += 1
        return deleted_count


class ServiceInterface(ABC):
    """
    Abstract base service interface.
    Services contain business logic and orchestrate repository operations.
    """
    
    @abstractmethod
    def get_repository(self) -> Repository:
        """Get the repository used by this service"""
        pass


class UnitOfWork(ABC):
    """
    Abstract Unit of Work pattern implementation.
    Coordinates multiple repository operations within a single transaction.
    """
    
    @abstractmethod
    def __enter__(self):
        """Enter transaction context"""
        pass
    
    @abstractmethod
    def __exit__(self, exc_type, exc_val, exc_tb):
        """Exit transaction context"""
        pass
    
    @abstractmethod
    def commit(self):
        """Commit all changes in the transaction"""
        pass
    
    @abstractmethod
    def rollback(self):
        """Rollback all changes in the transaction"""
        pass
    
    @abstractmethod
    def get_repository(self, repository_type: str) -> Repository:
        """Get repository instance within this unit of work"""
        pass


class CacheInterface(ABC):
    """Abstract cache interface for query result caching"""
    
    @abstractmethod
    def get(self, key: str) -> Optional[Any]:
        """Get value from cache"""
        pass
    
    @abstractmethod
    def set(self, key: str, value: Any, ttl: Optional[int] = None):
        """Set value in cache with optional TTL"""
        pass
    
    @abstractmethod
    def delete(self, key: str):
        """Delete key from cache"""
        pass
    
    @abstractmethod
    def clear(self):
        """Clear all cache entries"""
        pass
    
    @abstractmethod
    def exists(self, key: str) -> bool:
        """Check if key exists in cache"""
        pass


class QueryBuilder(ABC):
    """Abstract query builder interface for database-agnostic queries"""
    
    @abstractmethod
    def select(self, columns: Optional[List[str]] = None) -> 'QueryBuilder':
        """Select specific columns"""
        pass
    
    @abstractmethod
    def where(self, condition: str, value: Any) -> 'QueryBuilder':
        """Add WHERE condition"""
        pass
    
    @abstractmethod
    def order_by(self, column: str, descending: bool = False) -> 'QueryBuilder':
        """Add ORDER BY clause"""
        pass
    
    @abstractmethod
    def limit(self, count: int) -> 'QueryBuilder':
        """Add LIMIT clause"""
        pass
    
    @abstractmethod
    def offset(self, count: int) -> 'QueryBuilder':
        """Add OFFSET clause"""
        pass
    
    @abstractmethod
    def join(self, table: str, condition: str) -> 'QueryBuilder':
        """Add JOIN clause"""
        pass
    
    @abstractmethod
    def execute(self) -> List[Dict[str, Any]]:
        """Execute the query and return results"""
        pass


class MigrationInterface(ABC):
    """Interface for database migrations"""
    
    @abstractmethod
    def create_migration(self, name: str, up_sql: str, down_sql: str):
        """Create a new migration"""
        pass
    
    @abstractmethod
    def apply_migrations(self):
        """Apply pending migrations"""
        pass
    
    @abstractmethod
    def rollback_migration(self, version: str):
        """Rollback to a specific migration version"""
        pass
    
    @abstractmethod
    def get_current_version(self) -> str:
        """Get current migration version"""
        pass


class ConnectionPool(ABC):
    """Abstract connection pool interface"""
    
    @abstractmethod
    def get_connection(self):
        """Get connection from pool"""
        pass
    
    @abstractmethod
    def return_connection(self, connection):
        """Return connection to pool"""
        pass
    
    @abstractmethod
    def close_all(self):
        """Close all connections in pool"""
        pass
    
    @property
    @abstractmethod
    def active_connections(self) -> int:
        """Number of active connections"""
        pass
    
    @property
    @abstractmethod
    def available_connections(self) -> int:
        """Number of available connections"""
        pass


class DatabaseException(Exception):
    """Base exception for database operations"""
    
    def __init__(self, message: str, original_error: Optional[Exception] = None):
        super().__init__(message)
        self.original_error = original_error
        self.timestamp = datetime.utcnow()


class ConnectionError(DatabaseException):
    """Database connection related errors"""
    pass


class QueryError(DatabaseException):
    """Query execution related errors"""
    pass


class ValidationError(DatabaseException):
    """Data validation related errors"""
    pass


class TransactionError(DatabaseException):
    """Transaction related errors"""
    pass


class ConfigurationError(DatabaseException):
    """Configuration related errors"""
    pass