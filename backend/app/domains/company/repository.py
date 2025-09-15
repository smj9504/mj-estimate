"""
Company domain repository
"""

from typing import Any, Dict, List, Optional
import logging

from app.common.base_repository import SQLAlchemyRepository, SupabaseRepository
from app.core.interfaces import DatabaseSession
from .models import Company

logger = logging.getLogger(__name__)


class CompanyRepositoryMixin:
    """Mixin with company-specific methods"""
    
    def search_companies(self, search_term: str) -> List[Dict[str, Any]]:
        """Search companies by name, address, email, or phone"""
        raise NotImplementedError("Subclasses must implement search_companies")
    
    def get_by_filters(self, 
                       search: Optional[str] = None,
                       city: Optional[str] = None,
                       state: Optional[str] = None,
                       is_active: Optional[bool] = None,
                       is_default: Optional[bool] = None,
                       limit: Optional[int] = None,
                       offset: Optional[int] = None) -> List[Dict[str, Any]]:
        """Get companies with search and location filters"""
        filters = {}
        
        # Add filters
        if city:
            filters['city'] = city
        if state:
            filters['state'] = state
        if is_active is not None:
            filters['is_active'] = is_active
        if is_default is not None:
            filters['is_default'] = is_default
        
        # If no search term, use regular filtering
        if not search:
            return self.get_all(filters=filters, limit=limit, offset=offset, order_by='name')
        
        # If search term is provided, use search functionality
        results = self.search_companies(search)
        
        # Apply additional filters to search results
        if filters:
            results = [r for r in results if all(
                r.get(k) == v for k, v in filters.items()
            )]
        
        # Apply limit and offset
        if offset:
            results = results[offset:]
        if limit:
            results = results[:limit]
        
        return results
    
    def get_by_email(self, email: str) -> Optional[Dict[str, Any]]:
        """Get company by email address"""
        companies = self.get_all(filters={'email': email}, limit=1)
        return companies[0] if companies else None
    
    def get_by_name(self, name: str) -> Optional[Dict[str, Any]]:
        """Get company by exact name match"""
        companies = self.get_all(filters={'name': name}, limit=1)
        return companies[0] if companies else None
    
    def unset_all_defaults(self):
        """Unset all companies as default"""
        raise NotImplementedError("Subclasses must implement unset_all_defaults")
    
    def get_companies_with_stats(self) -> List[Dict[str, Any]]:
        """Get companies with additional statistics"""
        raise NotImplementedError("Subclasses must implement get_companies_with_stats")
    
    def get_company_by_email(self, email: str) -> Optional[Dict[str, Any]]:
        """Get company by email address - alias for get_by_email for compatibility"""
        return self.get_by_email(email)
    
    def get_companies_summary_stats(self) -> Dict[str, Any]:
        """Get companies statistics summary"""
        raise NotImplementedError("Subclasses must implement get_companies_summary_stats")


class CompanySQLAlchemyRepository(SQLAlchemyRepository, CompanyRepositoryMixin):
    """SQLAlchemy-based company repository for SQLite/PostgreSQL"""
    
    def __init__(self, session: DatabaseSession):
        super().__init__(session, Company)
    
    def search_companies(self, search_term: str) -> List[Dict[str, Any]]:
        """Search companies using SQL LIKE queries"""
        try:
            search_pattern = f"%{search_term.lower()}%"
            
            entities = self.db_session.query(Company).filter(
                (Company.name.ilike(search_pattern)) |
                (Company.address.ilike(search_pattern)) |
                (Company.email.ilike(search_pattern)) |
                (Company.phone.ilike(search_pattern)) |
                (Company.city.ilike(search_pattern)) |
                (Company.state.ilike(search_pattern))
            ).order_by(Company.name).all()
            
            return [self._convert_to_dict(entity) for entity in entities]
            
        except Exception as e:
            logger.error(f"Error searching companies: {e}")
            raise Exception(f"Failed to search companies: {e}")
    
    def unset_all_defaults(self):
        """Unset all companies as default"""
        try:
            self.db_session.query(Company).update({'is_default': False})
            self.db_session.commit()
        except Exception as e:
            logger.error(f"Error unsetting default companies: {e}")
            self.db_session.rollback()
            raise
    
    def get_companies_with_stats(self) -> List[Dict[str, Any]]:
        """Get companies with additional statistics"""
        try:
            # Import here to avoid circular imports
            from app.domains.invoice.models import Invoice
            from app.domains.estimate.models import Estimate
            
            # Query companies with related counts
            result = self.db_session.query(
                Company,
                self.db_session.query(Invoice).filter(Invoice.company_id == Company.id).count().label('invoice_count'),
                self.db_session.query(Estimate).filter(Estimate.company_id == Company.id).count().label('estimate_count')
            ).all()
            
            companies_with_stats = []
            for company, invoice_count, estimate_count in result:
                company_dict = self._convert_to_dict(company)
                company_dict['invoice_count'] = invoice_count
                company_dict['estimate_count'] = estimate_count
                companies_with_stats.append(company_dict)
            
            return companies_with_stats
            
        except Exception as e:
            logger.error(f"Error getting companies with stats: {e}")
            return self.get_all()
    
    def get_companies_summary_stats(self) -> Dict[str, Any]:
        """Get companies statistics summary"""
        try:
            total_companies = self.db_session.query(Company).count()
            active_companies = self.db_session.query(Company).filter(Company.is_active == True).count()
            inactive_companies = total_companies - active_companies
            default_companies = self.db_session.query(Company).filter(Company.is_default == True).count()
            
            return {
                'total_companies': total_companies,
                'active_companies': active_companies,
                'inactive_companies': inactive_companies,
                'default_companies': default_companies
            }
        except Exception as e:
            logger.error(f"Error getting companies summary stats: {e}")
            return {
                'total_companies': 0,
                'active_companies': 0,
                'inactive_companies': 0,
                'default_companies': 0
            }


