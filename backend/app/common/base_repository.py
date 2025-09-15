"""
Base repository implementations for different database providers.
"""

from typing import Any, Dict, List, Optional, Type, TypeVar, Tuple
from datetime import datetime
import logging
import json
from decimal import Decimal

from app.core.interfaces import Repository, DatabaseSession, DatabaseException, QueryError
from app.core.config import settings

T = TypeVar('T')
ID = TypeVar('ID')

logger = logging.getLogger(__name__)


class BaseRepository(Repository[T, ID]):
    """Base repository with common functionality"""
    
    def __init__(self, session: DatabaseSession, model_class: Type[T], table_name: str):
        super().__init__(session)
        self.model_class = model_class
        self.table_name = table_name
    
    def _convert_to_dict(self, entity: Any) -> Dict[str, Any]:
        """Convert entity to dictionary representation"""
        from uuid import UUID
        if hasattr(entity, '__dict__'):
            result = {}
            for key, value in entity.__dict__.items():
                if not key.startswith('_'):
                    # Handle special types
                    if isinstance(value, UUID):
                        result[key] = str(value)
                    elif isinstance(value, Decimal):
                        result[key] = float(value)
                    elif isinstance(value, datetime):
                        result[key] = value.isoformat()
                    elif value is None:
                        result[key] = None
                    # For string UUIDs (already converted by UUIDType), keep as is
                    elif isinstance(value, str) and key.endswith('_id'):
                        result[key] = value
                    # Convert cost string fields to float for API response
                    elif isinstance(value, str) and key in ['base_cost', 'final_cost', 'tax_amount', 'discount_amount', 'estimated_cost', 'actual_cost']:
                        try:
                            result[key] = float(value) if value else 0.0
                        except (ValueError, TypeError):
                            result[key] = 0.0
                    else:
                        result[key] = value
            
            # Handle relationships (like invoice items)
            # Check for common relationship names
            if hasattr(entity, 'items') and hasattr(entity.items, '__iter__'):
                result['items'] = [self._convert_to_dict(item) for item in entity.items]
            
            return result
        elif isinstance(entity, dict):
            return entity
        else:
            return {"data": entity}
    
    def _prepare_data(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Prepare data for database insertion/update"""
        from uuid import UUID
        prepared = {}
        for key, value in data.items():
            if value is not None:
                # Handle UUID types
                if isinstance(value, UUID):
                    prepared[key] = str(value)
                # Handle lists that might contain UUIDs
                elif isinstance(value, list):
                    prepared[key] = [str(item) if isinstance(item, UUID) else item for item in value]
                # Handle different data types
                elif isinstance(value, dict):
                    # Convert complex types to JSON for databases that support it
                    prepared[key] = json.dumps(value)
                else:
                    prepared[key] = value
        return prepared
    
    def _validate_data(self, data: Dict[str, Any], operation: str = "create") -> Dict[str, Any]:
        """Validate and clean data before database operations"""
        if not data:
            raise ValueError(f"No data provided for {operation} operation")
        
        # Remove None values if specified in settings (but not for update operations)
        if operation != "update" and getattr(settings, 'REMOVE_NONE_VALUES', True):
            data = {k: v for k, v in data.items() if v is not None}
        
        # Remove system fields that shouldn't be set manually
        system_fields = {'created_at', 'updated_at'} if operation == "create" else {'created_at'}
        for field in system_fields:
            data.pop(field, None)
        
        return self._prepare_data(data)


class SQLAlchemyRepository(BaseRepository[T, ID]):
    """Repository implementation for SQLAlchemy-based databases (SQLite, PostgreSQL)"""
    
    def __init__(self, session: DatabaseSession, model_class: Type[T]):
        super().__init__(session, model_class, model_class.__tablename__)
        self.db_session = session  # SQLAlchemy session
    
    def _prepare_sqlalchemy_data(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Prepare data specifically for SQLAlchemy, keeping UUIDs as UUID objects"""
        from uuid import UUID
        import uuid as uuid_module
        prepared = {}
        for key, value in data.items():
            if value is not None:
                # Convert string UUIDs back to UUID objects for SQLAlchemy
                if isinstance(value, str) and key.endswith('_id'):
                    try:
                        prepared[key] = UUID(value)
                    except (ValueError, AttributeError):
                        prepared[key] = value
                # Handle lists (keep as-is for SQLAlchemy JSON fields)
                elif isinstance(value, list):
                    prepared[key] = value
                # Handle dict (keep as-is for SQLAlchemy JSON fields)
                elif isinstance(value, dict):
                    prepared[key] = value
                else:
                    prepared[key] = value
        return prepared
    
    def create(self, entity_data: Dict[str, Any]) -> T:
        """Create a new entity using SQLAlchemy"""
        try:
            validated_data = self._validate_data(entity_data, "create")
            
            # Add UUID if not provided
            if 'id' not in validated_data:
                import uuid
                validated_data['id'] = str(uuid.uuid4())  # Convert to string for SQLite compatibility
            elif isinstance(validated_data.get('id'), str):
                # Keep as string for SQLite
                pass
            
            # Prepare data for SQLAlchemy (convert string UUIDs back to UUID objects)
            sqlalchemy_data = self._prepare_sqlalchemy_data(validated_data)
            
            # Create model instance
            entity = self.model_class(**sqlalchemy_data)
            
            # Add to session and commit
            self.db_session.add(entity)
            self.db_session.flush()  # Flush to get ID
            
            logger.info(f"Created {self.table_name} with ID: {entity.id}")
            return self._convert_to_dict(entity)
            
        except Exception as e:
            logger.error(f"Error creating {self.table_name}: {e}")
            self.db_session.rollback()
            raise DatabaseException(f"Failed to create {self.table_name}", e)
    
    def get_by_id(self, entity_id: ID) -> Optional[T]:
        """Get entity by ID using SQLAlchemy"""
        try:
            entity = self.db_session.query(self.model_class).filter(
                self.model_class.id == entity_id
            ).first()
            
            return self._convert_to_dict(entity) if entity else None
            
        except Exception as e:
            logger.error(f"Error getting {self.table_name} by ID {entity_id}: {e}")
            raise DatabaseException(f"Failed to get {self.table_name} by ID", e)
    
    def get_all(self, 
                filters: Optional[Dict[str, Any]] = None,
                order_by: Optional[str] = None,
                limit: Optional[int] = None,
                offset: Optional[int] = None) -> List[T]:
        """Get all entities with optional filters and pagination"""
        try:
            query = self.db_session.query(self.model_class)
            
            # Apply filters
            if filters:
                for key, value in filters.items():
                    if hasattr(self.model_class, key):
                        if isinstance(value, list):
                            # IN query
                            query = query.filter(getattr(self.model_class, key).in_(value))
                        else:
                            # Equality query
                            query = query.filter(getattr(self.model_class, key) == value)
            
            # Apply ordering
            if order_by:
                if order_by.startswith('-'):
                    # Descending order
                    field = order_by[1:]
                    if hasattr(self.model_class, field):
                        query = query.order_by(getattr(self.model_class, field).desc())
                else:
                    # Ascending order
                    if hasattr(self.model_class, order_by):
                        query = query.order_by(getattr(self.model_class, order_by))
            
            # Apply pagination
            if offset:
                query = query.offset(offset)
            if limit:
                query = query.limit(limit)
            
            entities = query.all()
            return [self._convert_to_dict(entity) for entity in entities]
            
        except Exception as e:
            logger.error(f"Error getting all {self.table_name}: {e}")
            raise DatabaseException(f"Failed to get all {self.table_name}", e)
    
    def update(self, entity_id: ID, update_data: Dict[str, Any]) -> Optional[T]:
        """Update entity by ID using SQLAlchemy"""
        try:
            validated_data = self._validate_data(update_data, "update")
            
            # Prepare data for SQLAlchemy
            sqlalchemy_data = self._prepare_sqlalchemy_data(validated_data)
            
            # Find entity
            entity = self.db_session.query(self.model_class).filter(
                self.model_class.id == entity_id
            ).first()
            
            if not entity:
                return None
            
            # Update fields
            for key, value in sqlalchemy_data.items():
                if hasattr(entity, key):
                    setattr(entity, key, value)
            
            # Update timestamp if available
            if hasattr(entity, 'updated_at'):
                entity.updated_at = datetime.utcnow()
            
            self.db_session.flush()
            
            logger.info(f"Updated {self.table_name} with ID: {entity_id}")
            return self._convert_to_dict(entity)
            
        except Exception as e:
            logger.error(f"Error updating {self.table_name} {entity_id}: {e}")
            self.db_session.rollback()
            raise DatabaseException(f"Failed to update {self.table_name}", e)
    
    def delete(self, entity_id: ID) -> bool:
        """Delete entity by ID using SQLAlchemy"""
        try:
            entity = self.db_session.query(self.model_class).filter(
                self.model_class.id == entity_id
            ).first()
            
            if not entity:
                return False
            
            self.db_session.delete(entity)
            self.db_session.flush()
            
            logger.info(f"Deleted {self.table_name} with ID: {entity_id}")
            return True
            
        except Exception as e:
            logger.error(f"Error deleting {self.table_name} {entity_id}: {e}")
            self.db_session.rollback()
            raise DatabaseException(f"Failed to delete {self.table_name}", e)
    
    def exists(self, entity_id: ID) -> bool:
        """Check if entity exists using SQLAlchemy"""
        try:
            return self.db_session.query(self.model_class).filter(
                self.model_class.id == entity_id
            ).first() is not None
            
        except Exception as e:
            logger.error(f"Error checking existence of {self.table_name} {entity_id}: {e}")
            raise DatabaseException(f"Failed to check existence of {self.table_name}", e)
    
    def count(self, filters: Optional[Dict[str, Any]] = None) -> int:
        """Count entities with optional filters using SQLAlchemy"""
        try:
            query = self.db_session.query(self.model_class)
            
            # Apply filters
            if filters:
                for key, value in filters.items():
                    if hasattr(self.model_class, key):
                        query = query.filter(getattr(self.model_class, key) == value)
            
            return query.count()
            
        except Exception as e:
            logger.error(f"Error counting {self.table_name}: {e}")
            raise DatabaseException(f"Failed to count {self.table_name}", e)


class SupabaseRepository(BaseRepository[T, ID]):
    """Repository implementation for Supabase"""
    
    def __init__(self, session: DatabaseSession, table_name: str, model_class: Type[T] = None):
        super().__init__(session, model_class, table_name)
        self.client = session  # Supabase client
    
    def create(self, entity_data: Dict[str, Any]) -> T:
        """Create a new entity using Supabase"""
        try:
            validated_data = self._validate_data(entity_data, "create")
            
            # Add UUID if not provided
            if 'id' not in validated_data:
                import uuid
                validated_data['id'] = str(uuid.uuid4())
            
            response = self.client.table(self.table_name).insert(validated_data).execute()
            
            if not response.data:
                raise DatabaseException("No data returned from insert operation")
            
            # Convert cost strings to floats for specific fields
            data = response.data[0]
            for key in ['base_cost', 'final_cost', 'tax_amount', 'discount_amount', 'estimated_cost', 'actual_cost']:
                if key in data and isinstance(data[key], str):
                    try:
                        data[key] = float(data[key]) if data[key] else 0.0
                    except (ValueError, TypeError):
                        data[key] = 0.0
            
            # Parse JSON fields if they are strings
            for key in ['trades', 'additional_costs', 'items']:
                if key in data and isinstance(data[key], str):
                    try:
                        data[key] = json.loads(data[key])
                    except (json.JSONDecodeError, TypeError):
                        logger.warning(f"Failed to parse JSON field {key} for {self.table_name}")
                        data[key] = [] if key in ['trades', 'items'] else None
            
            logger.info(f"Created {self.table_name} with ID: {validated_data['id']}")
            return data
            
        except Exception as e:
            logger.error(f"Error creating {self.table_name}: {e}")
            raise DatabaseException(f"Failed to create {self.table_name}", e)
    
    def get_by_id(self, entity_id: ID) -> Optional[T]:
        """Get entity by ID using Supabase"""
        try:
            response = self.client.table(self.table_name).select("*").eq("id", entity_id).execute()
            
            if response.data:
                # Convert cost strings to floats for specific fields
                data = response.data[0]
                for key in ['base_cost', 'final_cost', 'tax_amount', 'discount_amount', 'estimated_cost', 'actual_cost']:
                    if key in data and isinstance(data[key], str):
                        try:
                            data[key] = float(data[key]) if data[key] else 0.0
                        except (ValueError, TypeError):
                            data[key] = 0.0
                
                # Parse JSON fields if they are strings
                for key in ['trades', 'additional_costs', 'items']:
                    if key in data and isinstance(data[key], str):
                        try:
                            data[key] = json.loads(data[key])
                        except (json.JSONDecodeError, TypeError):
                            logger.warning(f"Failed to parse JSON field {key} for {self.table_name} {entity_id}")
                            data[key] = [] if key in ['trades', 'items'] else None
                
                return data
            return None
            
        except Exception as e:
            logger.error(f"Error getting {self.table_name} by ID {entity_id}: {e}")
            raise DatabaseException(f"Failed to get {self.table_name} by ID", e)
    
    def get_all(self, 
                filters: Optional[Dict[str, Any]] = None,
                order_by: Optional[str] = None,
                limit: Optional[int] = None,
                offset: Optional[int] = None) -> List[T]:
        """Get all entities with optional filters and pagination using Supabase"""
        try:
            query = self.client.table(self.table_name).select("*")
            
            # Apply filters
            if filters:
                for key, value in filters.items():
                    if isinstance(value, list):
                        # IN query
                        query = query.in_(key, value)
                    else:
                        # Equality query
                        query = query.eq(key, value)
            
            # Apply ordering
            if order_by:
                if order_by.startswith('-'):
                    # Descending order
                    field = order_by[1:]
                    query = query.order(field, desc=True)
                else:
                    # Ascending order
                    query = query.order(order_by)
            
            # Apply pagination
            if limit:
                query = query.limit(limit)
            if offset:
                query = query.offset(offset)
            
            response = query.execute()
            
            # Convert cost strings to floats and parse JSON fields for each item
            if response.data:
                for item in response.data:
                    for key in ['base_cost', 'final_cost', 'tax_amount', 'discount_amount', 'estimated_cost', 'actual_cost']:
                        if key in item and isinstance(item[key], str):
                            try:
                                item[key] = float(item[key]) if item[key] else 0.0
                            except (ValueError, TypeError):
                                item[key] = 0.0
                    
                    # Parse JSON fields if they are strings
                    for key in ['trades', 'additional_costs', 'items']:
                        if key in item and isinstance(item[key], str):
                            try:
                                item[key] = json.loads(item[key])
                            except (json.JSONDecodeError, TypeError):
                                logger.warning(f"Failed to parse JSON field {key} for {self.table_name}")
                                item[key] = [] if key in ['trades', 'items'] else None
            
            return response.data if response.data else []
            
        except Exception as e:
            logger.error(f"Error getting all {self.table_name}: {e}")
            raise DatabaseException(f"Failed to get all {self.table_name}", e)
    
    def update(self, entity_id: ID, update_data: Dict[str, Any]) -> Optional[T]:
        """Update entity by ID using Supabase"""
        try:
            validated_data = self._validate_data(update_data, "update")
            
            if not validated_data:
                return None
            
            response = self.client.table(self.table_name).update(validated_data).eq("id", entity_id).execute()
            
            if not response.data:
                return None
            
            # Convert cost strings to floats for specific fields
            data = response.data[0]
            for key in ['base_cost', 'final_cost', 'tax_amount', 'discount_amount', 'estimated_cost', 'actual_cost']:
                if key in data and isinstance(data[key], str):
                    try:
                        data[key] = float(data[key]) if data[key] else 0.0
                    except (ValueError, TypeError):
                        data[key] = 0.0
            
            # Parse JSON fields if they are strings
            for key in ['trades', 'additional_costs', 'items']:
                if key in data and isinstance(data[key], str):
                    try:
                        data[key] = json.loads(data[key])
                    except (json.JSONDecodeError, TypeError):
                        logger.warning(f"Failed to parse JSON field {key} for {self.table_name} {entity_id}")
                        data[key] = [] if key in ['trades', 'items'] else None
            
            logger.info(f"Updated {self.table_name} with ID: {entity_id}")
            return data
            
        except Exception as e:
            logger.error(f"Error updating {self.table_name} {entity_id}: {e}")
            raise DatabaseException(f"Failed to update {self.table_name}", e)
    
    def delete(self, entity_id: ID) -> bool:
        """Delete entity by ID using Supabase"""
        try:
            response = self.client.table(self.table_name).delete().eq("id", entity_id).execute()
            
            # Supabase returns the deleted row(s) if successful
            success = response.data is not None
            
            if success:
                logger.info(f"Deleted {self.table_name} with ID: {entity_id}")
            
            return success
            
        except Exception as e:
            logger.error(f"Error deleting {self.table_name} {entity_id}: {e}")
            raise DatabaseException(f"Failed to delete {self.table_name}", e)
    
    def exists(self, entity_id: ID) -> bool:
        """Check if entity exists using Supabase"""
        try:
            response = self.client.table(self.table_name).select("id").eq("id", entity_id).execute()
            return len(response.data) > 0
            
        except Exception as e:
            logger.error(f"Error checking existence of {self.table_name} {entity_id}: {e}")
            raise DatabaseException(f"Failed to check existence of {self.table_name}", e)
    
    def count(self, filters: Optional[Dict[str, Any]] = None) -> int:
        """Count entities with optional filters using Supabase"""
        try:
            query = self.client.table(self.table_name).select("*", count="exact")
            
            # Apply filters
            if filters:
                for key, value in filters.items():
                    query = query.eq(key, value)
            
            response = query.execute()
            return response.count if hasattr(response, 'count') else len(response.data)
            
        except Exception as e:
            logger.error(f"Error counting {self.table_name}: {e}")
            raise DatabaseException(f"Failed to count {self.table_name}", e)