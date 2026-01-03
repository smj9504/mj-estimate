"""
Repository for packout domain database operations.
"""
from typing import List, Optional, Dict, Any
from datetime import datetime
from sqlalchemy.orm import Session, joinedload
from sqlalchemy import and_, or_, desc

from app.domains.packout.models import (
    XactimateCode, PackingRule, ItemXactimateMapping,
    PhotoAnalysisPackout, PackoutTemplate,
    XactimateCategory, ItemSize, FragilityLevel
)
from app.domains.packout.schemas import (
    PackingRuleCreate, ItemMappingCreate, PackoutSearchRequest
)


class PackoutRepository:
    """Repository for packout domain database operations"""

    def __init__(self, db: Session):
        self.db = db

    # XactimateCode operations
    def create_xactimate_code(self, code_data: dict) -> XactimateCode:
        """Create a new Xactimate code"""
        code = XactimateCode(**code_data)
        self.db.add(code)
        self.db.commit()
        self.db.refresh(code)
        return code

    def get_xactimate_code(self, code_id: int) -> Optional[XactimateCode]:
        """Get Xactimate code by ID"""
        return self.db.query(XactimateCode).filter(
            XactimateCode.id == code_id
        ).first()

    def get_xactimate_code_by_code(self, code: str) -> Optional[XactimateCode]:
        """Get Xactimate code by code string"""
        return self.db.query(XactimateCode).filter(
            XactimateCode.code == code
        ).first()

    def update_xactimate_code(
        self,
        code_id: int,
        update_data: dict
    ) -> Optional[XactimateCode]:
        """Update an Xactimate code"""
        code = self.get_xactimate_code(code_id)
        if code:
            for key, value in update_data.items():
                setattr(code, key, value)
            code.updated_at = datetime.utcnow()
            self.db.commit()
            self.db.refresh(code)
        return code

    def delete_xactimate_code(self, code_id: int) -> bool:
        """Delete an Xactimate code"""
        code = self.get_xactimate_code(code_id)
        if code:
            self.db.delete(code)
            self.db.commit()
            return True
        return False

    def list_xactimate_codes(
        self,
        category: Optional[XactimateCategory] = None,
        subcategory: Optional[str] = None,
        limit: int = 100,
        offset: int = 0
    ) -> List[XactimateCode]:
        """List Xactimate codes with optional filters"""
        query = self.db.query(XactimateCode)

        if category:
            query = query.filter(XactimateCode.category == category)

        if subcategory:
            query = query.filter(XactimateCode.subcategory == subcategory)

        return query.offset(offset).limit(limit).all()

    # PackingRule operations
    def create_packing_rule(self, rule_data: PackingRuleCreate) -> PackingRule:
        """Create a new packing rule"""
        rule = PackingRule(**rule_data.model_dump())
        self.db.add(rule)
        self.db.commit()
        self.db.refresh(rule)
        return rule

    def get_packing_rule(self, rule_id: int) -> Optional[PackingRule]:
        """Get packing rule by ID"""
        return self.db.query(PackingRule).options(
            joinedload(PackingRule.xactimate_code)
        ).filter(PackingRule.id == rule_id).first()

    def find_packing_rule(
        self,
        item_category: str,
        item_subcategory: Optional[str],
        fragility: FragilityLevel,
        size: ItemSize
    ) -> Optional[PackingRule]:
        """Find packing rule for specific item characteristics"""
        query = self.db.query(PackingRule).options(
            joinedload(PackingRule.xactimate_code)
        )

        conditions = [
            PackingRule.item_category == item_category,
            PackingRule.fragility_level == fragility,
            PackingRule.size == size
        ]

        if item_subcategory:
            conditions.append(PackingRule.item_subcategory == item_subcategory)

        return query.filter(and_(*conditions)).first()

    def list_packing_rules(
        self,
        item_category: Optional[str] = None,
        limit: int = 100,
        offset: int = 0
    ) -> List[PackingRule]:
        """List packing rules with optional filters"""
        query = self.db.query(PackingRule).options(
            joinedload(PackingRule.xactimate_code)
        )

        if item_category:
            query = query.filter(PackingRule.item_category == item_category)

        return query.offset(offset).limit(limit).all()

    # ItemXactimateMapping operations
    def create_item_mapping(
        self,
        mapping_data: ItemMappingCreate
    ) -> ItemXactimateMapping:
        """Create a new item to Xactimate mapping"""
        mapping = ItemXactimateMapping(**mapping_data.model_dump())
        self.db.add(mapping)
        self.db.commit()
        self.db.refresh(mapping)
        return mapping

    def get_item_mapping(self, mapping_id: int) -> Optional[ItemXactimateMapping]:
        """Get item mapping by ID"""
        return self.db.query(ItemXactimateMapping).options(
            joinedload(ItemXactimateMapping.xactimate_code)
        ).filter(ItemXactimateMapping.id == mapping_id).first()

    def find_item_mapping(
        self,
        item_name: str,
        item_category: Optional[str] = None
    ) -> Optional[ItemXactimateMapping]:
        """Find mapping for an item"""
        query = self.db.query(ItemXactimateMapping).options(
            joinedload(ItemXactimateMapping.xactimate_code)
        )

        # Try exact match first
        conditions = [ItemXactimateMapping.item_name.ilike(f"%{item_name}%")]

        if item_category:
            conditions.append(ItemXactimateMapping.item_category == item_category)

        return query.filter(and_(*conditions)).first()

    def list_item_mappings(
        self,
        item_category: Optional[str] = None,
        limit: int = 100,
        offset: int = 0
    ) -> List[ItemXactimateMapping]:
        """List item mappings with optional filters"""
        query = self.db.query(ItemXactimateMapping).options(
            joinedload(ItemXactimateMapping.xactimate_code)
        )

        if item_category:
            query = query.filter(ItemXactimateMapping.item_category == item_category)

        return query.offset(offset).limit(limit).all()

    # PhotoAnalysisPackout operations
    def create_packout_analysis(
        self,
        analysis_data: dict
    ) -> PhotoAnalysisPackout:
        """Create a new packout analysis"""
        analysis = PhotoAnalysisPackout(**analysis_data)
        self.db.add(analysis)
        self.db.commit()
        self.db.refresh(analysis)
        return analysis

    def get_packout_analysis(
        self,
        analysis_id: int
    ) -> Optional[PhotoAnalysisPackout]:
        """Get packout analysis by ID"""
        return self.db.query(PhotoAnalysisPackout).options(
            joinedload(PhotoAnalysisPackout.photo_analysis),
            joinedload(PhotoAnalysisPackout.company)
        ).filter(PhotoAnalysisPackout.id == analysis_id).first()

    def update_packout_analysis(
        self,
        analysis_id: int,
        update_data: dict
    ) -> Optional[PhotoAnalysisPackout]:
        """Update a packout analysis"""
        analysis = self.get_packout_analysis(analysis_id)
        if analysis:
            for key, value in update_data.items():
                setattr(analysis, key, value)
            analysis.updated_at = datetime.utcnow()
            self.db.commit()
            self.db.refresh(analysis)
        return analysis

    def search_packout_analyses(
        self,
        search_request: PackoutSearchRequest
    ) -> List[PhotoAnalysisPackout]:
        """Search packout analyses"""
        query = self.db.query(PhotoAnalysisPackout).options(
            joinedload(PhotoAnalysisPackout.photo_analysis),
            joinedload(PhotoAnalysisPackout.company)
        )

        if search_request.job_id:
            query = query.filter(PhotoAnalysisPackout.job_id == search_request.job_id)

        if search_request.company_id:
            query = query.filter(PhotoAnalysisPackout.company_id == search_request.company_id)

        if search_request.room_name:
            query = query.filter(
                PhotoAnalysisPackout.room_name.ilike(f"%{search_request.room_name}%")
            )

        if search_request.date_from:
            query = query.filter(PhotoAnalysisPackout.created_at >= search_request.date_from)

        if search_request.date_to:
            query = query.filter(PhotoAnalysisPackout.created_at <= search_request.date_to)

        return query.order_by(
            desc(PhotoAnalysisPackout.created_at)
        ).offset(
            search_request.offset
        ).limit(
            search_request.limit
        ).all()

    def get_analyses_by_job(
        self,
        job_id: str,
        company_id: Optional[int] = None
    ) -> List[PhotoAnalysisPackout]:
        """Get all analyses for a job"""
        query = self.db.query(PhotoAnalysisPackout).filter(
            PhotoAnalysisPackout.job_id == job_id
        )

        if company_id:
            query = query.filter(PhotoAnalysisPackout.company_id == company_id)

        return query.order_by(PhotoAnalysisPackout.created_at).all()

    # PackoutTemplate operations
    def create_template(self, template_data: dict) -> PackoutTemplate:
        """Create a new packout template"""
        template = PackoutTemplate(**template_data)
        self.db.add(template)
        self.db.commit()
        self.db.refresh(template)
        return template

    def get_template(self, template_id: int) -> Optional[PackoutTemplate]:
        """Get template by ID"""
        return self.db.query(PackoutTemplate).filter(
            PackoutTemplate.id == template_id
        ).first()

    def get_template_by_name(self, name: str) -> Optional[PackoutTemplate]:
        """Get template by name"""
        return self.db.query(PackoutTemplate).filter(
            PackoutTemplate.name == name
        ).first()

    def list_templates(
        self,
        room_type: Optional[str] = None,
        active_only: bool = True
    ) -> List[PackoutTemplate]:
        """List packout templates"""
        query = self.db.query(PackoutTemplate)

        if active_only:
            query = query.filter(PackoutTemplate.is_active == True)

        if room_type:
            query = query.filter(PackoutTemplate.room_type == room_type)

        return query.all()

    # Bulk operations
    def bulk_create_packing_rules(
        self,
        rules_data: List[PackingRuleCreate]
    ) -> List[PackingRule]:
        """Create multiple packing rules"""
        rules = [PackingRule(**rule.model_dump()) for rule in rules_data]
        self.db.bulk_save_objects(rules)
        self.db.commit()
        return rules

    def bulk_create_item_mappings(
        self,
        mappings_data: List[ItemMappingCreate]
    ) -> List[ItemXactimateMapping]:
        """Create multiple item mappings"""
        mappings = [
            ItemXactimateMapping(**mapping.model_dump())
            for mapping in mappings_data
        ]
        self.db.bulk_save_objects(mappings)
        self.db.commit()
        return mappings

    # Statistics
    def get_packout_statistics(
        self,
        company_id: Optional[int] = None,
        date_from: Optional[datetime] = None,
        date_to: Optional[datetime] = None
    ) -> Dict[str, Any]:
        """Get packout statistics"""
        query = self.db.query(PhotoAnalysisPackout)

        if company_id:
            query = query.filter(PhotoAnalysisPackout.company_id == company_id)

        if date_from:
            query = query.filter(PhotoAnalysisPackout.created_at >= date_from)

        if date_to:
            query = query.filter(PhotoAnalysisPackout.created_at <= date_to)

        analyses = query.all()

        if not analyses:
            return {
                "total_analyses": 0,
                "total_items": 0,
                "total_boxes": 0,
                "total_labor_hours": 0,
                "average_items_per_job": 0,
                "average_boxes_per_job": 0
            }

        total_items = sum(a.total_items_detected for a in analyses)
        total_boxes = sum(a.total_boxes_needed for a in analyses)
        total_labor = sum(
            a.total_packing_hours + a.total_inventory_hours +
            a.total_moving_hours + a.total_supervision_hours
            for a in analyses
        )

        return {
            "total_analyses": len(analyses),
            "total_items": total_items,
            "total_boxes": total_boxes,
            "total_labor_hours": round(total_labor, 2),
            "average_items_per_job": round(total_items / len(analyses), 1),
            "average_boxes_per_job": round(total_boxes / len(analyses), 1)
        }