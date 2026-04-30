"""
Xactimate Cheat Sheet - Service Layer
"""

import logging
from typing import Any, Dict, List, Optional
from uuid import UUID

from app.core.database_factory import get_database

from .repository import (
    CheatsheetRowRepo,
    CheatsheetRuleRepo,
    CheatsheetSectionRepo,
    CheatsheetTableRepo,
)

logger = logging.getLogger(__name__)


def _get_session():
    db = get_database()
    return db.get_session()


def _get_readonly_session():
    db = get_database()
    return db.get_readonly_session()


class CheatsheetService:
    """Unified service for cheat sheet CRUD operations."""

    # ─── Sections ────────────────────────────────────────────────────────

    def get_all_sections(self, active_only: bool = True) -> List[Dict]:
        session = _get_readonly_session()
        try:
            repo = CheatsheetSectionRepo(session)
            sections = repo.get_all(active_only=active_only)
            return [s.to_dict(include_children=True) for s in sections]
        finally:
            session.close()

    def get_section(self, section_id: UUID) -> Optional[Dict]:
        session = _get_readonly_session()
        try:
            repo = CheatsheetSectionRepo(session)
            s = repo.get_by_id(section_id)
            return s.to_dict(include_children=True) if s else None
        finally:
            session.close()

    def create_section(self, data: Dict) -> Dict:
        session = _get_session()
        try:
            repo = CheatsheetSectionRepo(session)
            s = repo.create(**data)
            session.commit()
            return s.to_dict()
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    def update_section(self, section_id: UUID, data: Dict) -> Optional[Dict]:
        session = _get_session()
        try:
            repo = CheatsheetSectionRepo(session)
            s = repo.update(section_id, **data)
            if not s:
                return None
            session.commit()
            return s.to_dict()
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    def delete_section(self, section_id: UUID) -> bool:
        session = _get_session()
        try:
            repo = CheatsheetSectionRepo(session)
            ok = repo.delete(section_id)
            session.commit()
            return ok
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    # ─── Rules ───────────────────────────────────────────────────────────

    def create_rule(self, data: Dict) -> Dict:
        session = _get_session()
        try:
            repo = CheatsheetRuleRepo(session)
            r = repo.create(**data)
            session.commit()
            return r.to_dict()
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    def update_rule(self, rule_id: UUID, data: Dict) -> Optional[Dict]:
        session = _get_session()
        try:
            repo = CheatsheetRuleRepo(session)
            r = repo.update(rule_id, **data)
            if not r:
                return None
            session.commit()
            return r.to_dict()
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    def delete_rule(self, rule_id: UUID) -> bool:
        session = _get_session()
        try:
            repo = CheatsheetRuleRepo(session)
            ok = repo.delete(rule_id)
            session.commit()
            return ok
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    # ─── Tables ──────────────────────────────────────────────────────────

    def create_table(self, data: Dict) -> Dict:
        session = _get_session()
        try:
            repo = CheatsheetTableRepo(session)
            t = repo.create(**data)
            session.commit()
            return t.to_dict()
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    def update_table(self, table_id: UUID, data: Dict) -> Optional[Dict]:
        session = _get_session()
        try:
            repo = CheatsheetTableRepo(session)
            t = repo.update(table_id, **data)
            if not t:
                return None
            session.commit()
            return t.to_dict()
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    def delete_table(self, table_id: UUID) -> bool:
        session = _get_session()
        try:
            repo = CheatsheetTableRepo(session)
            ok = repo.delete(table_id)
            session.commit()
            return ok
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    # ─── Rows ────────────────────────────────────────────────────────────

    def create_row(self, data: Dict) -> Dict:
        session = _get_session()
        try:
            repo = CheatsheetRowRepo(session)
            r = repo.create(**data)
            session.commit()
            return r.to_dict()
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    def update_row(self, row_id: UUID, data: Dict) -> Optional[Dict]:
        session = _get_session()
        try:
            repo = CheatsheetRowRepo(session)
            r = repo.update(row_id, **data)
            if not r:
                return None
            session.commit()
            return r.to_dict()
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    def update_row_note(self, row_id: UUID, note: Optional[str]) -> Optional[Dict]:
        session = _get_session()
        try:
            repo = CheatsheetRowRepo(session)
            r = repo.update(row_id, note=note)
            if not r:
                return None
            session.commit()
            return r.to_dict()
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    def delete_row(self, row_id: UUID) -> bool:
        session = _get_session()
        try:
            repo = CheatsheetRowRepo(session)
            ok = repo.delete(row_id)
            session.commit()
            return ok
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()
