"""
Water Mitigation repository
"""

from typing import List, Optional, Dict, Any
from uuid import UUID
from datetime import datetime
from sqlalchemy import and_, or_, func, desc
from sqlalchemy.orm import joinedload

from app.common.base_repository import SQLAlchemyRepository
from app.core.interfaces import DatabaseSession
from .models import (
    WaterMitigationJob,
    PhotoCategory,
    WMPhoto,
    WMPhotoCategory,
    WMJobStatusHistory,
    WMSyncLog,
    WMReportConfig
)


class WaterMitigationJobRepository(SQLAlchemyRepository[WaterMitigationJob, UUID]):
    """Water mitigation job repository"""

    def __init__(self, session: DatabaseSession):
        super().__init__(session, WaterMitigationJob)

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
        from sqlalchemy.orm import aliased

        # Subquery to count photos per job
        photo_count_subquery = (
            self.db_session.query(
                WMPhoto.job_id,
                func.count(WMPhoto.id).label('photo_count')
            )
            .group_by(WMPhoto.job_id)
            .subquery()
        )

        # Main query with photo count joined
        query = self.db_session.query(
            WaterMitigationJob,
            func.coalesce(photo_count_subquery.c.photo_count, 0).label('photo_count')
        ).outerjoin(
            photo_count_subquery,
            WaterMitigationJob.id == photo_count_subquery.c.job_id
        )

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


class PhotoCategoryRepository(SQLAlchemyRepository[PhotoCategory, UUID]):
    """Photo category repository"""

    def __init__(self, session: DatabaseSession):
        super().__init__(session, PhotoCategory)

    def find_by_client(self, client_id: UUID) -> List[PhotoCategory]:
        """Find all categories for a client"""
        return self.db_session.query(PhotoCategory).filter(
            PhotoCategory.client_id == client_id,
            PhotoCategory.is_active == True
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
        """Find all photos for a job"""
        return self.db_session.query(WMPhoto).filter(
            WMPhoto.job_id == job_id
        ).order_by(desc(WMPhoto.captured_date)).all()

    def find_by_job_paginated(
        self,
        job_id: UUID,
        page: int = 1,
        page_size: int = 50,
        sort_by: str = 'captured_date',
        sort_order: str = 'desc'
    ) -> tuple[List[WMPhoto], int]:
        """Find photos for a job with pagination

        Returns:
            Tuple of (photos, total_count)
        """
        # Base query
        query = self.db_session.query(WMPhoto).filter(
            WMPhoto.job_id == job_id
        )

        # Get total count
        total = query.count()

        # Apply sorting
        if sort_order.lower() == 'asc':
            order_clause = getattr(WMPhoto, sort_by).asc()
        else:
            order_clause = getattr(WMPhoto, sort_by).desc()

        # Apply pagination
        photos = query.order_by(order_clause).limit(page_size).offset((page - 1) * page_size).all()

        return photos, total

    def count_by_job(self, job_id: UUID) -> int:
        """Count photos for a job"""
        return self.db_session.query(WMPhoto).filter(
            WMPhoto.job_id == job_id
        ).count()


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
