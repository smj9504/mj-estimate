"""
File management schemas for API requests and responses
"""

from pydantic import BaseModel, Field, field_validator
from typing import Optional, List
from datetime import datetime


class FileBase(BaseModel):
    """Base file schema"""
    filename: str = Field(..., description="Generated filename")
    original_name: str = Field(..., description="Original filename")
    content_type: str = Field(..., description="MIME type")
    size: int = Field(..., description="File size in bytes")
    url: str = Field(..., description="File URL/path")
    thumbnail_url: Optional[str] = Field(None, description="Thumbnail URL for images")
    context: str = Field(..., description="Context (work-order, estimate, etc.)")
    context_id: str = Field(..., description="Related entity ID")
    category: str = Field("general", description="File category")
    description: Optional[str] = Field(None, description="File description")
    uploaded_by: Optional[str] = Field(None, description="Uploader username")


class FileCreate(FileBase):
    """Schema for creating a new file record"""
    pass


class FileUpdate(BaseModel):
    """Schema for updating file metadata"""
    category: Optional[str] = Field(None, description="File category")
    description: Optional[str] = Field(None, description="File description")
    is_active: Optional[bool] = Field(None, description="File active status")


class FileResponse(FileBase):
    """Schema for file response with additional metadata"""
    id: str = Field(..., description="File ID")
    upload_date: datetime = Field(..., description="Upload timestamp")
    is_active: bool = Field(..., description="File active status")
    created_at: datetime
    updated_at: Optional[datetime]

    class Config:
        from_attributes = True



class FilesResponse(BaseModel):
    """Schema for multiple files response"""
    data: List[FileResponse]
    total: int
    message: Optional[str] = None


class FileUploadRequest(BaseModel):
    """Schema for file upload request metadata"""
    context: str = Field(..., description="Context (work-order, estimate, etc.)")
    context_id: str = Field(..., description="Related entity ID")
    category: str = Field("general", description="File category")
    description: Optional[str] = Field(None, description="File description")


class FileCountResponse(BaseModel):
    """Schema for file count response"""
    count: int = Field(..., description="Number of files")
    context: str = Field(..., description="Context")
    context_id: str = Field(..., description="Context ID")
    category: Optional[str] = Field(None, description="Category filter")


class CategoryListResponse(BaseModel):
    """Schema for available categories response"""
    categories: List[str] = Field(..., description="Available categories")
    context: str = Field(..., description="Context")