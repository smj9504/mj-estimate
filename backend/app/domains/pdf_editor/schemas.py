"""
Schemas for PDF Editor API
"""
from typing import List, Optional

from pydantic import BaseModel


class TextEditOperation(BaseModel):
    """Text edit operation (add, delete, modify)"""
    operation: str  # 'add', 'delete', 'modify'
    page_number: int
    x: float  # X coordinate
    y: float  # Y coordinate
    text: Optional[str] = None  # Text content for add/modify
    width: Optional[float] = None  # Width of text box
    height: Optional[float] = None  # Height of text box
    font_size: Optional[int] = 12
    font_family: Optional[str] = "Helvetica"
    color: Optional[str] = "#000000"  # Hex color


class PDFEditRequest(BaseModel):
    """Request to edit PDF"""
    file_id: Optional[str] = None  # If editing existing file
    file_url: Optional[str] = None  # If editing from URL
    edits: List[TextEditOperation]


class PDFEditResponse(BaseModel):
    """Response after PDF edit"""
    success: bool
    file_id: Optional[str] = None
    file_url: Optional[str] = None
    message: str


