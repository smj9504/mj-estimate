"""
Water Mitigation repository
"""

import logging
from typing import Any, Dict, List, Optional, Set
from uuid import UUID

from sqlalchemy import and_, desc, func, or_
from sqlalchemy.orm import joinedload

from app.common.base_repository import SQLAlchemyRepository
from app.core.interfaces import DatabaseSession

logger = logging.getLogger(__name__)

from .models import (
    PhotoCategory,
    WaterMitigationJob,
    WMJobStatusHistory,
    WMPhoto,
    WMReportConfig,
    WMSyncLog,
)


class WaterMitigationJobRepository(SQLAlchemyRepository[WaterMitigationJob, UUID]):
    """Water mitigation job repository"""

    def __init__(self, session: DatabaseSession):
        super().__init__(session, WaterMitigationJob)

    def _convert_to_dict(self, entity: Any, visited: Optional[Set] = None) -> Dict[str, Any]:
        """Convert job entity to dictionary, including company relationship"""
        # Get base conversion
        result = super()._convert_to_dict(entity, visited)

        # Add company relationship if loaded
        if hasattr(entity, 'company') and entity.company is not None:
            # Create a minimal company dict to avoid circular references
            result['company'] = {
                'id': str(entity.company.id),
                'name': entity.company.name,
                'company_code': entity.company.company_code if hasattr(entity.company, 'company_code') else None,
                'logo': entity.company.logo if hasattr(entity.company, 'logo') else None
            }

        return result

    def find_with_photos(self, job_id: UUID) -> Optional[WaterMitigationJob]:
        """Find job with photos eagerly loaded"""
        query = self.db_session.query(WaterMitigationJob).options(
            joinedload(WaterMitigationJob.photos)
        ).filter(WaterMitigationJob.id == job_id)

        result = query.first()
        return result

    def find_by_filters(
        self,
        client_id: Optional[UUID] = None,
        search: Optional[str] = None,
        status: Optional[List[str]] = None,
        active: Optional[bool] = None,
        page: int = 1,
        page_size: int = 50
    ) -> tuple[List[WaterMitigationJob], int]:
        """Find jobs with filters and pagination

        Optimized to fetch photo_count in a single query using subquery
        to avoid N+1 query problem.
        """
        from sqlalchemy.orm import aliased, joinedload

        # Subquery to count photos per job (exclude trashed photos)
        photo_count_subquery = (
            self.db_session.query(
                WMPhoto.job_id,
                func.count(WMPhoto.id).label('photo_count')
            )
            .filter(WMPhoto.is_trashed.is_(False))
            .group_by(WMPhoto.job_id)
            .subquery()
        )

        # Main query with photo count joined + eager-load company
        query = self.db_session.query(
            WaterMitigationJob,
            func.coalesce(photo_count_subquery.c.photo_count, 0).label('photo_count')
        ).outerjoin(
            photo_count_subquery,
            WaterMitigationJob.id == photo_count_subquery.c.job_id
        ).options(joinedload(WaterMitigationJob.company))

        # Apply filters
        conditions = []

        if client_id:
            conditions.append(WaterMitigationJob.client_id == client_id)

        if search:
            search_term = f"%{search}%"
            conditions.append(
                or_(
                    WaterMitigationJob.property_address.ilike(search_term),
                    WaterMitigationJob.homeowner_name.ilike(search_term),
                    WaterMitigationJob.claim_number.ilike(search_term)
                )
            )

        if status:
            conditions.append(WaterMitigationJob.status.in_(status))

        if active is not None:
            conditions.append(WaterMitigationJob.active == active)

        if conditions:
            query = query.filter(and_(*conditions))

        # Get total count (count only jobs, not the join result)
        total = self.db_session.query(WaterMitigationJob).filter(
            and_(*conditions) if conditions else True
        ).count()

        # Apply sorting: active jobs first, then by created_at
        query = query.order_by(
            desc(WaterMitigationJob.active),
            desc(WaterMitigationJob.created_at)
        )

        # Apply pagination
        offset = (page - 1) * page_size
        query = query.offset(offset).limit(page_size)

        # Execute and extract results with photo_count
        results_with_counts = query.all()

        # Attach photo_count to each job object
        results = []
        for job, photo_count in results_with_counts:
            # Add photo_count as an attribute for easy access
            job.photo_count = photo_count
            results.append(job)

        return results, total

    def find_by_address(self, address: str) -> Optional[WaterMitigationJob]:
        """Find job by property address"""
        return self.db_session.query(WaterMitigationJob).filter(
            WaterMitigationJob.property_address == address
        ).first()

    def find_by_companycam_project_id(self, project_id: str) -> Optional[WaterMitigationJob]:
        """Find job by CompanyCam project ID"""
        return self.db_session.query(WaterMitigationJob).filter(
            WaterMitigationJob.companycam_project_id == project_id
        ).first()

    def find_by_street_address(
        self,
        street: Optional[str] = None,
        city: Optional[str] = None,
        state: Optional[str] = None,
        active_only: bool = True
    ) -> Optional[WaterMitigationJob]:
        """
        Find job by street address, city, and state using fuzzy matching
        
        This method prevents duplicate leads by matching addresses even when:
        - States are in different formats (Maryland vs MD, Virginia vs VA)
        - Zipcodes are present or missing
        - Address formatting differs slightly
        
        Args:
            street: Street address
            city: City name
            state: State name or abbreviation
            active_only: Only search active jobs (default: True)
            
        Returns:
            Matching job or None
        """
        if not street:
            return None
        
        from app.domains.integrations.companycam.utils import (
            match_street_address,
            normalize_state,
            normalize_street_address,
        )
        
        # Get all active jobs (or all jobs if active_only=False)
        query = self.db_session.query(WaterMitigationJob)
        if active_only:
            query = query.filter(WaterMitigationJob.active.is_(True))

        jobs = query.all()

        best_match = None
        best_confidence = 0.0
        
        for job in jobs:
            # Skip if job doesn't have street address
            if not job.property_street:
                continue
            
            # Match using the street address matching function
            is_match, confidence, match_type = match_street_address(
                street,
                city,
                state,
                job.property_street,
                job.property_city,
                job.property_state,
                threshold=0.85
            )
            
            if is_match and confidence > best_confidence:
                best_match = job
                best_confidence = confidence
                
                # If we have a very high confidence match, return immediately
                if confidence >= 0.98:
                    return best_match
        
        return best_match if best_confidence >= 0.85 else None


