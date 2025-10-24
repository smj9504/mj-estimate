"""
Water Mitigation Photo Adapter
Converts WMPhoto models to FileItem format for unified file API
"""

from typing import List, Dict, Any, Optional
from datetime import datetime
from pathlib import Path

from app.domains.water_mitigation.models import WMPhoto


class WMPhotoAdapter:
    """Adapter to convert WMPhoto to FileItem format"""

    @staticmethod
    def to_file_item(photo) -> Dict[str, Any]:
        """
        Convert WMPhoto to FileItem dictionary format

        Args:
            photo: WMPhoto model instance or dict

        Returns:
            Dictionary matching FileResponse schema
        """
        # Handle both dict and WMPhoto object
        if isinstance(photo, dict):
            # Ensure upload_date is a datetime object or ISO string
            from datetime import datetime
            upload_date = photo.get('captured_date') or photo.get('created_at')
            if isinstance(upload_date, str):
                # Parse date string to datetime if needed
                try:
                    if 'T' not in upload_date:
                        # If it's just a date (YYYY-MM-DD), add time component
                        upload_date = datetime.fromisoformat(upload_date + 'T00:00:00')
                    else:
                        upload_date = datetime.fromisoformat(upload_date.replace('Z', '+00:00'))
                except:
                    upload_date = datetime.utcnow()

            photo_id = str(photo['id'])
            return {
                'id': photo_id,
                'filename': photo['file_name'],
                'original_name': photo['file_name'],
                'content_type': photo.get('mime_type') or 'image/jpeg',
                'size': photo.get('file_size') or 0,
                'url': f'/api/water-mitigation/photos/{photo_id}/preview',
                'thumbnail_url': None,
                'context': 'water-mitigation',
                'context_id': str(photo['job_id']),
                'category': photo.get('category') or '',  # Use actual photo category
                'description': photo.get('description'),
                'uploaded_by': str(photo['uploaded_by_id']) if photo.get('uploaded_by_id') else None,
                'upload_date': upload_date,
                'is_active': True,
                'created_at': photo.get('created_at'),
                'updated_at': photo.get('updated_at')
            }
        else:
            # WMPhoto object
            photo_id = str(photo.id)
            return {
                'id': photo_id,
                'filename': photo.file_name,
                'original_name': photo.file_name,
                'content_type': photo.mime_type or 'image/jpeg',
                'size': photo.file_size or 0,
                'url': f'/api/water-mitigation/photos/{photo_id}/preview',
                'thumbnail_url': None,
                'context': 'water-mitigation',
                'context_id': str(photo.job_id),
                'category': photo.category or '',  # Use actual photo category
                'description': photo.description,
                'uploaded_by': str(photo.uploaded_by_id) if photo.uploaded_by_id else None,
                'upload_date': photo.captured_date or photo.created_at,
                'is_active': True,
                'created_at': photo.created_at,
                'updated_at': photo.updated_at
            }

    @staticmethod
    def to_file_items(photos: List[WMPhoto]) -> List[Dict[str, Any]]:
        """
        Convert list of WMPhotos to list of FileItem dictionaries

        Args:
            photos: List of WMPhoto model instances

        Returns:
            List of dictionaries matching FileResponse schema
        """
        return [WMPhotoAdapter.to_file_item(photo) for photo in photos]

    @staticmethod
    def from_file_data(
        file_data: Dict[str, Any],
        job_id: str,
        uploaded_by_id: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Convert file upload data to WMPhoto creation data

        Args:
            file_data: File upload information
            job_id: Water mitigation job ID
            uploaded_by_id: ID of user uploading the photo

        Returns:
            Dictionary for creating WMPhoto
        """
        return {
            'job_id': job_id,
            'source': 'manual_upload',
            'file_name': file_data.get('original_name', file_data.get('filename')),
            'file_path': file_data.get('url'),
            'file_size': file_data.get('size'),
            'mime_type': file_data.get('content_type'),
            'file_type': 'photo' if file_data.get('content_type', '').startswith('image/') else 'video',
            'title': file_data.get('description'),
            'description': file_data.get('description'),
            'captured_date': datetime.utcnow(),
            'upload_status': 'completed',
            'uploaded_by_id': uploaded_by_id
        }
