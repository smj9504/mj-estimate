"""
Repository for WMDocument operations
"""

from typing import List, Optional, Dict, Any
from sqlalchemy import and_
import logging

from app.common.base_repository import BaseRepository
from .models import WMDocument

logger = logging.getLogger(__name__)


class WMDocumentRepository(BaseRepository[WMDocument, str]):
    """Repository for water mitigation document operations"""

    def __init__(self, session):
        super().__init__(session, WMDocument, "wm_documents")

    # Implement required abstract methods from Repository interface
    def create(self, entity_data: Dict[str, Any]) -> WMDocument:
        """Create a new document"""
        document = WMDocument(**entity_data)
        self.session.add(document)
        self.session.flush()
        return document

    def get_by_id(self, entity_id: str) -> Optional[WMDocument]:
        """Get document by ID"""
        return self.session.query(WMDocument).filter(WMDocument.id == entity_id).first()

    def get_all(self,
                filters: Optional[Dict[str, Any]] = None,
                order_by: Optional[str] = None,
                limit: Optional[int] = None,
                offset: Optional[int] = None) -> List[WMDocument]:
        """Get all documents with optional filters and pagination"""
        query = self.session.query(WMDocument)

        if filters:
            for key, value in filters.items():
                if hasattr(WMDocument, key):
                    query = query.filter(getattr(WMDocument, key) == value)

        if order_by:
            if hasattr(WMDocument, order_by):
                query = query.order_by(getattr(WMDocument, order_by))

        if offset:
            query = query.offset(offset)

        if limit:
            query = query.limit(limit)

        return query.all()

    def update(self, entity_id: str, update_data: Dict[str, Any]) -> Optional[WMDocument]:
        """Update document by ID"""
        document = self.get_by_id(entity_id)
        if not document:
            return None

        for key, value in update_data.items():
            if hasattr(document, key):
                setattr(document, key, value)

        self.session.flush()
        return document

    def delete(self, entity_id: str) -> bool:
        """Delete document by ID"""
        document = self.get_by_id(entity_id)
        if not document:
            return False

        self.session.delete(document)
        self.session.flush()
        return True

    def exists(self, entity_id: str) -> bool:
        """Check if document exists"""
        return self.session.query(WMDocument).filter(WMDocument.id == entity_id).count() > 0

    def count(self, filters: Optional[Dict[str, Any]] = None) -> int:
        """Count documents with optional filters"""
        query = self.session.query(WMDocument)

        if filters:
            for key, value in filters.items():
                if hasattr(WMDocument, key):
                    query = query.filter(getattr(WMDocument, key) == value)

        return query.count()

    # Domain-specific methods
    def get_by_job(self, job_id: str, is_active: bool = True) -> List[WMDocument]:
        """Get all documents for a job"""
        try:
            filters = [WMDocument.job_id == job_id]
            if is_active is not None:
                filters.append(WMDocument.is_active == is_active)

            documents = self.session.query(WMDocument).filter(
                and_(*filters)
            ).order_by(WMDocument.created_at.desc()).all()

            logger.info(f"Retrieved {len(documents)} documents for job {job_id}")
            return documents
        except Exception as e:
            logger.error(f"Error getting documents for job {job_id}: {e}")
            return []

    def get_by_type(self, job_id: str, document_type: str, is_active: bool = True) -> List[WMDocument]:
        """Get documents by type for a job"""
        try:
            filters = [
                WMDocument.job_id == job_id,
                WMDocument.document_type == document_type
            ]
            if is_active is not None:
                filters.append(WMDocument.is_active == is_active)

            documents = self.session.query(WMDocument).filter(
                and_(*filters)
            ).order_by(WMDocument.created_at.desc()).all()

            return documents
        except Exception as e:
            logger.error(f"Error getting documents of type {document_type} for job {job_id}: {e}")
            return []

    def count_by_job(self, job_id: str, is_active: bool = True) -> int:
        """Count documents for a job"""
        try:
            filters = [WMDocument.job_id == job_id]
            if is_active is not None:
                filters.append(WMDocument.is_active == is_active)

            count = self.session.query(WMDocument).filter(and_(*filters)).count()
            return count
        except Exception as e:
            logger.error(f"Error counting documents for job {job_id}: {e}")
            return 0

    def soft_delete(self, document_id: str) -> bool:
        """Soft delete a document by setting is_active to False"""
        try:
            document = self.get_by_id(document_id)
            if not document:
                return False

            updated = self.update(document_id, {"is_active": False})
            logger.info(f"Soft deleted document {document_id}")
            return updated is not None
        except Exception as e:
            logger.error(f"Error soft deleting document {document_id}: {e}")
            return False
