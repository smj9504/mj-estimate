"""
Crew Upload repository - data access layer
"""

from datetime import datetime, timezone
from typing import List, Optional

from sqlalchemy import and_, select, update

from .models import UploadLink, UploadSession


class UploadLinkRepository:
    def __init__(self, db):
        self.db = db

    def get_by_token(self, token: str) -> Optional[UploadLink]:
        result = self.db.execute(
            select(UploadLink).where(UploadLink.token == token)
        )
        return result.scalars().first()

    def get_active_by_token(self, token: str) -> Optional[UploadLink]:
        now = datetime.now(timezone.utc)
        result = self.db.execute(
            select(UploadLink).where(
                and_(
                    UploadLink.token == token,
                    UploadLink.is_active == True,
                    UploadLink.expires_at > now,
                )
            )
        )
        return result.scalars().first()

    def get_by_id(self, link_id: str) -> Optional[UploadLink]:
        result = self.db.execute(
            select(UploadLink).where(UploadLink.id == link_id)
        )
        return result.scalars().first()

    def get_by_context(self, context: str, context_id: str) -> List[UploadLink]:
        result = self.db.execute(
            select(UploadLink).where(
                and_(
                    UploadLink.context == context,
                    UploadLink.context_id == context_id,
                )
            ).order_by(UploadLink.created_at.desc())
        )
        return result.scalars().all()

    def create(self, link: UploadLink) -> UploadLink:
        self.db.add(link)
        self.db.flush()
        self.db.refresh(link)
        return link

    def update_access(self, link_id: str):
        self.db.execute(
            update(UploadLink)
            .where(UploadLink.id == link_id)
            .values(last_accessed_at=datetime.now(timezone.utc))
        )

    def increment_upload_count(self, link_id: str, file_size: int):
        link = self.get_by_id(link_id)
        if link:
            link.upload_count += 1
            link.total_size_bytes += file_size

    def deactivate(self, link_id: str):
        self.db.execute(
            update(UploadLink)
            .where(UploadLink.id == link_id)
            .values(is_active=False)
        )


class UploadSessionRepository:
    def __init__(self, db):
        self.db = db

    def get_by_token(self, session_token: str) -> Optional[UploadSession]:
        result = self.db.execute(
            select(UploadSession).where(UploadSession.session_token == session_token)
        )
        return result.scalars().first()

    def create(self, session: UploadSession) -> UploadSession:
        self.db.add(session)
        self.db.flush()
        self.db.refresh(session)
        return session

    def add_completed_fingerprint(self, session_id: str, fingerprint: str):
        result = self.db.execute(
            select(UploadSession).where(UploadSession.id == session_id)
        )
        session = result.scalars().first()
        if session:
            fps = list(session.completed_fingerprints or [])
            if fingerprint not in fps:
                fps.append(fingerprint)
            session.completed_fingerprints = fps
            session.completed_files = len(fps)
            session.last_activity_at = datetime.now(timezone.utc)

    def increment_failed(self, session_id: str):
        result = self.db.execute(
            select(UploadSession).where(UploadSession.id == session_id)
        )
        session = result.scalars().first()
        if session:
            session.failed_files += 1
