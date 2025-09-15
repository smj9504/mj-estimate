"""
Xactimate domain repository
"""

import asyncio
import logging
from typing import List, Optional, Tuple, Dict, Any
from sqlalchemy.orm import Session, selectinload, joinedload
from sqlalchemy import and_, or_, func, desc, asc, text
from decimal import Decimal

from app.common.base_repository import BaseRepository, SQLAlchemyRepository, SupabaseRepository
from app.core.interfaces import DatabaseSession, DatabaseException
from .models import XactimateCategory, XactimateItem, XactimateComponent
from .schemas import XactimateSearchRequest

logger = logging.getLogger(__name__)


class XactimateCategoryRepositoryMixin:
    """Mixin with Xactimate category-specific methods"""
    
    def get_by_code(self, category_code: str) -> Optional[XactimateCategory]:
        """Get category by code"""
        raise NotImplementedError("Subclasses must implement get_by_code")
    
    def get_all_with_stats(self) -> List[Dict[str, Any]]:
        """Get all categories with item count statistics"""
        raise NotImplementedError("Subclasses must implement get_all_with_stats")


class XactimateCategorySQLAlchemyRepository(SQLAlchemyRepository, XactimateCategoryRepositoryMixin):
    """SQLAlchemy-based repository for Xactimate categories"""
    
    def __init__(self, db: Session):
        super().__init__(db, XactimateCategory)
    
    def get_by_id(self, entity_id: str) -> Optional[Dict[str, Any]]:
        """Override to use category_code as primary key"""
        try:
            entity = self.db_session.query(self.model_class).filter(
                self.model_class.category_code == entity_id
            ).first()
            
            return self._convert_to_dict(entity) if entity else None
            
        except Exception as e:
            logger.error(f"Error getting {self.table_name} by ID {entity_id}: {e}")
            raise DatabaseException(f"Failed to get {self.table_name} by ID", e)
    
    def update(self, entity_id: str, update_data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Override to use category_code as primary key"""
        try:
            validated_data = self._validate_data(update_data, "update")
            
            # Prepare data for SQLAlchemy
            sqlalchemy_data = self._prepare_sqlalchemy_data(validated_data)
            
            # Find entity by category_code
            entity = self.db_session.query(self.model_class).filter(
                self.model_class.category_code == entity_id
            ).first()
            
            if not entity:
                return None
            
            # Update fields
            for key, value in sqlalchemy_data.items():
                if hasattr(entity, key):
                    setattr(entity, key, value)
            
            self.db_session.flush()
            
            logger.info(f"Updated {self.table_name} with ID: {entity_id}")
            return self._convert_to_dict(entity)
            
        except Exception as e:
            logger.error(f"Error updating {self.table_name} {entity_id}: {e}")
            self.db_session.rollback()
            raise DatabaseException(f"Failed to update {self.table_name}", e)
    
    def delete(self, entity_id: str) -> bool:
        """Override to use category_code as primary key"""
        try:
            entity = self.db_session.query(self.model_class).filter(
                self.model_class.category_code == entity_id
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
    
    def exists(self, entity_id: str) -> bool:
        """Override to use category_code as primary key"""
        try:
            return self.db_session.query(self.model_class).filter(
                self.model_class.category_code == entity_id
            ).first() is not None
            
        except Exception as e:
            logger.error(f"Error checking existence of {self.table_name} {entity_id}: {e}")
            raise DatabaseException(f"Failed to check existence of {self.table_name}", e)
    
    def get_by_code(self, category_code: str) -> Optional[Dict[str, Any]]:
        """Get category by code - alias for get_by_id"""
        return self.get_by_id(category_code)
    
    def get_all_with_stats(self) -> List[Dict[str, Any]]:
        """Get all categories with item count statistics"""
        result = self.db_session.query(
            XactimateCategory.category_code,
            XactimateCategory.category_name,
            XactimateCategory.description,
            func.count(XactimateItem.id).label('item_count'),
            func.avg(XactimateItem.untaxed_unit_price).label('avg_price'),
            func.min(XactimateItem.untaxed_unit_price).label('min_price'),
            func.max(XactimateItem.untaxed_unit_price).label('max_price'),
            func.max(XactimateItem.updated_at).label('latest_update')
        ).outerjoin(XactimateItem).group_by(
            XactimateCategory.category_code,
            XactimateCategory.category_name,
            XactimateCategory.description
        ).all()
        
        return [
            {
                'category_code': row.category_code,
                'category_name': row.category_name,
                'description': row.description,
                'item_count': row.item_count or 0,
                'avg_price': row.avg_price,
                'min_price': row.min_price,
                'max_price': row.max_price,
                'latest_update': row.latest_update
            }
            for row in result
        ]


class XactimateItemRepositoryMixin:
    """Mixin with Xactimate item-specific methods"""
    
    def get_by_item_code(self, item_code: str, include_components: bool = False) -> Optional[XactimateItem]:
        """Get item by item code with optional components"""
        raise NotImplementedError("Subclasses must implement get_by_item_code")
    
    def get_by_category(self, category_code: str, limit: int = 100, include_components: bool = False) -> List[XactimateItem]:
        """Get items by category with pagination"""
        raise NotImplementedError("Subclasses must implement get_by_category")
    
    def search(self, search_request: XactimateSearchRequest) -> Tuple[List[XactimateItem], int]:
        """Advanced search with multiple filters"""
        raise NotImplementedError("Subclasses must implement search")
    
    def get_latest_by_item_codes(self, item_codes: List[str]) -> List[XactimateItem]:
        """Get latest version of items by item codes"""
        raise NotImplementedError("Subclasses must implement get_latest_by_item_codes")
    
    def get_price_history(self, item_code: str) -> List[XactimateItem]:
        """Get price history for an item"""
        raise NotImplementedError("Subclasses must implement get_price_history")


class XactimateItemSQLAlchemyRepository(SQLAlchemyRepository, XactimateItemRepositoryMixin):
    """SQLAlchemy-based repository for Xactimate items with optimized queries"""
    
    def __init__(self, db: Session):
        super().__init__(db, XactimateItem)
    
    def get_by_item_code(self, item_code: str, include_components: bool = False) -> Optional[Dict[str, Any]]:
        """Get item by item code with optional components"""
        query = self.db_session.query(XactimateItem).filter(
            XactimateItem.item_code == item_code
        )
        
        if include_components:
            query = query.options(selectinload(XactimateItem.components))
        
        entity = query.first()
        return self._convert_to_dict(entity) if entity else None
    
    def get_by_category(self, category_code: str, limit: int = 100, include_components: bool = False) -> List[Dict[str, Any]]:
        """Get items by category with pagination"""
        query = self.db_session.query(XactimateItem).filter(
            XactimateItem.category_code == category_code
        ).order_by(XactimateItem.item_code).limit(limit)
        
        if include_components:
            query = query.options(selectinload(XactimateItem.components))
        
        entities = query.all()
        return [self._convert_to_dict(entity) for entity in entities]
    
    def search(self, search_request: XactimateSearchRequest) -> Tuple[List[Dict[str, Any]], int]:
        """Advanced search with multiple filters"""
        query = self.db_session.query(XactimateItem)
        
        # Apply filters
        if search_request.search_term:
            search_term = f"%{search_request.search_term}%"
            query = query.filter(
                or_(
                    XactimateItem.description.ilike(search_term),
                    XactimateItem.item_code.ilike(search_term),
                    XactimateItem.includes_description.ilike(search_term)
                )
            )
        
        if search_request.category_code:
            query = query.filter(XactimateItem.category_code == search_request.category_code)
        
        if search_request.item_code:
            query = query.filter(XactimateItem.item_code.ilike(f"%{search_request.item_code}%"))
        
        if search_request.price_year:
            query = query.filter(XactimateItem.price_year == search_request.price_year)
        
        if search_request.price_month:
            query = query.filter(XactimateItem.price_month == search_request.price_month)
        
        if search_request.min_price is not None:
            query = query.filter(XactimateItem.untaxed_unit_price >= search_request.min_price)
        
        if search_request.max_price is not None:
            query = query.filter(XactimateItem.untaxed_unit_price <= search_request.max_price)
        
        if search_request.has_components is not None:
            if search_request.has_components:
                query = query.join(XactimateComponent)
            else:
                query = query.outerjoin(XactimateComponent).filter(
                    XactimateComponent.id.is_(None)
                )
        
        # Get total count
        total_count = query.count()
        
        # Apply pagination and ordering
        query = query.order_by(
            XactimateItem.category_code,
            XactimateItem.item_code
        ).offset(
            (search_request.page - 1) * search_request.page_size
        ).limit(search_request.page_size)
        
        # Include components if requested
        if search_request.include_components:
            query = query.options(selectinload(XactimateItem.components))
        
        entities = query.all()
        items = [self._convert_to_dict(entity) for entity in entities]
        
        return items, total_count
    
    def get_latest_by_item_codes(self, item_codes: List[str]) -> List[Dict[str, Any]]:
        """Get latest version of items by item codes"""
        # Subquery to get the latest date for each item_code
        latest_subquery = self.db_session.query(
            XactimateItem.item_code,
            func.max(XactimateItem.price_year).label('max_year'),
            func.max(XactimateItem.price_month).label('max_month')
        ).filter(
            XactimateItem.item_code.in_(item_codes)
        ).group_by(XactimateItem.item_code).subquery()
        
        # Join with original table to get full records
        query = self.db_session.query(XactimateItem).join(
            latest_subquery,
            and_(
                XactimateItem.item_code == latest_subquery.c.item_code,
                XactimateItem.price_year == latest_subquery.c.max_year,
                XactimateItem.price_month == latest_subquery.c.max_month
            )
        ).options(selectinload(XactimateItem.components))
        
        entities = query.all()
        return [self._convert_to_dict(entity) for entity in entities]
    
    def get_price_history(self, item_code: str) -> List[Dict[str, Any]]:
        """Get price history for an item"""
        entities = self.db_session.query(XactimateItem).filter(
            XactimateItem.item_code == item_code
        ).order_by(
            desc(XactimateItem.price_year),
            desc(XactimateItem.price_month)
        ).all()
        return [self._convert_to_dict(entity) for entity in entities]


class XactimateComponentRepositoryMixin:
    """Mixin with Xactimate component-specific methods"""
    
    def get_by_item_id(self, item_id: int) -> List[XactimateComponent]:
        """Get all components for an item"""
        raise NotImplementedError("Subclasses must implement get_by_item_id")
    
    def get_by_type(self, component_type: str, limit: int = 100) -> List[XactimateComponent]:
        """Get components by type"""
        raise NotImplementedError("Subclasses must implement get_by_type")
    
    def bulk_create_for_item(self, item_id: int, components_data: List[Dict[str, Any]]) -> List[XactimateComponent]:
        """Bulk create components for an item"""
        raise NotImplementedError("Subclasses must implement bulk_create_for_item")
    
    def delete_by_item_id(self, item_id: int) -> int:
        """Delete all components for an item"""
        raise NotImplementedError("Subclasses must implement delete_by_item_id")


class XactimateComponentSQLAlchemyRepository(SQLAlchemyRepository, XactimateComponentRepositoryMixin):
    """SQLAlchemy-based repository for Xactimate components"""
    
    def __init__(self, db: Session):
        super().__init__(db, XactimateComponent)
    
    def get_by_item_id(self, item_id: int) -> List[Dict[str, Any]]:
        """Get all components for an item"""
        entities = self.db_session.query(XactimateComponent).filter(
            XactimateComponent.item_id == item_id
        ).order_by(XactimateComponent.component_type).all()
        return [self._convert_to_dict(entity) for entity in entities]
    
    def get_by_type(self, component_type: str, limit: int = 100) -> List[Dict[str, Any]]:
        """Get components by type"""
        entities = self.db_session.query(XactimateComponent).filter(
            XactimateComponent.component_type == component_type
        ).limit(limit).all()
        return [self._convert_to_dict(entity) for entity in entities]
    
    def bulk_create_for_item(self, item_id: int, components_data: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Bulk create components for an item"""
        components = []
        for comp_data in components_data:
            component = XactimateComponent(
                item_id=item_id,
                **comp_data
            )
            components.append(component)
        
        self.db_session.add_all(components)
        self.db_session.flush()  # Get IDs without committing
        
        return [self._convert_to_dict(component) for component in components]
    
    def delete_by_item_id(self, item_id: int) -> int:
        """Delete all components for an item"""
        deleted_count = self.db_session.query(XactimateComponent).filter(
            XactimateComponent.item_id == item_id
        ).delete(synchronize_session=False)
        
        return deleted_count


class XactimateUnifiedRepository:
    """Repository for unified operations across Xactimate and Custom line items"""
    
    def __init__(self, db: Session):
        self.db = db
    
    def unified_search(self, search_term: Optional[str] = None, 
                      category: Optional[str] = None,
                      item_type: Optional[str] = None,
                      company_id: Optional[str] = None,
                      page: int = 1, page_size: int = 50) -> Tuple[List[Dict[str, Any]], Dict[str, int]]:
        """Unified search across both Xactimate and Custom line items"""
        
        # Build conditions for unified search
        conditions = []
        if search_term:
            search_term_like = f"%{search_term}%"
            conditions.append(f"description ILIKE '{search_term_like}'")
        
        if category:
            conditions.append(f"cat = '{category}'")
        
        # Build WHERE clause
        where_clause = ""
        if conditions:
            where_clause = "WHERE " + " AND ".join(conditions)
        
        # Determine which types to include
        include_xactimate = item_type in [None, "ALL", "XACTIMATE"]
        include_custom = item_type in [None, "ALL", "CUSTOM"]
        
        union_parts = []
        
        # Xactimate part
        if include_xactimate:
            xactimate_sql = f"""
                SELECT 
                    'xactimate_' || id::text as id,
                    'XACTIMATE' as type,
                    category_code as cat,
                    item_code as item,
                    description,
                    includes_description as includes,
                    'EA' as unit,
                    untaxed_unit_price,
                    labor_cost as lab,
                    material_cost as mat,
                    equipment_cost as equ,
                    labor_burden,
                    market_conditions as market_condition,
                    true as is_active,
                    1 as version,
                    NULL::UUID as company_id,
                    created_at,
                    updated_at
                FROM xactimate_items
                {where_clause}
            """
            union_parts.append(xactimate_sql)
        
        # Custom part
        if include_custom:
            custom_conditions = conditions.copy()
            if company_id:
                custom_conditions.append(f"(company_id = '{company_id}' OR company_id IS NULL)")
            custom_conditions.append("type = 'CUSTOM' AND is_active = true")
            
            custom_where = "WHERE " + " AND ".join(custom_conditions) if custom_conditions else ""
            
            custom_sql = f"""
                SELECT 
                    id::text,
                    type::text,
                    cat,
                    item,
                    description,
                    includes,
                    unit,
                    untaxed_unit_price,
                    lab,
                    mat,
                    equ,
                    labor_burden,
                    market_condition,
                    is_active,
                    version,
                    company_id::text,
                    created_at,
                    updated_at
                FROM line_items
                {custom_where}
            """
            union_parts.append(custom_sql)
        
        if not union_parts:
            return [], {'total_count': 0, 'xactimate_count': 0, 'custom_count': 0}
        
        # Combine with UNION ALL
        full_query = " UNION ALL ".join(union_parts)
        
        # Add ordering and pagination
        offset = (page - 1) * page_size
        paginated_query = f"""
            WITH unified_results AS ({full_query})
            SELECT * FROM unified_results
            ORDER BY type, cat, item
            LIMIT {page_size} OFFSET {offset}
        """
        
        # Count query
        count_query = f"""
            WITH unified_results AS ({full_query})
            SELECT 
                COUNT(*) as total_count,
                SUM(CASE WHEN type = 'XACTIMATE' THEN 1 ELSE 0 END) as xactimate_count,
                SUM(CASE WHEN type = 'CUSTOM' THEN 1 ELSE 0 END) as custom_count
            FROM unified_results
        """
        
        # Execute queries
        results = self.db.execute(text(paginated_query)).fetchall()
        count_result = self.db.execute(text(count_query)).fetchone()
        
        # Convert results to dictionaries
        items = []
        for row in results:
            items.append({
                'id': row.id,
                'type': row.type,
                'cat': row.cat,
                'item': row.item,
                'description': row.description,
                'includes': row.includes,
                'unit': row.unit,
                'untaxed_unit_price': float(row.untaxed_unit_price) if row.untaxed_unit_price else 0,
                'lab': float(row.lab) if row.lab else None,
                'mat': float(row.mat) if row.mat else None,
                'equ': float(row.equ) if row.equ else None,
                'labor_burden': float(row.labor_burden) if row.labor_burden else None,
                'market_condition': float(row.market_condition) if row.market_condition else None,
                'is_active': row.is_active,
                'version': row.version,
                'company_id': row.company_id,
                'created_at': row.created_at,
                'updated_at': row.updated_at
            })
        
        counts = {
            'total_count': count_result.total_count or 0,
            'xactimate_count': count_result.xactimate_count or 0,
            'custom_count': count_result.custom_count or 0
        }
        
        return items, counts


# Factory functions for repository selection
class XactimateCategoryRepository:
    """Factory for Xactimate category repository based on database session type"""
    
    def __new__(cls, session: DatabaseSession):
        """Create appropriate repository instance based on session type"""
        if hasattr(session, 'query'):  # SQLAlchemy session
            return XactimateCategorySQLAlchemyRepository(session)
        else:  # Supabase session (future implementation)
            # For now, default to SQLAlchemy
            return XactimateCategorySQLAlchemyRepository(session)


class XactimateItemRepository:
    """Factory for Xactimate item repository based on database session type"""
    
    def __new__(cls, session: DatabaseSession):
        """Create appropriate repository instance based on session type"""
        if hasattr(session, 'query'):  # SQLAlchemy session
            return XactimateItemSQLAlchemyRepository(session)
        else:  # Supabase session (future implementation)
            # For now, default to SQLAlchemy
            return XactimateItemSQLAlchemyRepository(session)


class XactimateComponentRepository:
    """Factory for Xactimate component repository based on database session type"""
    
    def __new__(cls, session: DatabaseSession):
        """Create appropriate repository instance based on session type"""
        if hasattr(session, 'query'):  # SQLAlchemy session
            return XactimateComponentSQLAlchemyRepository(session)
        else:  # Supabase session (future implementation)
            # For now, default to SQLAlchemy
            return XactimateComponentSQLAlchemyRepository(session)


def get_xactimate_category_repository(session: DatabaseSession) -> XactimateCategoryRepositoryMixin:
    """Factory function to get appropriate Xactimate category repository based on database type"""
    
    # Check if it's a UnitOfWork object
    if hasattr(session, 'session'):
        # It's a UnitOfWork, extract the actual session
        actual_session = session.session
        if hasattr(actual_session, 'query') or hasattr(actual_session, 'db_session'):
            # SQLAlchemy session
            return XactimateCategorySQLAlchemyRepository(actual_session)
        else:
            # Default to SQLAlchemy for now
            return XactimateCategorySQLAlchemyRepository(actual_session)
    
    # Direct session check
    elif hasattr(session, 'query') or hasattr(session, 'db_session'):
        # SQLAlchemy session
        return XactimateCategorySQLAlchemyRepository(session)
    else:
        # Default to SQLAlchemy for now
        logger.warning(f"Could not determine session type for {type(session)}, defaulting to SQLAlchemy")
        return XactimateCategorySQLAlchemyRepository(session)


def get_xactimate_item_repository(session: DatabaseSession) -> XactimateItemRepositoryMixin:
    """Factory function to get appropriate Xactimate item repository based on database type"""
    
    # Check if it's a UnitOfWork object
    if hasattr(session, 'session'):
        # It's a UnitOfWork, extract the actual session
        actual_session = session.session
        if hasattr(actual_session, 'query') or hasattr(actual_session, 'db_session'):
            # SQLAlchemy session
            return XactimateItemSQLAlchemyRepository(actual_session)
        else:
            # Default to SQLAlchemy for now
            return XactimateItemSQLAlchemyRepository(actual_session)
    
    # Direct session check
    elif hasattr(session, 'query') or hasattr(session, 'db_session'):
        # SQLAlchemy session
        return XactimateItemSQLAlchemyRepository(session)
    else:
        # Default to SQLAlchemy for now
        logger.warning(f"Could not determine session type for {type(session)}, defaulting to SQLAlchemy")
        return XactimateItemSQLAlchemyRepository(session)


def get_xactimate_component_repository(session: DatabaseSession) -> XactimateComponentRepositoryMixin:
    """Factory function to get appropriate Xactimate component repository based on database type"""
    
    # Check if it's a UnitOfWork object
    if hasattr(session, 'session'):
        # It's a UnitOfWork, extract the actual session
        actual_session = session.session
        if hasattr(actual_session, 'query') or hasattr(actual_session, 'db_session'):
            # SQLAlchemy session
            return XactimateComponentSQLAlchemyRepository(actual_session)
        else:
            # Default to SQLAlchemy for now
            return XactimateComponentSQLAlchemyRepository(actual_session)
    
    # Direct session check
    elif hasattr(session, 'query') or hasattr(session, 'db_session'):
        # SQLAlchemy session
        return XactimateComponentSQLAlchemyRepository(session)
    else:
        # Default to SQLAlchemy for now
        logger.warning(f"Could not determine session type for {type(session)}, defaulting to SQLAlchemy")
        return XactimateComponentSQLAlchemyRepository(session)