class PhotoCategoryRepository(SQLAlchemyRepository[PhotoCategory, UUID]):
    """Photo category repository"""

    def __init__(self, session: DatabaseSession):
        super().__init__(session, PhotoCategory)

    def find_by_client(self, client_id: UUID) -> List[PhotoCategory]:
        """Find all categories for a client"""
        return self.db_session.query(PhotoCategory).filter(
            PhotoCategory.client_id == client_id,
            PhotoCategory.is_active.is_(True)
        ).order_by(PhotoCategory.display_order).all()

    def find_by_name(self, client_id: UUID, category_name: str) -> Optional[PhotoCategory]:
        """Find category by name"""
        return self.db_session.query(PhotoCategory).filter(
            PhotoCategory.client_id == client_id,
            PhotoCategory.category_name == category_name
        ).first()


class WMPhotoRepository(SQLAlchemyRepository[WMPhoto, UUID]):
    """Water mitigation photo repository"""

    def __init__(self, session: DatabaseSession):
        super().__init__(session, WMPhoto)

    def find_by_job(self, job_id: UUID) -> List[WMPhoto]:
        """Find all photos for a job (excludes trashed photos)"""
        return self.db_session.query(WMPhoto).filter(
            WMPhoto.job_id == job_id,
            WMPhoto.is_trashed.is_(False)
        ).order_by(desc(WMPhoto.captured_date)).all()

    def find_by_job_paginated(
        self,
        job_id: UUID,
        page: int = 1,
        page_size: int = 50,
        sort_by: str = 'captured_date',
        sort_order: str = 'desc',
        category_filter: Optional[List[str]] = None,
        uncategorized_only: bool = False,
        skip: Optional[int] = None
    ) -> tuple[List[WMPhoto], Optional[int]]:
        """Find photos for a job with pagination and optional category filtering

        Args:
            skip: Optional explicit offset. If provided, overrides page-based calculation.
                  Useful when client uses variable page sizes.

        Returns:
            Tuple of (photos, total_count)
        """
        # Base query (exclude trashed photos by default)
        query = self.db_session.query(WMPhoto).filter(
            WMPhoto.job_id == job_id,
            WMPhoto.is_trashed.is_(False)
        )

        # Apply category filters at database level (more efficient)
        if uncategorized_only:
            query = query.filter(
                or_(
                    WMPhoto.category.is_(None),
                    WMPhoto.category == ''
                )
            )
        elif category_filter:
            # Filter by multiple categories (OR logic) with case-insensitive matching
            # Normalize both DB values and filter values for comparison
            # This handles variations like "Day 3" vs "day-3" vs "day_3"
            normalized_conditions = []
            for cat in category_filter:
                # Normalize filter value: lowercase, replace spaces/underscores with hyphens
                normalized_cat = cat.lower().strip().replace(' ', '-').replace('_', '-')

                # Special handling for 'uncategorized' - match NULL and empty strings
                if normalized_cat == 'uncategorized':
                    normalized_conditions.append(WMPhoto.category.is_(None))
                    normalized_conditions.append(WMPhoto.category == '')
                else:
                    # Match against normalized DB value
                    normalized_conditions.append(
                        func.lower(func.replace(func.replace(WMPhoto.category, ' ', '-'), '_', '-')) == normalized_cat
                    )
            query = query.filter(or_(*normalized_conditions))
            normalized_cats = [
                c.lower().strip().replace(' ', '-').replace('_', '-')
                for c in category_filter
            ]
            logger.info(
                f"📸 Category filter: {category_filter} → {normalized_cats}"
            )

        # Get total count (after filters) - only for first page
        # Skip count for later pages to significantly improve performance
        total = None
        if page == 1:
            # Only count on first page - this is the most expensive operation
            total = query.count()
            if category_filter:
                logger.info(f"📸 Total matching '{category_filter}': {total}")

        # Apply sorting with secondary sort by id for deterministic ordering
        # This ensures consistent pagination even when primary sort field has duplicates
        if sort_order.lower() == 'asc':
            order_clause = [getattr(WMPhoto, sort_by).asc(), WMPhoto.id.asc()]
        else:
            order_clause = [getattr(WMPhoto, sort_by).desc(), WMPhoto.id.desc()]

        # Use standard offset pagination
        # Note: Offset pagination is simpler and more reliable than keyset pagination
        # for fields like captured_date that can have duplicate values
        # If skip is provided, use it; otherwise calculate from page number
        offset = skip if skip is not None else (page - 1) * page_size
        photos = query.order_by(*order_clause).limit(page_size).offset(offset).all()

        return photos, total

    def find_by_ids(self, photo_ids: List[UUID], include_trashed: bool = False) -> List[WMPhoto]:
        """Find multiple photos by their IDs in a single query (optimized for batch operations)

        Args:
            photo_ids: List of photo UUIDs to fetch
            include_trashed: If False (default), excludes trashed photos
        """
        if not photo_ids:
            return []

        query = self.db_session.query(WMPhoto).filter(
            WMPhoto.id.in_(photo_ids)
        )

        if not include_trashed:
            query = query.filter(WMPhoto.is_trashed.is_(False))

        return query.all()

    def count_by_job(self, job_id: UUID) -> int:
        """Count photos for a job (exclude trashed)"""
        return self.db_session.query(WMPhoto).filter(
            WMPhoto.job_id == job_id,
            WMPhoto.is_trashed.is_(False)
        ).count()

    def get_category_counts(self, job_id: UUID) -> Dict[str, int]:
        """Get count of photos per category for debugging

        Returns:
            Dict mapping category name -> count
        """
        from collections import defaultdict

        photos = self.db_session.query(WMPhoto.category).filter(
            WMPhoto.job_id == job_id,
            WMPhoto.is_trashed.is_(False)
        ).all()

        counts: Dict[str, int] = defaultdict(int)
        for (category,) in photos:
            cat = category if category else 'uncategorized'
            counts[cat] += 1

        return dict(counts)

    def find_by_job_with_external_ids(
        self,
        job_id: UUID,
        include_trashed: bool = True
    ) -> Dict[str, WMPhoto]:
        """
        Find all photos for a job and return as dict keyed by external_id.

        Used for CompanyCam sync to quickly check which photos already exist.
        Photos without external_id are excluded from the result.

        Args:
            job_id: Water mitigation job ID
            include_trashed: Include trashed photos in result (default True)

        Returns:
            Dict mapping external_id -> WMPhoto
        """
        query = self.db_session.query(WMPhoto).filter(
            WMPhoto.job_id == job_id,
            WMPhoto.external_id.isnot(None)
        )

        if not include_trashed:
            query = query.filter(WMPhoto.is_trashed.is_(False))

        photos = query.all()
        return {photo.external_id: photo for photo in photos}

    def get_external_ids_for_job(self, job_id: UUID) -> Set[str]:
        """
        Get all external_ids for a job's photos (including trashed).

        Optimized query that only fetches external_id column.

        Args:
            job_id: Water mitigation job ID

        Returns:
            Set of external_ids (excluding None values)
        """
        results = self.db_session.query(WMPhoto.external_id).filter(
            WMPhoto.job_id == job_id,
            WMPhoto.external_id.isnot(None)
        ).all()
        return {r[0] for r in results}

    def find_companycam_photos(self, job_id: UUID) -> List[WMPhoto]:
        """
        Find all CompanyCam photos for a job (excludes trashed and manual uploads).

        Used for Google Drive export to only export photos sourced from CompanyCam.

        Args:
            job_id: Water mitigation job ID

        Returns:
            List of WMPhoto objects with source='companycam'
        """
        return self.db_session.query(WMPhoto).filter(
            WMPhoto.job_id == job_id,
            WMPhoto.is_trashed.is_(False),
            WMPhoto.source == 'companycam'
        ).order_by(WMPhoto.captured_date.asc()).all()

    def get_all_external_ids(self, external_ids: List[str]) -> Set[str]:
        """
        Check which external_ids already exist in the database (any job).

        Optimized batch query for duplicate detection during sync.

        Args:
            external_ids: List of external_ids to check

        Returns:
            Set of external_ids that already exist
        """
        if not external_ids:
            return set()
        results = self.db_session.query(WMPhoto.external_id).filter(
            WMPhoto.external_id.in_(external_ids)
        ).all()
        return {r[0] for r in results}

    def bulk_update_category(self, photo_ids: List[str], category: str) -> int:
        """
        Bulk update category for multiple photos in a single query.

        Args:
            photo_ids: List of photo IDs to update
            category: Category value to set

        Returns:
            Number of photos updated
        """
        if not photo_ids:
            return 0

        # Convert string IDs to UUIDs if needed
        from uuid import UUID as PyUUID
        uuid_list = []
        for pid in photo_ids:
            if isinstance(pid, str):
                uuid_list.append(PyUUID(pid))
            else:
                uuid_list.append(pid)

        # Single UPDATE query for all photos
        result = self.db_session.query(WMPhoto).filter(
            WMPhoto.id.in_(uuid_list)
        ).update(
            {"category": category},
            synchronize_session='fetch'
        )

        return result

    def find_duplicates_by_external_id(
        self, job_id: Optional[UUID] = None
    ) -> List[Dict[str, Any]]:
        """
        Find duplicate photos by external_id.

        Returns list of dicts with external_id, count, and photo_ids.
        """
        from sqlalchemy import func

        query = self.db_session.query(
            WMPhoto.external_id,
            WMPhoto.job_id,
            func.count(WMPhoto.id).label('count'),
            func.array_agg(WMPhoto.id).label('photo_ids')
        ).filter(
            WMPhoto.external_id.isnot(None),
            WMPhoto.is_trashed.is_(False)
        )

        if job_id:
            query = query.filter(WMPhoto.job_id == job_id)

        query = query.group_by(
            WMPhoto.external_id, WMPhoto.job_id
        ).having(
            func.count(WMPhoto.id) > 1
        )

        results = query.all()
        return [
            {
                'external_id': r.external_id,
                'job_id': str(r.job_id),
                'count': r.count,
                'photo_ids': [str(pid) for pid in r.photo_ids]
            }
            for r in results
        ]

    def delete_duplicate_photos(
        self, job_id: Optional[UUID] = None, dry_run: bool = True
    ) -> Dict[str, Any]:
        """
        Delete duplicate photos, keeping the oldest one.

        Args:
            job_id: Optional job ID to limit scope
            dry_run: If True, only report what would be deleted

        Returns:
            Dict with deleted_count and details
        """
        duplicates = self.find_duplicates_by_external_id(job_id)

        if not duplicates:
            return {'deleted_count': 0, 'duplicates': []}

        to_delete = []
        for dup in duplicates:
            # Keep first (oldest by ID), delete rest
            photo_ids = dup['photo_ids']
            if len(photo_ids) > 1:
                to_delete.extend(photo_ids[1:])  # Skip first, delete rest

        if dry_run:
            return {
                'deleted_count': len(to_delete),
                'duplicates': duplicates,
                'to_delete': to_delete,
                'dry_run': True
            }

        # Actually delete
        if to_delete:
            from uuid import UUID as PyUUID
            uuid_list = [PyUUID(pid) for pid in to_delete]
            self.db_session.query(WMPhoto).filter(
                WMPhoto.id.in_(uuid_list)
            ).delete(synchronize_session='fetch')

        return {
            'deleted_count': len(to_delete),
            'duplicates': duplicates,
            'deleted_ids': to_delete,
            'dry_run': False
        }

    def bulk_update_captured_date_by_category(
        self,
        job_id: UUID,
        category_pattern: str,
        new_date: Any
    ) -> int:
        """
        Bulk update captured_date for photos matching a category pattern.

        Uses case-insensitive LIKE matching to handle variations like:
        - "Day 2", "day 2", "Day2", "day2"

        Args:
            job_id: Water mitigation job ID
            category_pattern: SQL LIKE pattern (e.g., '%day%2%')
            new_date: New date to set (datetime object)

        Returns:
            Number of photos updated
        """
        from datetime import datetime
        from sqlalchemy import func

        # Use LOWER() for case-insensitive matching
        # Also remove spaces for normalized matching
        result = self.db_session.query(WMPhoto).filter(
            WMPhoto.job_id == job_id,
            WMPhoto.is_trashed.is_(False),
            WMPhoto.category.isnot(None),
            WMPhoto.category != '',
            # Case-insensitive LIKE match
            func.lower(func.replace(WMPhoto.category, ' ', '')).like(
                category_pattern.lower().replace(' ', '')
            )
        ).update(
            {"captured_date": new_date},
            synchronize_session='fetch'
        )

        return result

    def bulk_update_captured_date_for_other_categories(
        self,
        job_id: UUID,
        exclude_patterns: List[str],
        new_date: Any
    ) -> int:
        """
        Bulk update captured_date for photos NOT matching specified category patterns.

        Args:
            job_id: Water mitigation job ID
            exclude_patterns: List of SQL LIKE patterns to exclude (e.g., ['%day%2%', '%day%3%'])
            new_date: New date to set (datetime object)

        Returns:
            Number of photos updated
        """
        from datetime import datetime
        from sqlalchemy import func, not_, and_

        # Build exclude conditions
        exclude_conditions = []
        for pattern in exclude_patterns:
            exclude_conditions.append(
                func.lower(func.replace(WMPhoto.category, ' ', '')).like(
                    pattern.lower().replace(' ', '')
                )
            )

        # Photos with categories that DON'T match exclude patterns
        result = self.db_session.query(WMPhoto).filter(
            WMPhoto.job_id == job_id,
            WMPhoto.is_trashed.is_(False),
            WMPhoto.category.isnot(None),
            WMPhoto.category != '',
            not_(or_(*exclude_conditions)) if exclude_conditions else True
        ).update(
            {"captured_date": new_date},
            synchronize_session='fetch'
        )

        return result