class CompanySupabaseRepository(SupabaseRepository, CompanyRepositoryMixin):
    """Supabase-based company repository"""
    
    def __init__(self, session: DatabaseSession):
        super().__init__(session, "companies", Company)
    
    def search_companies(self, search_term: str) -> List[Dict[str, Any]]:
        """Search companies using Supabase text search"""
        try:
            # Get all companies first, then filter in Python
            # This is a limitation of the current Supabase client
            all_companies = self.get_all()
            
            search_lower = search_term.lower()
            filtered_companies = [
                company for company in all_companies
                if (
                    search_lower in (company.get('name', '') or '').lower() or
                    search_lower in (company.get('address', '') or '').lower() or
                    search_lower in (company.get('email', '') or '').lower() or
                    search_lower in (company.get('phone', '') or '').lower() or
                    search_lower in (company.get('city', '') or '').lower() or
                    search_lower in (company.get('state', '') or '').lower()
                )
            ]
            
            # Sort by name
            filtered_companies.sort(key=lambda x: x.get('name', ''))
            
            return filtered_companies
            
        except Exception as e:
            logger.error(f"Error searching companies in Supabase: {e}")
            raise Exception(f"Failed to search companies: {e}")
    
    def unset_all_defaults(self):
        """Unset all companies as default"""
        try:
            # Get all companies and update them
            all_companies = self.get_all()
            for company in all_companies:
                if company.get('is_default'):
                    self.update(company['id'], {'is_default': False})
        except Exception as e:
            logger.error(f"Error unsetting default companies: {e}")
            raise
    
    def get_companies_with_stats(self) -> List[Dict[str, Any]]:
        """Get companies with additional statistics (basic implementation)"""
        try:
            # For now, just return companies without stats
            # Could be enhanced with stored procedures or additional queries
            companies = self.get_all()
            
            for company in companies:
                # Add placeholder stats
                company['invoice_count'] = 0
                company['estimate_count'] = 0
            
            return companies
            
        except Exception as e:
            logger.error(f"Error getting companies with stats in Supabase: {e}")
            return self.get_all()
    
    def get_companies_summary_stats(self) -> Dict[str, Any]:
        """Get companies statistics summary"""
        try:
            companies = self.get_all()
            total_companies = len(companies)
            active_companies = len([c for c in companies if c.get('is_active', True)])
            inactive_companies = total_companies - active_companies
            default_companies = len([c for c in companies if c.get('is_default', False)])
            
            return {
                'total_companies': total_companies,
                'active_companies': active_companies,
                'inactive_companies': inactive_companies,
                'default_companies': default_companies
            }
        except Exception as e:
            logger.error(f"Error getting companies summary stats: {e}")
            return {
                'total_companies': 0,
                'active_companies': 0,
                'inactive_companies': 0,
                'default_companies': 0
            }


class CompanyRepository:
    """Factory for company repository based on database session type"""
    
    def __new__(cls, session: DatabaseSession):
        """Create appropriate repository instance based on session type"""
        if hasattr(session, 'query'):  # SQLAlchemy session
            return CompanySQLAlchemyRepository(session)
        else:  # Supabase session
            return CompanySupabaseRepository(session)


def get_company_repository(session: DatabaseSession) -> CompanyRepositoryMixin:
    """Factory function to get appropriate company repository based on database type"""
    
    # Check if it's a UnitOfWork object
    if hasattr(session, 'session'):
        # It's a UnitOfWork, extract the actual session
        actual_session = session.session
        if hasattr(actual_session, 'query') or hasattr(actual_session, 'db_session'):
            # SQLAlchemy session
            return CompanySQLAlchemyRepository(actual_session)
        else:
            # Supabase client
            return CompanySupabaseRepository(actual_session)
    
    # Direct session check
    elif hasattr(session, 'query') or hasattr(session, 'db_session'):
        # SQLAlchemy session
        return CompanySQLAlchemyRepository(session)
    elif hasattr(session, 'table'):
        # Supabase client
        return CompanySupabaseRepository(session)
    else:
        # Default to Supabase for backward compatibility
        logger.warning(f"Could not determine session type for {type(session)}, defaulting to Supabase")
        return CompanySupabaseRepository(session)