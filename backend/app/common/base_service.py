"""
Base service classes providing business logic layer with repository abstraction.
"""

from typing import Any, Dict, List, Optional, TypeVar, Generic
from abc import ABC, abstractmethod
import logging
from datetime import datetime

from app.core.interfaces import ServiceInterface, Repository, DatabaseProvider
from app.core.database_factory import get_database

T = TypeVar('T')
ID = TypeVar('ID')

logger = logging.getLogger(__name__)


class BaseService(Generic[T, ID], ServiceInterface):
    """
    Base service class providing common business logic operations.
    All concrete services should inherit from this class.
    """
    
    def __init__(self, database: DatabaseProvider = None):
        """
        Initialize service with database provider.
        
        Args:
            database: Database provider instance. If None, uses default from factory.
        """
        self.database = database or get_database()
        self._repository = None
    
    @abstractmethod
    def get_repository(self) -> Repository:
        """Get the repository used by this service"""
        pass
    
    def get_all(self,
                filters: Optional[Dict[str, Any]] = None,
                order_by: Optional[str] = None,
                limit: Optional[int] = None,
                offset: Optional[int] = None) -> List[Dict[str, Any]]:
        """
        Get all entities with optional filtering, ordering, and pagination.
        
        Args:
            filters: Dictionary of field-value pairs to filter by
            order_by: Field to order by (prefix with '-' for descending)
            limit: Maximum number of results to return
            offset: Number of results to skip
            
        Returns:
            List of entity dictionaries
        """
        try:
            session = self.database.get_session()
            try:
                repository = self._get_repository_instance(session)
                return repository.get_all(
                    filters=filters,
                    order_by=order_by,
                    limit=limit,
                    offset=offset
                )
            finally:
                session.close()
        except Exception as e:
            logger.error(f"Error getting all {self.__class__.__name__} entities: {e}")
            raise
    
    def get_by_id(self, entity_id: ID) -> Optional[Dict[str, Any]]:
        """
        Get entity by ID.
        
        Args:
            entity_id: Unique identifier of the entity
            
        Returns:
            Entity dictionary or None if not found
        """
        try:
            session = self.database.get_session()
            try:
                repository = self._get_repository_instance(session)
                return repository.get_by_id(entity_id)
            finally:
                session.close()
        except Exception as e:
            logger.error(f"Error getting {self.__class__.__name__} by ID {entity_id}: {e}")
            # Return None instead of raising to allow graceful handling
            return None
    
    def create(self, entity_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Create a new entity.
        
        Args:
            entity_data: Dictionary containing entity data
            
        Returns:
            Created entity dictionary
        """
        try:
            session = self.database.get_session()
            try:
                repository = self._get_repository_instance(session)
                result = repository.create(entity_data)
                session.commit()
                logger.info(f"Created {self.__class__.__name__} with ID: {result.get('id')}")
                return result
            finally:
                session.close()
        except Exception as e:
            logger.error(f"Error creating {self.__class__.__name__}: {e}")
            raise
    
    def update(self, entity_id: ID, update_data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """
        Update an entity.
        
        Args:
            entity_id: Unique identifier of the entity
            update_data: Dictionary containing updated data
            
        Returns:
            Updated entity dictionary or None if not found
        """
        try:
            session = self.database.get_session()
            try:
                repository = self._get_repository_instance(session)
                result = repository.update(entity_id, update_data)
                if result:
                    session.commit()
                    logger.info(f"Updated {self.__class__.__name__} with ID: {entity_id}")
                return result
            finally:
                session.close()
        except Exception as e:
            logger.error(f"Error updating {self.__class__.__name__} {entity_id}: {e}")
            raise
    
    def delete(self, entity_id: ID) -> bool:
        """
        Delete an entity.
        
        Args:
            entity_id: Unique identifier of the entity
            
        Returns:
            True if deleted, False if not found
        """
        try:
            session = self.database.get_session()
            try:
                repository = self._get_repository_instance(session)
                success = repository.delete(entity_id)
                if success:
                    session.commit()
                    logger.info(f"Deleted {self.__class__.__name__} with ID: {entity_id}")
                return success
            finally:
                session.close()
        except Exception as e:
            logger.error(f"Error deleting {self.__class__.__name__} {entity_id}: {e}")
            raise
    
    def exists(self, entity_id: ID) -> bool:
        """
        Check if an entity exists.
        
        Args:
            entity_id: Unique identifier of the entity
            
        Returns:
            True if exists, False otherwise
        """
        try:
            session = self.database.get_session()
            try:
                repository = self._get_repository_instance(session)
                return repository.exists(entity_id)
            finally:
                session.close()
        except Exception as e:
            logger.error(f"Error checking existence of {self.__class__.__name__} {entity_id}: {e}")
            raise
    
    def count(self, filters: Optional[Dict[str, Any]] = None) -> int:
        """
        Count entities with optional filtering.
        
        Args:
            filters: Dictionary of field-value pairs to filter by
            
        Returns:
            Count of matching entities
        """
        try:
            session = self.database.get_session()
            try:
                repository = self._get_repository_instance(session)
                return repository.count(filters)
            finally:
                session.close()
        except Exception as e:
            logger.error(f"Error counting {self.__class__.__name__} entities: {e}")
            raise
    
    def bulk_create(self, entities_data: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        Create multiple entities.
        
        Args:
            entities_data: List of entity data dictionaries
            
        Returns:
            List of created entity dictionaries
        """
        try:
            session = self.database.get_session()
            try:
                repository = self._get_repository_instance(session)
                results = repository.bulk_create(entities_data)
                session.commit()
                logger.info(f"Bulk created {len(results)} {self.__class__.__name__} entities")
                return results
            finally:
                session.close()
        except Exception as e:
            logger.error(f"Error bulk creating {self.__class__.__name__} entities: {e}")
            raise
    
    def bulk_update(self, updates: List[tuple]) -> List[Dict[str, Any]]:
        """
        Update multiple entities.
        
        Args:
            updates: List of (entity_id, update_data) tuples
            
        Returns:
            List of updated entity dictionaries
        """
        try:
            session = self.database.get_session()
            try:
                repository = self._get_repository_instance(session)
                results = repository.bulk_update(updates)
                session.commit()
                logger.info(f"Bulk updated {len(results)} {self.__class__.__name__} entities")
                return results
            finally:
                session.close()
        except Exception as e:
            logger.error(f"Error bulk updating {self.__class__.__name__} entities: {e}")
            raise
    
    def bulk_delete(self, entity_ids: List[ID]) -> int:
        """
        Delete multiple entities.
        
        Args:
            entity_ids: List of entity IDs to delete
            
        Returns:
            Number of deleted entities
        """
        try:
            session = self.database.get_session()
            try:
                repository = self._get_repository_instance(session)
                deleted_count = repository.bulk_delete(entity_ids)
                session.commit()
                logger.info(f"Bulk deleted {deleted_count} {self.__class__.__name__} entities")
                return deleted_count
            finally:
                session.close()
        except Exception as e:
            logger.error(f"Error bulk deleting {self.__class__.__name__} entities: {e}")
            raise
    
    def _get_repository_instance(self, session):
        """
        Get repository instance with the given session.
        This method should be overridden by subclasses.
        """
        raise NotImplementedError("Subclasses must implement _get_repository_instance")
    
    def _validate_create_data(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Validate data before creating an entity.
        Override in subclasses for specific validation logic.
        """
        return data
    
    def _validate_update_data(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Validate data before updating an entity.
        Override in subclasses for specific validation logic.
        """
        return data
    
    def _pre_create(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Hook called before creating an entity.
        Override in subclasses for custom logic.
        """
        return self._validate_create_data(data)
    
    def _post_create(self, entity: Dict[str, Any]) -> Dict[str, Any]:
        """
        Hook called after creating an entity.
        Override in subclasses for custom logic.
        """
        return entity
    
    def _pre_update(self, entity_id: ID, data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Hook called before updating an entity.
        Override in subclasses for custom logic.
        """
        return self._validate_update_data(data)
    
    def _post_update(self, entity: Dict[str, Any]) -> Dict[str, Any]:
        """
        Hook called after updating an entity.
        Override in subclasses for custom logic.
        """
        return entity
    
    def _pre_delete(self, entity_id: ID) -> bool:
        """
        Hook called before deleting an entity.
        Override in subclasses for custom logic.
        Return False to prevent deletion.
        """
        return True
    
    def _post_delete(self, entity_id: ID):
        """
        Hook called after deleting an entity.
        Override in subclasses for custom logic.
        """
        pass


class TransactionalService(BaseService[T, ID]):
    """
    Service class that provides transaction support for complex operations.
    """
    
    def execute_in_transaction(self, operation, *args, **kwargs):
        """
        Execute an operation within a database transaction.
        
        Args:
            operation: Function to execute
            *args: Arguments to pass to the operation
            **kwargs: Keyword arguments to pass to the operation
            
        Returns:
            Result of the operation
        """
        try:
            if hasattr(self.database, 'get_unit_of_work'):
                with self.database.get_unit_of_work() as uow:
                    return operation(uow, *args, **kwargs)
            else:
                # Fallback for databases that don't support transactions
                session = self.database.get_session()
                try:
                    return operation(session, *args, **kwargs)
                finally:
                    session.close()
        except Exception as e:
            logger.error(f"Transaction failed in {self.__class__.__name__}: {e}")
            raise