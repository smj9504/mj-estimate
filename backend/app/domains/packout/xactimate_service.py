"""
Service for managing Xactimate codes and data import.
"""
import json
import logging
from typing import List, Optional, Dict, Any
from pathlib import Path
from sqlalchemy.orm import Session
from sqlalchemy import or_

from app.domains.packout.models import XactimateCode, XactimateCategory
from app.domains.packout.schemas import (
    XactimateCodeCreate,
    XactimateImportResponse,
    XactimateCodeResponse
)

logger = logging.getLogger(__name__)


class XactimateService:
    """Service for managing Xactimate codes and imports"""

    def __init__(self, db: Session):
        self.db = db

    def import_xactimate_file(
        self,
        file_path: str,
        category: XactimateCategory,
        overwrite: bool = False
    ) -> XactimateImportResponse:
        """
        Import Xactimate codes from JSON file.

        Args:
            file_path: Path to JSON file
            category: Category of codes (CON, CPS, TMC)
            overwrite: Whether to overwrite existing codes

        Returns:
            Import response with statistics
        """
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                data = json.load(f)

            imported = 0
            updated = 0
            skipped = 0
            errors = []

            for item in data:
                try:
                    code = self._extract_code_from_item(item, category)
                    if code:
                        result = self._upsert_code(code, overwrite)
                        if result == 'imported':
                            imported += 1
                        elif result == 'updated':
                            updated += 1
                        else:
                            skipped += 1
                except Exception as e:
                    errors.append(f"Error processing item: {str(e)}")
                    logger.error(f"Error processing Xactimate item: {e}")

            self.db.commit()

            return XactimateImportResponse(
                codes_imported=imported,
                codes_updated=updated,
                codes_skipped=skipped,
                errors=errors,
                success=len(errors) == 0
            )

        except Exception as e:
            logger.error(f"Error importing Xactimate file: {e}")
            self.db.rollback()
            return XactimateImportResponse(
                codes_imported=0,
                codes_updated=0,
                codes_skipped=0,
                errors=[str(e)],
                success=False
            )

    def _extract_code_from_item(
        self,
        item: Dict[str, Any],
        category: XactimateCategory
    ) -> Optional[XactimateCodeCreate]:
        """Extract Xactimate code from JSON item"""
        try:
            # Parse based on the file structure
            # Assuming structure like: {"code": "CONLAB", "description": "Content Manipulation Labor", ...}

            code_str = item.get('item_code', '').strip() or item.get('code', '').strip()
            if not code_str:
                return None

            description = item.get('description', '') or item.get('name', '') or ''
            unit = 'EA'  # Default unit
            # Extract unit price from price_data if available
            price_data = item.get('price_data', {})
            unit_price = float(price_data.get('untaxed_unit_price', 0.0) or price_data.get('material_cost', 0.0) or 0.0)

            # Extract additional metadata
            subcategory = self._determine_subcategory(code_str, description, category)
            size_range = item.get('size', '') or self._extract_size_from_description(description)
            material_type = self._determine_material_type(code_str, description)

            return XactimateCodeCreate(
                code=code_str,
                category=category,
                description=description,
                unit=unit,
                unit_price=unit_price,
                subcategory=subcategory,
                size_range=size_range,
                material_type=material_type
            )

        except Exception as e:
            logger.error(f"Error extracting code from item: {e}")
            return None

    def _determine_subcategory(
        self,
        code: str,
        description: str,
        category: XactimateCategory
    ) -> str:
        """Determine subcategory based on code and description"""
        description_lower = description.lower()

        if category == XactimateCategory.TMC:
            if 'box' in description_lower or 'carton' in description_lower:
                return "Boxes"
            elif 'bubble' in description_lower:
                return "Bubble Wrap"
            elif 'paper' in description_lower:
                return "Packing Paper"
            elif 'tape' in description_lower:
                return "Tape"
            elif 'pad' in description_lower or 'blanket' in description_lower:
                return "Protective Materials"

        elif category == XactimateCategory.CON:
            if 'lab' in code.lower():
                return "Labor"
            elif 'inventory' in description_lower:
                return "Inventory"
            elif 'pack' in description_lower:
                return "Packing"
            elif 'move' in description_lower or 'transport' in description_lower:
                return "Moving"

        elif category == XactimateCategory.CPS:
            if 'pack' in description_lower:
                return "Packing"
            elif 'process' in description_lower:
                return "Processing"
            elif 'storage' in description_lower:
                return "Storage"
            elif 'handling' in description_lower:
                return "Handling"

        return "General"

    def _extract_size_from_description(self, description: str) -> Optional[str]:
        """Extract size information from description"""
        import re

        # Look for common size patterns
        patterns = [
            r'(\d+\.?\d*)\s*CF',  # Cubic feet
            r'(\d+\.?\d*)\s*CU\s*FT',
            r'(\d+)"\s*x\s*(\d+)"',  # Dimensions
            r'(\d+)\s*x\s*(\d+)',
            r'(small|medium|large|x-large|xl)',
            r'(\d+\.?\d*)\s*(gal|gallon)',
        ]

        for pattern in patterns:
            match = re.search(pattern, description, re.IGNORECASE)
            if match:
                return match.group(0)

        return None

    def _determine_material_type(self, code: str, description: str) -> Optional[str]:
        """Determine material type from code and description"""
        description_lower = description.lower()

        if 'corrugated' in description_lower:
            return "Corrugated"
        elif 'bubble' in description_lower:
            return "Bubble Wrap"
        elif 'paper' in description_lower:
            return "Paper"
        elif 'plastic' in description_lower:
            return "Plastic"
        elif 'foam' in description_lower:
            return "Foam"
        elif 'tape' in description_lower:
            return "Tape"

        return None

    def _upsert_code(
        self,
        code_data: XactimateCodeCreate,
        overwrite: bool
    ) -> str:
        """Insert or update Xactimate code"""
        # Use raw session query to avoid ORM relationship resolution issues
        from sqlalchemy import select

        stmt = select(XactimateCode).where(XactimateCode.code == code_data.code)
        result = self.db.execute(stmt)
        existing = result.scalar_one_or_none()

        if existing:
            if overwrite:
                # Update existing code
                for key, value in code_data.model_dump().items():
                    setattr(existing, key, value)
                return 'updated'
            else:
                return 'skipped'
        else:
            # Create new code
            new_code = XactimateCode(**code_data.model_dump())
            self.db.add(new_code)
            return 'imported'

    def get_code_by_id(self, code_id: int) -> Optional[XactimateCode]:
        """Get Xactimate code by ID"""
        return self.db.query(XactimateCode).filter(
            XactimateCode.id == code_id
        ).first()

    def get_code_by_code(self, code: str) -> Optional[XactimateCode]:
        """Get Xactimate code by code string"""
        return self.db.query(XactimateCode).filter(
            XactimateCode.code == code
        ).first()

    def search_codes(
        self,
        category: Optional[XactimateCategory] = None,
        subcategory: Optional[str] = None,
        search_term: Optional[str] = None,
        limit: int = 100
    ) -> List[XactimateCode]:
        """Search for Xactimate codes"""
        query = self.db.query(XactimateCode)

        if category:
            query = query.filter(XactimateCode.category == category)

        if subcategory:
            query = query.filter(XactimateCode.subcategory == subcategory)

        if search_term:
            query = query.filter(
                or_(
                    XactimateCode.code.ilike(f"%{search_term}%"),
                    XactimateCode.description.ilike(f"%{search_term}%")
                )
            )

        return query.limit(limit).all()

    def get_box_codes(self) -> List[XactimateCode]:
        """Get all box-related Xactimate codes"""
        return self.db.query(XactimateCode).filter(
            XactimateCode.category == XactimateCategory.TMC,
            XactimateCode.subcategory == "Boxes"
        ).all()

    def get_packing_material_codes(self) -> List[XactimateCode]:
        """Get all packing material codes"""
        return self.db.query(XactimateCode).filter(
            or_(
                XactimateCode.subcategory.in_(["Bubble Wrap", "Packing Paper", "Tape"]),
                XactimateCode.description.ilike("%bubble%"),
                XactimateCode.description.ilike("%paper%"),
                XactimateCode.description.ilike("%tape%")
            )
        ).all()

    def get_labor_codes(self) -> List[XactimateCode]:
        """Get all labor-related codes"""
        return self.db.query(XactimateCode).filter(
            or_(
                XactimateCode.subcategory == "Labor",
                XactimateCode.code.ilike("%LAB%"),
                XactimateCode.description.ilike("%labor%")
            )
        ).all()

    def import_all_default_files(self, base_path: str = None) -> Dict[str, XactimateImportResponse]:
        """Import all default Xactimate JSON files"""
        if base_path is None:
            # Use absolute path from current file location
            current_dir = Path(__file__).parent.parent.parent.parent
            base_path = current_dir / "uploads" / "xactimate_data"
        else:
            base_path = Path(base_path)

        results = {}

        files = {
            "CON": base_path / "CON_.json",
            "CPS": base_path / "CPS.json",
            "TMC": base_path / "TMC.json"
        }

        for category_str, file_path in files.items():
            if file_path.exists():
                category = XactimateCategory[category_str]
                result = self.import_xactimate_file(str(file_path), category, overwrite=False)
                results[category_str] = result
                logger.info(f"Imported {category}: {result.codes_imported} new, {result.codes_updated} updated")
            else:
                logger.warning(f"File not found: {file_path}")
                results[category_str] = XactimateImportResponse(
                    codes_imported=0,
                    codes_updated=0,
                    codes_skipped=0,
                    errors=[f"File not found: {file_path}"],
                    success=False
                )

        return results