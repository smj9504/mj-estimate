import logging
import re
from typing import List

logger = logging.getLogger(__name__)


class OcrFallbackExtractor:
    @staticmethod
    def _looks_cid_encoded(text: str) -> bool:
        if not text:
            return False
        cid_count = text.count("(cid:")
        null_count = text.count("\x00")
        alpha_count = sum(1 for c in text if c.isalpha())
        return (cid_count >= 5) or (
            len(text) > 0 and null_count > len(text) * 0.3 and alpha_count < 50
        )

    def _needs_ocr(self, text: str) -> bool:
        t = (text or "").strip()
        if len(t) < 20:
            return True
        if self._looks_cid_encoded(t):
            return True
        # Text exists but almost no words can still be broken extraction.
        words = re.findall(r"[A-Za-z]{2,}", t)
        return len(words) < 5

    def extract_missing_pages(self, file_path: str, pages_text: List[str]) -> List[str]:
        needs_ocr = [idx for idx, text in enumerate(pages_text) if self._needs_ocr(text)]
        if not needs_ocr:
            return []

        ocr_pages = [""] * len(pages_text)

        # Try pdf2image first (if poppler is available)
        try:
            import pytesseract
            from pdf2image import convert_from_path
            images = convert_from_path(file_path, dpi=220)
            for idx in needs_ocr:
                if idx >= len(images):
                    continue
                ocr_pages[idx] = pytesseract.image_to_string(images[idx]) or ""
            return ocr_pages
        except Exception:
            logger.info("pdf2image OCR path unavailable; trying PyMuPDF fallback")

        # Fallback: PyMuPDF render + pytesseract
        try:
            import fitz
            import io
            from PIL import Image
            import pytesseract

            doc = fitz.open(file_path)
            for idx in needs_ocr:
                if idx < 0 or idx >= len(doc):
                    continue
                pix = doc[idx].get_pixmap(dpi=220)
                img = Image.open(io.BytesIO(pix.tobytes("png")))
                ocr_pages[idx] = pytesseract.image_to_string(img) or ""
            doc.close()
            return ocr_pages
        except Exception:
            logger.info("OCR dependencies not installed; skipping OCR fallback")
            return []
