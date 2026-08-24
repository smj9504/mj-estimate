"""
PDF Editor Service for editing PDF files
"""
import io
import logging
from pathlib import Path
from typing import Optional

from app.core.database_factory import get_database
from app.domains.file.service import FileService, get_storage_provider
from app.domains.pdf_editor.schemas import PDFEditRequest, TextEditOperation

logger = logging.getLogger(__name__)


class PDFEditorService:
    """Service for editing PDF files"""

    def __init__(self):
        self.file_service = FileService(get_database())

    def edit_pdf(
        self,
        request: PDFEditRequest,
        uploaded_by: str,
        context: str = "pdf_editor",
        context_id: str = "default"
    ) -> dict:
        """
        Edit PDF file with text operations

        Args:
            request: PDF edit request with operations
            uploaded_by: User ID who is editing
            context: File context
            context_id: File context ID

        Returns:
            Dictionary with edited file information
        """
        try:
            # Load original PDF
            pdf_bytes = self._load_pdf(request)
            if not pdf_bytes:
                raise ValueError("Could not load PDF file")

            # Apply edits
            edited_pdf_bytes = self._apply_edits(pdf_bytes, request.edits)

            # Save edited PDF
            filename = "edited_document.pdf"
            if request.file_url:
                filename = f"edited_{Path(request.file_url).stem}.pdf"
            
            file_record = self.file_service.upload_file(
                file_data=io.BytesIO(edited_pdf_bytes),
                original_filename=filename,
                content_type="application/pdf",
                context=context,
                context_id=context_id,
                category="pdf_edited",
                description="PDF edited with text operations",
                uploaded_by=uploaded_by
            )

            # Commit transaction
            self.file_service.repository.session.commit()

            return {
                "success": True,
                "file_id": file_record.get("id"),
                "file_url": file_record.get("url"),
                "message": "PDF edited successfully"
            }

        except Exception as e:
            logger.error(f"Error editing PDF: {e}", exc_info=True)
            if hasattr(self.file_service, 'repository'):
                self.file_service.repository.session.rollback()
            raise

    def _load_pdf(self, request: PDFEditRequest) -> Optional[bytes]:
        """Load PDF from file_id or file_url"""
        try:
            if request.file_id:
                # Load from file service
                file_record = (
                    self.file_service.repository.get_by_id(request.file_id)
                )
                if not file_record:
                    raise ValueError(f"File not found: {request.file_id}")

                file_url = file_record.get('url', '')
                storage = get_storage_provider()

                # Check if file is in cloud storage
                is_cloud = (
                    file_url.startswith('gs://') or
                    file_url.startswith('b2://') or
                    file_url.startswith('https://') or
                    file_url.startswith('http://')
                )
                if is_cloud:
                    pdf_bytes = storage.download_file(file_url)
                else:
                    # Local file
                    file_path = Path(file_url)
                    if not file_path.exists():
                        raise ValueError(f"File not found on disk: {file_url}")
                    pdf_bytes = file_path.read_bytes()

                return pdf_bytes

            elif request.file_url:
                # Load from URL
                is_url = (
                    request.file_url.startswith('http://') or
                    request.file_url.startswith('https://')
                )
                if is_url:
                    import requests
                    response = requests.get(request.file_url)
                    response.raise_for_status()
                    return response.content
                else:
                    # Local file path
                    file_path = Path(request.file_url)
                    if not file_path.exists():
                        raise ValueError(f"File not found: {request.file_url}")
                    return file_path.read_bytes()

            return None

        except Exception as e:
            logger.error(f"Error loading PDF: {e}")
            raise

    def _apply_edits(self, pdf_bytes: bytes, edits: list[TextEditOperation]) -> bytes:
        """
        Apply text edits to PDF

        Args:
            pdf_bytes: Original PDF bytes
            edits: List of edit operations

        Returns:
            Edited PDF bytes
        """
        try:
            from pypdf import PdfReader, PdfWriter

            # Read original PDF
            pdf_reader = PdfReader(io.BytesIO(pdf_bytes))
            pdf_writer = PdfWriter()

            # Create overlay pages for edits
            overlay_pages = {}
            for edit in edits:
                page_num = edit.page_number - 1  # 0-based index
                if page_num < 0 or page_num >= len(pdf_reader.pages):
                    logger.warning(
                        f"Invalid page number: {edit.page_number}, skipping"
                    )
                    continue

                if page_num not in overlay_pages:
                    overlay_pages[page_num] = []

                overlay_pages[page_num].append(edit)

            # Process each page
            for page_num in range(len(pdf_reader.pages)):
                page = pdf_reader.pages[page_num]

                # Create overlay if there are edits for this page
                if page_num in overlay_pages:
                    overlay_bytes = self._create_text_overlay(
                        page,
                        overlay_pages[page_num]
                    )
                    # Merge overlay with original page
                    overlay_reader = PdfReader(io.BytesIO(overlay_bytes))
                    page.merge_page(overlay_reader.pages[0])

                pdf_writer.add_page(page)

            # Write edited PDF to bytes
            output = io.BytesIO()
            pdf_writer.write(output)
            return output.getvalue()

        except Exception as e:
            logger.error(f"Error applying edits: {e}", exc_info=True)
            raise

    def _create_text_overlay(
        self,
        original_page,
        edits: list[TextEditOperation]
    ) -> bytes:
        """
        Create PDF overlay with text edits

        Args:
            original_page: Original PDF page object
            edits: List of edit operations for this page

        Returns:
            PDF bytes with text overlay
        """
        try:
            from reportlab.lib.colors import HexColor
            from reportlab.pdfgen import canvas

            # Get page dimensions
            page_media_box = original_page.mediabox
            page_width = float(page_media_box.width)
            page_height = float(page_media_box.height)

            # Create canvas overlay
            overlay_buffer = io.BytesIO()
            c = canvas.Canvas(
                overlay_buffer,
                pagesize=(page_width, page_height)
            )

            for edit in edits:
                if edit.operation == 'delete':
                    # Draw white rectangle to delete text
                    c.setFillColorRGB(1, 1, 1)  # White
                    c.rect(
                        edit.x,
                        page_height - edit.y - (edit.height or 12),
                        edit.width or 100,
                        edit.height or 12,
                        fill=1,
                        stroke=0
                    )
                elif edit.operation == 'add' or edit.operation == 'modify':
                    # Draw text
                    if edit.text:
                        # Parse color
                        try:
                            if edit.color:
                                color = HexColor(edit.color)
                            else:
                                color = HexColor("#000000")
                        except Exception:
                            color = HexColor("#000000")

                        c.setFillColor(color)
                        font_family = edit.font_family or "Helvetica"
                        font_size = edit.font_size or 12
                        c.setFont(font_family, font_size)

                        # Calculate Y position (PDF coords start from bottom)
                        y_pos = page_height - edit.y - font_size

                        c.drawString(edit.x, y_pos, edit.text)

            c.save()
            return overlay_buffer.getvalue()

        except Exception as e:
            logger.error(f"Error creating text overlay: {e}", exc_info=True)
            raise

