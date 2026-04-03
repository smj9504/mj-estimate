from typing import List

from pypdf import PdfReader


class PdfTextExtractor:
    def extract_pages(self, file_path: str) -> List[str]:
        reader = PdfReader(file_path)
        return [page.extract_text() or "" for page in reader.pages]
