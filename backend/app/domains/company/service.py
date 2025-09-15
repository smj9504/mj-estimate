"""
Company domain service with business logic
"""

from typing import Any, Dict, List, Optional
import logging
import random
import string
from fastapi import UploadFile
import base64

from app.common.base_service import BaseService
from app.core.interfaces import DatabaseProvider
from .repository import CompanyRepository
from .schemas import CompanyCreate, CompanyUpdate, CompanyFilter

logger = logging.getLogger(__name__)


class CompanyService(BaseService[Dict[str, Any], str]):
    """
    Service for company-related business operations.
    Provides comprehensive CRUD operations with validation and business logic.
    """
    
    def __init__(self, database: DatabaseProvider = None):
        super().__init__(database)
    
    def get_repository(self):
        """Get the company repository - implemented by base class"""
        return CompanyRepository
    
    def _get_repository_instance(self, session):
        """Get company repository instance with the given session"""
        return CompanyRepository(session)
    
    def generate_company_code(self, company_name: str, existing_codes: List[str] = None) -> str:
        """
        Generate a unique 4-character company code based on company name.
        
        Args:
            company_name: Name of the company
            existing_codes: List of existing codes to avoid duplicates
            
        Returns:
            Unique 4-character company code
        """
        if existing_codes is None:
            existing_codes = []
        
        # Extract uppercase letters from company name
        name_letters = ''.join([c.upper() for c in company_name if c.isalpha()])
        
        # Generate code with mix of letters from name and random characters
        code_chars = []
        
        # Try to use first 2 letters from company name
        if len(name_letters) >= 2:
            code_chars.extend(list(name_letters[:2]))
        elif len(name_letters) == 1:
            code_chars.append(name_letters[0])
            code_chars.append(random.choice(string.ascii_uppercase))
        else:
            # No letters in name, use random letters
            code_chars.extend([random.choice(string.ascii_uppercase) for _ in range(2)])
        
        # Add 2 random digits or letters
        for _ in range(2):
            if random.choice([True, False]):
                code_chars.append(random.choice(string.digits))
            else:
                code_chars.append(random.choice(string.ascii_uppercase))
        
        code = ''.join(code_chars)
        
        # Check if code already exists
        if code in existing_codes:
            # Generate a new one with more randomness
            return self.generate_company_code(
                company_name + str(random.randint(1, 999)), 
                existing_codes
            )
        
        return code
    
    def search_companies(self, search_term: str) -> List[Dict[str, Any]]:
        """
        Search companies by name, address, email, or phone.
        
        Args:
            search_term: Text to search for
            
        Returns:
            List of matching company dictionaries
        """
        try:
            session = self.database.get_session()
            try:
                repository = self._get_repository_instance(session)
                return repository.search_companies(search_term)
            finally:
                session.close()
        except Exception as e:
            logger.error(f"Error searching companies: {e}")
            raise
    
    def get_companies_with_filters(self, 
                                   filter_params: CompanyFilter,
                                   limit: Optional[int] = None,
                                   offset: Optional[int] = None) -> Dict[str, Any]:
        """
        Get companies with comprehensive filtering options.
        
        Args:
            filter_params: Company filter parameters
            limit: Maximum number of results
            offset: Number of results to skip
            
        Returns:
            Dictionary with companies and metadata
        """
        try:
            session = self.database.get_session()
            try:
                repository = self._get_repository_instance(session)
                companies = repository.get_by_filters(
                    search=filter_params.search,
                    city=filter_params.city,
                    state=filter_params.state,
                    is_active=filter_params.is_active,
                    is_default=filter_params.is_default,
                    limit=limit,
                    offset=offset
                )
                
                # Try to get total count, fallback to length if count fails
                try:
                    total_count = repository.count()
                except Exception as count_error:
                    logger.warning(f"Failed to get total count, using companies length: {count_error}")
                    total_count = len(companies)
                
                return {
                    'companies': companies,
                    'total': total_count,
                    'count': len(companies),
                    'has_more': len(companies) == limit if limit else False
                }
            finally:
                session.close()
        except Exception as e:
            logger.error(f"Error getting companies with filters: {e}")
            raise
    
    def get_by_email(self, email: str) -> Optional[Dict[str, Any]]:
        """
        Get company by email address.
        
        Args:
            email: Company email address
            
        Returns:
            Company dictionary or None if not found
        """
        try:
            session = self.database.get_session()
            try:
                repository = self._get_repository_instance(session)
                return repository.get_by_email(email)
            finally:
                session.close()
        except Exception as e:
            logger.error(f"Error getting company by email: {e}")
            raise
    
    def get_by_name(self, name: str) -> Optional[Dict[str, Any]]:
        """
        Get company by exact name match.
        
        Args:
            name: Company name
            
        Returns:
            Company dictionary or None if not found
        """
        try:
            session = self.database.get_session()
            try:
                repository = self._get_repository_instance(session)
                return repository.get_by_name(name)
            finally:
                session.close()
        except Exception as e:
            logger.error(f"Error getting company by name: {e}")
            raise
    
    def get_companies_with_stats(self) -> List[Dict[str, Any]]:
        """
        Get companies with additional statistics (invoice count, estimate count).
        
        Returns:
            List of company dictionaries with statistics
        """
        try:
            session = self.database.get_session()
            try:
                repository = self._get_repository_instance(session)
                return repository.get_companies_with_stats()
            finally:
                session.close()
        except Exception as e:
            logger.error(f"Error getting companies with stats: {e}")
            raise
    
    def create(self, company_data: CompanyCreate) -> Dict[str, Any]:
        """
        Create a new company with validation and business logic.
        
        Args:
            company_data: Company creation data
            
        Returns:
            Created company dictionary
        """
        # Convert to dict
        data = company_data.model_dump()
        
        # Validate required fields
        validated_data = self._validate_create_data(data)
        
        # Generate company code if not provided
        if not validated_data.get('company_code'):
            # Get existing codes to avoid duplicates
            existing_codes = []
            try:
                existing_companies = self.get_all()
                existing_codes = [
                    c.get('company_code') for c in existing_companies 
                    if c.get('company_code')
                ]
            except Exception:
                logger.warning("Could not retrieve existing company codes")
            
            validated_data['company_code'] = self.generate_company_code(
                validated_data.get('name', ''), existing_codes
            )
        
        return super().create(validated_data)
    
    def update(self, company_id: str, update_data: CompanyUpdate) -> Optional[Dict[str, Any]]:
        """
        Update a company with validation.
        
        Args:
            company_id: Company ID
            update_data: Updated company data
            
        Returns:
            Updated company dictionary or None if not found
        """
        # Convert to dict, excluding None values
        data = update_data.model_dump(exclude_none=True)
        
        # Validate update data
        validated_data = self._validate_update_data(data)
        
        return super().update(company_id, validated_data)
    
    async def upload_logo(self, company_id: str, file: UploadFile) -> Dict[str, str]:
        """
        Upload and process company logo.
        
        Args:
            company_id: Company ID
            file: Uploaded logo file
            
        Returns:
            Dictionary with logo data and message
        """
        try:
            # Validate file type
            if not file.content_type or not file.content_type.startswith("image/"):
                raise ValueError("File must be an image")
            
            # Validate file size (5MB limit)
            content = await file.read()
            if len(content) > 5 * 1024 * 1024:
                raise ValueError("File size must be less than 5MB")
            
            # Convert to base64
            base64_str = base64.b64encode(content).decode('utf-8')
            logo_data = f"data:{file.content_type};base64,{base64_str}"
            
            # Update company with logo
            update_data = CompanyUpdate(logo=logo_data)
            updated_company = self.update(company_id, update_data)
            
            if not updated_company:
                raise ValueError(f"Company with ID {company_id} not found")
            
            return {
                "logo": logo_data,
                "message": "Logo uploaded successfully"
            }
        except Exception as e:
            logger.error(f"Error uploading logo: {e}")
            raise
    
    def set_default_company(self, company_id: str) -> Optional[Dict[str, Any]]:
        """
        Set a company as the default company.
        
        Args:
            company_id: Company ID to set as default
            
        Returns:
            Updated company dictionary or None if not found
        """
        try:
            session = self.database.get_session()
            try:
                repository = self._get_repository_instance(session)
                
                # First, unset all default companies
                repository.unset_all_defaults()
                
                # Then set the selected company as default
                update_data = CompanyUpdate(is_default=True)
                return self.update(company_id, update_data)
            finally:
                session.close()
        except Exception as e:
            logger.error(f"Error setting default company: {e}")
            raise
    
    def get_company_by_email(self, email: str) -> Optional[Dict[str, Any]]:
        """
        Get company by email address.
        
        Args:
            email: Email address to search for
            
        Returns:
            Company dictionary or None if not found
        """
        try:
            session = self.database.get_session()
            try:
                repository = self._get_repository_instance(session)
                return repository.get_company_by_email(email)
            finally:
                session.close()
        except Exception as e:
            logger.error(f"Error getting company by email {email}: {e}")
            raise
    
    def get_companies_summary_stats(self) -> Dict[str, Any]:
        """
        Get companies statistics summary including total count, active count, etc.
        
        Returns:
            Dictionary with summary statistics
        """
        try:
            session = self.database.get_session()
            try:
                repository = self._get_repository_instance(session)
                return repository.get_companies_summary_stats()
            finally:
                session.close()
        except Exception as e:
            logger.error(f"Error getting companies summary stats: {e}")
            raise

    def get_companies_paginated(self, filter_params: CompanyFilter, 
                               limit: int, offset: int) -> tuple[List[Dict[str, Any]], int]:
        """
        Get companies with pagination and filters
        
        Args:
            filter_params: Filter parameters
            limit: Maximum number of results
            offset: Number of results to skip
            
        Returns:
            Tuple of (companies list, total count)
        """
        try:
            result = self.get_companies_with_filters(
                filter_params=filter_params,
                limit=limit,
                offset=offset
            )
            return result['companies'], result['total']
        except Exception as e:
            logger.error(f"Error getting companies paginated: {e}")
            raise