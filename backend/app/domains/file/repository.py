"""
File repository for data access operations
"""

from typing import List, Optional, Dict, Any
from sqlalchemy.orm import Session
from sqlalchemy import and_, or_, desc

from app.common.base_repository import SQLAlchemyRepository
from .models import File


class FileRepository(SQLAlchemyRepository):
    """Repository for file operations"""

    def __init__(self, session: Session):
        super().__init__(session, File)

    def get_by_context(
        self,
        context: str,
        context_id: str,
        category: Optional[str] = None,
        is_active: bool = True
    ) -> List[Dict[str, Any]]:
        """Get files by context and context_id"""
        query = self.session.query(File).filter(
            and_(
                File.context == context,
                File.context_id == context_id,
                File.is_active == is_active
            )
        )

        if category and category != 'all':
            query = query.filter(File.category == category)

        query = query.order_by(desc(File.upload_date))

        files = query.all()
        return [self._convert_to_dict(file) for file in files]

    def get_count_by_context(
        self,
        context: str,
        context_id: str,
        category: Optional[str] = None,
        is_active: bool = True
    ) -> int:
        """Get file count by context and context_id"""
        query = self.session.query(File).filter(
            and_(
                File.context == context,
                File.context_id == context_id,
                File.is_active == is_active
            )
        )

        if category and category != 'all':
            query = query.filter(File.category == category)

        return query.count()

    def get_count_by_file_type(
        self,
        context: str,
        context_id: str,
        file_type: str,
        is_active: bool = True
    ) -> int:
        """Get file count by file type (image/document)"""
        query = self.session.query(File).filter(
            and_(
                File.context == context,
                File.context_id == context_id,
                File.is_active == is_active
            )
        )

        if file_type == 'image':
            query = query.filter(File.content_type.like('image/%'))
        elif file_type == 'document':
            query = query.filter(~File.content_type.like('image/%'))

        return query.count()

    def get_by_file_type(
        self,
        context: str,
        context_id: str,
        file_type: str,
        is_active: bool = True
    ) -> List[Dict[str, Any]]:
        """Get files by file type (image/document)"""
        query = self.session.query(File).filter(
            and_(
                File.context == context,
                File.context_id == context_id,
                File.is_active == is_active
            )
        )

        if file_type == 'image':
            query = query.filter(File.content_type.like('image/%'))
        elif file_type == 'document':
            query = query.filter(~File.content_type.like('image/%'))

        query = query.order_by(desc(File.upload_date))

        files = query.all()
        return [self._convert_to_dict(file) for file in files]

    def get_categories_by_context(
        self,
        context: str,
        context_id: str,
        is_active: bool = True
    ) -> List[str]:
        """Get unique categories for a context"""
        categories = self.session.query(File.category).filter(
            and_(
                File.context == context,
                File.context_id == context_id,
                File.is_active == is_active
            )
        ).distinct().all()

        return [cat[0] for cat in categories if cat[0]]

    def search_files(
        self,
        context: str,
        context_id: str,
        query: str,
        is_active: bool = True
    ) -> List[Dict[str, Any]]:
        """Search files by filename or description"""
        search_query = self.session.query(File).filter(
            and_(
                File.context == context,
                File.context_id == context_id,
                File.is_active == is_active,
                or_(
                    File.filename.ilike(f'%{query}%'),
                    File.original_name.ilike(f'%{query}%'),
                    File.description.ilike(f'%{query}%')
                )
            )
        ).order_by(desc(File.upload_date))

        files = search_query.all()
        return [self._convert_to_dict(file) for file in files]

    def soft_delete(self, file_id: str) -> bool:
        """Soft delete a file by setting is_active to False"""
        file = self.session.query(File).filter(File.id == file_id).first()
        if file:
            file.is_active = False
            self.session.commit()
            return True
        return False