class WMJobStatusHistoryRepository(SQLAlchemyRepository[WMJobStatusHistory, UUID]):
    """Job status history repository"""

    def __init__(self, session: DatabaseSession):
        super().__init__(session, WMJobStatusHistory)

    def find_by_job(self, job_id: UUID) -> List[WMJobStatusHistory]:
        """Find status history for a job"""
        return self.db_session.query(WMJobStatusHistory).filter(
            WMJobStatusHistory.job_id == job_id
        ).order_by(desc(WMJobStatusHistory.changed_at)).all()


class WMSyncLogRepository(SQLAlchemyRepository[WMSyncLog, UUID]):
    """Sync log repository"""

    def __init__(self, session: DatabaseSession):
        super().__init__(session, WMSyncLog)

    def find_latest_by_type(self, integration_type: str) -> Optional[WMSyncLog]:
        """Find latest sync log by integration type"""
        return self.db_session.query(WMSyncLog).filter(
            WMSyncLog.integration_type == integration_type
        ).order_by(desc(WMSyncLog.started_at)).first()


class WMReportConfigRepository(SQLAlchemyRepository[WMReportConfig, UUID]):
    """Report config repository"""

    def __init__(self, session: DatabaseSession):
        super().__init__(session, WMReportConfig)

    def find_by_job_id(self, job_id: UUID) -> Optional[WMReportConfig]:
        """Find report config by job ID"""
        return self.db_session.query(WMReportConfig).filter(
            WMReportConfig.job_id == job_id
        ).first()

    def delete_by_job_id(self, job_id: UUID) -> bool:
        """Delete report config by job ID"""
        config = self.find_by_job_id(job_id)
        if config:
            self.db_session.delete(config)
            return True
        return False
