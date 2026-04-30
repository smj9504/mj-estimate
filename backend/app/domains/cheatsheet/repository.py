"""
Xactimate Cheat Sheet - Repository (Data Access Layer)
"""

import logging
from typing import List, Optional
from uuid import UUID

from sqlalchemy.orm import Session, joinedload

from .models import CheatsheetRow, CheatsheetRule, CheatsheetSection, CheatsheetTable

logger = logging.getLogger(__name__)


class CheatsheetSectionRepo:
    def __init__(self, session: Session):
        self.session = session

    def get_all(self, active_only: bool = True) -> List[CheatsheetSection]:
        q = self.session.query(CheatsheetSection)
        if active_only:
            q = q.filter(CheatsheetSection.is_active == True)
        return (
            q.options(
                joinedload(CheatsheetSection.rules),
                joinedload(CheatsheetSection.tables).joinedload(CheatsheetTable.rows),
            )
            .order_by(CheatsheetSection.sort_order)
            .all()
        )

    def get_by_id(self, section_id: UUID) -> Optional[CheatsheetSection]:
        return (
            self.session.query(CheatsheetSection)
            .options(
                joinedload(CheatsheetSection.rules),
                joinedload(CheatsheetSection.tables).joinedload(CheatsheetTable.rows),
            )
            .filter(CheatsheetSection.id == section_id)
            .first()
        )

    def get_by_key(self, key: str) -> Optional[CheatsheetSection]:
        return (
            self.session.query(CheatsheetSection)
            .filter(CheatsheetSection.section_key == key)
            .first()
        )

    def create(self, **kwargs) -> CheatsheetSection:
        obj = CheatsheetSection(**kwargs)
        self.session.add(obj)
        self.session.flush()
        return obj

    def update(self, section_id: UUID, **kwargs) -> Optional[CheatsheetSection]:
        obj = self.session.query(CheatsheetSection).filter(CheatsheetSection.id == section_id).first()
        if not obj:
            return None
        for k, v in kwargs.items():
            if v is not None:
                setattr(obj, k, v)
        self.session.flush()
        return obj

    def delete(self, section_id: UUID) -> bool:
        obj = self.session.query(CheatsheetSection).filter(CheatsheetSection.id == section_id).first()
        if not obj:
            return False
        self.session.delete(obj)
        self.session.flush()
        return True


class CheatsheetRuleRepo:
    def __init__(self, session: Session):
        self.session = session

    def get_by_id(self, rule_id: UUID) -> Optional[CheatsheetRule]:
        return self.session.query(CheatsheetRule).filter(CheatsheetRule.id == rule_id).first()

    def create(self, **kwargs) -> CheatsheetRule:
        obj = CheatsheetRule(**kwargs)
        self.session.add(obj)
        self.session.flush()
        return obj

    def update(self, rule_id: UUID, **kwargs) -> Optional[CheatsheetRule]:
        obj = self.session.query(CheatsheetRule).filter(CheatsheetRule.id == rule_id).first()
        if not obj:
            return None
        for k, v in kwargs.items():
            if v is not None:
                setattr(obj, k, v)
        self.session.flush()
        return obj

    def delete(self, rule_id: UUID) -> bool:
        obj = self.session.query(CheatsheetRule).filter(CheatsheetRule.id == rule_id).first()
        if not obj:
            return False
        self.session.delete(obj)
        self.session.flush()
        return True


class CheatsheetTableRepo:
    def __init__(self, session: Session):
        self.session = session

    def get_by_id(self, table_id: UUID) -> Optional[CheatsheetTable]:
        return (
            self.session.query(CheatsheetTable)
            .options(joinedload(CheatsheetTable.rows))
            .filter(CheatsheetTable.id == table_id)
            .first()
        )

    def create(self, **kwargs) -> CheatsheetTable:
        obj = CheatsheetTable(**kwargs)
        self.session.add(obj)
        self.session.flush()
        return obj

    def update(self, table_id: UUID, **kwargs) -> Optional[CheatsheetTable]:
        obj = self.session.query(CheatsheetTable).filter(CheatsheetTable.id == table_id).first()
        if not obj:
            return None
        for k, v in kwargs.items():
            if v is not None:
                setattr(obj, k, v)
        self.session.flush()
        return obj

    def delete(self, table_id: UUID) -> bool:
        obj = self.session.query(CheatsheetTable).filter(CheatsheetTable.id == table_id).first()
        if not obj:
            return False
        self.session.delete(obj)
        self.session.flush()
        return True


class CheatsheetRowRepo:
    def __init__(self, session: Session):
        self.session = session

    def get_by_id(self, row_id: UUID) -> Optional[CheatsheetRow]:
        return self.session.query(CheatsheetRow).filter(CheatsheetRow.id == row_id).first()

    def get_by_table(self, table_id: UUID) -> List[CheatsheetRow]:
        return (
            self.session.query(CheatsheetRow)
            .filter(CheatsheetRow.table_id == table_id)
            .order_by(CheatsheetRow.sort_order)
            .all()
        )

    def create(self, **kwargs) -> CheatsheetRow:
        obj = CheatsheetRow(**kwargs)
        self.session.add(obj)
        self.session.flush()
        return obj

    def update(self, row_id: UUID, **kwargs) -> Optional[CheatsheetRow]:
        obj = self.session.query(CheatsheetRow).filter(CheatsheetRow.id == row_id).first()
        if not obj:
            return None
        for k, v in kwargs.items():
            if v is not None or k == "note":  # note can be set to None
                setattr(obj, k, v)
        self.session.flush()
        return obj

    def delete(self, row_id: UUID) -> bool:
        obj = self.session.query(CheatsheetRow).filter(CheatsheetRow.id == row_id).first()
        if not obj:
            return False
        self.session.delete(obj)
        self.session.flush()
        return True
