"""
Email Ingestion repository implementations.
"""

import logging
from typing import Any, Dict, List, Optional

from sqlalchemy import func

from app.common.base_repository import SQLAlchemyRepository
from app.core.interfaces import DatabaseSession
from app.domains.email_ingestion.models import EmailAccount, EmailIngestionLog

logger = logging.getLogger(__name__)


class EmailAccountRepository(SQLAlchemyRepository):
    """Repository for EmailAccount CRUD"""

    def __init__(self, session: DatabaseSession):
        super().__init__(session, EmailAccount)

    def get_active_accounts(self, company_id: Optional[str] = None) -> List[Dict[str, Any]]:
        """Get all active email accounts, optionally filtered by company"""
        query = self.db_session.query(EmailAccount).filter(
            EmailAccount.is_active == True
        )
        if company_id:
            query = query.filter(EmailAccount.company_id == company_id)
        accounts = query.order_by(EmailAccount.created_at).all()
        return [self._convert_to_dict(a) for a in accounts]

    def get_by_email(self, email_address: str) -> Optional[Dict[str, Any]]:
        """Get account by email address"""
        account = self.db_session.query(EmailAccount).filter(
            EmailAccount.email_address == email_address
        ).first()
        return self._convert_to_dict(account) if account else None


class EmailIngestionLogRepository(SQLAlchemyRepository):
    """Repository for EmailIngestionLog CRUD"""

    def __init__(self, session: DatabaseSession):
        super().__init__(session, EmailIngestionLog)

    def exists_by_message_id(self, message_id: str) -> bool:
        """Check if email has already been processed"""
        return self.db_session.query(EmailIngestionLog).filter(
            EmailIngestionLog.message_id == message_id
        ).first() is not None

    def exists_by_attachment_hash(self, attachment_hash: str, claim_id: Optional[str] = None) -> bool:
        """Check if an attachment with this hash has already been uploaded for a claim"""
        query = self.db_session.query(EmailIngestionLog).filter(
            EmailIngestionLog.attachment_hash == attachment_hash,
            EmailIngestionLog.status == "uploaded",
        )
        if claim_id:
            query = query.filter(EmailIngestionLog.matched_claim_id == claim_id)
        return query.first() is not None

    def get_pending_logs(self, limit: int = 50) -> List[Dict[str, Any]]:
        """Get logs that need manual review"""
        logs = self.db_session.query(EmailIngestionLog).filter(
            EmailIngestionLog.status.in_(["pending", "classified"]),
        ).order_by(EmailIngestionLog.created_at.desc()).limit(limit).all()
        return [self._convert_to_dict(log) for log in logs]

    def get_logs_with_filters(
        self,
        status: Optional[str] = None,
        account_id: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> List[Dict[str, Any]]:
        """Get logs with optional filters"""
        query = self.db_session.query(EmailIngestionLog)

        if status:
            query = query.filter(EmailIngestionLog.status == status)
        if account_id:
            query = query.filter(EmailIngestionLog.email_account_id == account_id)

        logs = query.order_by(
            EmailIngestionLog.created_at.desc()
        ).offset(offset).limit(limit).all()
        return [self._convert_to_dict(log) for log in logs]

    def get_stats(self) -> Dict[str, int]:
        """Get aggregated stats"""
        total = self.db_session.query(func.count(EmailIngestionLog.id)).scalar() or 0
        uploaded = self.db_session.query(func.count(EmailIngestionLog.id)).filter(
            EmailIngestionLog.status == "uploaded"
        ).scalar() or 0
        pending = self.db_session.query(func.count(EmailIngestionLog.id)).filter(
            EmailIngestionLog.status.in_(["pending", "classified"])
        ).scalar() or 0
        skipped = self.db_session.query(func.count(EmailIngestionLog.id)).filter(
            EmailIngestionLog.status == "skipped"
        ).scalar() or 0
        failed = self.db_session.query(func.count(EmailIngestionLog.id)).filter(
            EmailIngestionLog.status == "failed"
        ).scalar() or 0
        duplicates = self.db_session.query(func.count(EmailIngestionLog.id)).filter(
            EmailIngestionLog.status == "duplicate"
        ).scalar() or 0

        return {
            "total": total,
            "uploaded": uploaded,
            "pending": pending,
            "skipped": skipped,
            "failed": failed,
            "duplicates": duplicates,
        }


# ============================================================
# Factory functions
# ============================================================

def get_email_account_repository(session: DatabaseSession) -> EmailAccountRepository:
    actual_session = session
    if hasattr(session, 'session') and session.session is not None:
        actual_session = session.session
    if hasattr(actual_session, '_session') and actual_session._session is not None:
        actual_session = actual_session._session
    return EmailAccountRepository(actual_session)


def get_email_ingestion_log_repository(session: DatabaseSession) -> EmailIngestionLogRepository:
    actual_session = session
    if hasattr(session, 'session') and session.session is not None:
        actual_session = session.session
    if hasattr(actual_session, '_session') and actual_session._session is not None:
        actual_session = actual_session._session
    return EmailIngestionLogRepository(actual_session)
