"""
Claim Follow-up repository implementations.
"""

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import and_, func, or_

from app.common.base_repository import SQLAlchemyRepository
from app.core.interfaces import DatabaseSession
from app.domains.claim_followup.models import (
    CommunicationLog,
    EmailTemplate,
    FollowUpTask,
    SentEmail,
)

logger = logging.getLogger(__name__)


class FollowUpTaskRepository(SQLAlchemyRepository):
    """Repository for FollowUpTask CRUD and queries"""

    def __init__(self, session: DatabaseSession):
        super().__init__(session, FollowUpTask)

    def get_tasks_with_filters(
        self,
        status: Optional[str] = None,
        task_type: Optional[str] = None,
        priority: Optional[str] = None,
        claim_id: Optional[str] = None,
        assigned_to_email: Optional[str] = None,
        overdue_only: bool = False,
        depreciation_phase: Optional[str] = None,
        page: int = 1,
        page_size: int = 20,
        sort_by: str = "due_date",
        sort_order: str = "asc",
    ) -> Tuple[List[Dict[str, Any]], int]:
        """Get tasks with filtering, pagination, and sorting (enriched with claim data)"""
        query = self.db_session.query(FollowUpTask)

        if status:
            query = query.filter(FollowUpTask.status == status)
        if task_type:
            query = query.filter(FollowUpTask.task_type == task_type)
        if priority:
            query = query.filter(FollowUpTask.priority == priority)
        if claim_id:
            query = query.filter(FollowUpTask.claim_id == claim_id)
        if assigned_to_email:
            query = query.filter(FollowUpTask.assigned_to_email == assigned_to_email)
        if overdue_only:
            now = datetime.now(timezone.utc)
            query = query.filter(
                and_(
                    FollowUpTask.next_followup_date < now,
                    FollowUpTask.status.in_(['pending', 'awaiting_response'])
                )
            )
        if depreciation_phase:
            query = query.filter(
                FollowUpTask.depreciation_phase == depreciation_phase
            )

        total = query.count()

        # Sorting
        sort_column = getattr(FollowUpTask, sort_by, FollowUpTask.next_followup_date)
        if sort_order == "desc":
            query = query.order_by(sort_column.desc())
        else:
            query = query.order_by(sort_column.asc())

        # Pagination
        offset = (page - 1) * page_size
        tasks = query.offset(offset).limit(page_size).all()

        # Enrich with claim data + supplement status + pending info requests
        # Pre-fetch supplement statuses for all claim_ids in one query
        claim_ids = list(set(str(t.claim_id) for t in tasks if t.claim_id))
        supplement_map = {}
        info_request_map = {}
        negotiation_claim_ids: set = set()
        if claim_ids:
            try:
                from app.domains.client.models import ClaimNegotiation
                neg_rows = self.db_session.query(
                    ClaimNegotiation.claim_id
                ).filter(
                    ClaimNegotiation.claim_id.in_(claim_ids)
                ).distinct().all()
                negotiation_claim_ids = {
                    str(r[0]) for r in neg_rows
                }
            except Exception:
                pass
            try:
                from app.domains.supplement.models import SupplementRequest, SupplementFollowUp
                from sqlalchemy import func as sqlfunc

                supp_rows = self.db_session.query(
                    SupplementRequest.claim_id,
                    SupplementRequest.status,
                    sqlfunc.count(SupplementRequest.id),
                ).filter(
                    SupplementRequest.claim_id.in_(claim_ids)
                ).group_by(
                    SupplementRequest.claim_id,
                    SupplementRequest.status,
                ).all()
                for cid, status, cnt in supp_rows:
                    key = str(cid)
                    if key not in supplement_map:
                        supplement_map[key] = {}
                    supplement_map[key][status] = cnt

                # Pending info requests per claim (via supplement)
                info_rows = (
                    self.db_session.query(
                        SupplementRequest.claim_id,
                        sqlfunc.count(SupplementFollowUp.id),
                    )
                    .join(SupplementFollowUp, SupplementFollowUp.supplement_id == SupplementRequest.id)
                    .filter(
                        SupplementRequest.claim_id.in_(claim_ids),
                        SupplementFollowUp.followup_type == 'info_request',
                        SupplementFollowUp.info_status.notin_(['resolved']),
                    )
                    .group_by(SupplementRequest.claim_id)
                    .all()
                )
                for cid, cnt in info_rows:
                    info_request_map[str(cid)] = cnt
            except Exception:
                pass

        # Pre-fetch bid item estimate summary per claim
        bid_summary_map: dict = {}
        if claim_ids:
            try:
                from app.domains.supplement.models import (
                    BidItemEstimate,
                    SupplementRequest as SuppReq,
                )
                from sqlalchemy import func as bidfunc
                bid_rows = (
                    self.db_session.query(
                        SuppReq.claim_id,
                        BidItemEstimate.status,
                        bidfunc.count(BidItemEstimate.id),
                    )
                    .join(
                        BidItemEstimate,
                        BidItemEstimate.supplement_id == SuppReq.id,
                    )
                    .filter(SuppReq.claim_id.in_(claim_ids))
                    .group_by(SuppReq.claim_id, BidItemEstimate.status)
                    .all()
                )
                for cid, bstatus, cnt in bid_rows:
                    key = str(cid)
                    if key not in bid_summary_map:
                        bid_summary_map[key] = {}
                    bid_summary_map[key][bstatus or 'draft'] = cnt
            except Exception:
                pass

        results = []
        for t in tasks:
            d = self._convert_to_dict(t)
            try:
                if t.claim:
                    d['claim_number'] = t.claim.claim_number or ''
                    d['insurance_company'] = t.claim.insurance_company or ''
                    d['supplement_statuses'] = supplement_map.get(str(t.claim_id), {})
                    d['pending_info_requests'] = info_request_map.get(str(t.claim_id), 0)
                    # PA info
                    d['has_public_adjuster'] = t.claim.has_public_adjuster or False
                    d['pa_name'] = t.claim.pa_name or ''
                    d['pa_company'] = t.claim.pa_company or ''
                    d['pa_email'] = t.claim.pa_email or ''
                    d['pa_phone'] = t.claim.pa_phone or ''
                    d['wm_cost_status'] = t.claim.wm_cost_status or ''
                    d['has_insurance_estimate'] = bool(
                        t.claim.insurance_estimate_received
                        or t.claim.current_acv
                        or t.claim.current_rcv
                        or t.claim.insurance_estimate_file_id
                        or str(t.claim_id) in negotiation_claim_ids
                    )
                    d['bid_estimate_summary'] = bid_summary_map.get(
                        str(t.claim_id), {}
                    )
                    # Depreciation recovery enrichment
                    if t.task_type == 'depreciation_recovery':
                        d['depreciation_amount'] = float(
                            t.claim.current_depreciation or 0
                        )
                        # Check pending supplements
                        supp_statuses = supplement_map.get(
                            str(t.claim_id), {}
                        )
                        pending_supp = sum(
                            cnt for st, cnt in supp_statuses.items()
                            if st not in ('resolved', 'cancelled')
                        )
                        d['has_pending_supplements'] = pending_supp > 0
                        # Check appraisal/attorney tasks
                        appraisal_exists = self.db_session.query(
                            FollowUpTask.id
                        ).filter(
                            FollowUpTask.claim_id == t.claim_id,
                            FollowUpTask.task_type.in_(
                                ['appraisal', 'attorney_referral']
                            ),
                            FollowUpTask.status != 'cancelled',
                            FollowUpTask.id != t.id,
                        ).first()
                        d['has_appraisal_task'] = appraisal_exists is not None
                    # Address is on the Client model
                    if hasattr(t.claim, 'client') and t.claim.client:
                        client = t.claim.client
                        d['property_address'] = client.address or ''
                    else:
                        from app.domains.client.models import Client
                        client = self.db_session.query(Client).filter(
                            Client.id == t.claim.client_id
                        ).first()
                        d['property_address'] = client.address if client else ''
            except Exception:
                pass
            results.append(d)

        return results, total

    def get_overdue_tasks(self) -> List[Dict[str, Any]]:
        """Get all tasks that are overdue (next_followup_date has passed)"""
        now = datetime.now(timezone.utc)
        tasks = self.db_session.query(FollowUpTask).filter(
            and_(
                FollowUpTask.next_followup_date < now,
                FollowUpTask.status.in_(['pending', 'awaiting_response'])
            )
        ).order_by(FollowUpTask.next_followup_date.asc()).all()
        return [self._convert_to_dict(t) for t in tasks]

    def get_tasks_needing_followup(self) -> List[Dict[str, Any]]:
        """Get tasks where auto follow-up is enabled and next contact is due"""
        now = datetime.now(timezone.utc)
        tasks = self.db_session.query(FollowUpTask).filter(
            and_(
                FollowUpTask.auto_followup_enabled == True,
                FollowUpTask.status.in_(['pending', 'awaiting_response']),
                or_(
                    FollowUpTask.next_followup_date <= now,
                    FollowUpTask.next_followup_date == None
                ),
                or_(
                    FollowUpTask.contact_count < FollowUpTask.max_followup_count,
                    FollowUpTask.max_followup_count == None
                )
            )
        ).all()
        return [self._convert_to_dict(t) for t in tasks]

    def get_tasks_by_claim(self, claim_id: str) -> List[Dict[str, Any]]:
        """Get all tasks for a specific claim"""
        tasks = self.db_session.query(FollowUpTask).filter(
            FollowUpTask.claim_id == claim_id
        ).order_by(FollowUpTask.due_date.desc()).all()

        results = []
        for t in tasks:
            d = self._convert_to_dict(t)
            try:
                if t.claim:
                    d['claim_number'] = t.claim.claim_number or ''
                    d['insurance_company'] = t.claim.insurance_company or ''
                    from app.domains.client.models import Client
                    client = self.db_session.query(Client).filter(
                        Client.id == t.claim.client_id
                    ).first()
                    d['property_address'] = client.address if client else ''
            except Exception:
                pass
            results.append(d)
        return results

    def get_dashboard_stats(self) -> Dict[str, Any]:
        """Get summary statistics for the dashboard"""
        now = datetime.now(timezone.utc)

        total = self.db_session.query(func.count(FollowUpTask.id)).filter(
            FollowUpTask.status != 'cancelled'
        ).scalar() or 0

        pending = self.db_session.query(func.count(FollowUpTask.id)).filter(
            FollowUpTask.status == 'pending'
        ).scalar() or 0

        awaiting = self.db_session.query(func.count(FollowUpTask.id)).filter(
            FollowUpTask.status == 'awaiting_response'
        ).scalar() or 0

        overdue = self.db_session.query(func.count(FollowUpTask.id)).filter(
            and_(
                FollowUpTask.next_followup_date < now,
                FollowUpTask.status.in_(['pending', 'awaiting_response'])
            )
        ).scalar() or 0

        # By type
        type_counts = self.db_session.query(
            FollowUpTask.task_type,
            func.count(FollowUpTask.id)
        ).filter(
            FollowUpTask.status.in_(['pending', 'awaiting_response'])
        ).group_by(FollowUpTask.task_type).all()

        # By priority
        priority_counts = self.db_session.query(
            FollowUpTask.priority,
            func.count(FollowUpTask.id)
        ).filter(
            FollowUpTask.status.in_(['pending', 'awaiting_response'])
        ).group_by(FollowUpTask.priority).all()

        return {
            "total_tasks": total,
            "pending": pending,
            "awaiting_response": awaiting,
            "overdue": overdue,
            "resolved_this_week": 0,  # TODO: implement week calculation
            "by_type": {t: c for t, c in type_counts},
            "by_priority": {p: c for p, c in priority_counts},
        }

    def mark_contacted(self, task_id: str, next_followup_date: Optional[datetime] = None) -> Optional[Dict[str, Any]]:
        """Update task after a contact attempt"""
        task = self.db_session.query(FollowUpTask).filter(
            FollowUpTask.id == task_id
        ).first()
        if not task:
            return None

        task.contact_count = (task.contact_count or 0) + 1
        task.last_contacted_at = datetime.now(timezone.utc)
        task.status = 'awaiting_response'
        if next_followup_date:
            task.next_followup_date = next_followup_date

        self.db_session.flush()
        return self._convert_to_dict(task)

    def resolve_task(self, task_id: str, resolution_notes: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """Mark task as resolved"""
        task = self.db_session.query(FollowUpTask).filter(
            FollowUpTask.id == task_id
        ).first()
        if not task:
            return None

        task.status = 'resolved'
        task.resolved_at = datetime.now(timezone.utc)
        if resolution_notes:
            task.resolution_notes = resolution_notes

        self.db_session.flush()
        return self._convert_to_dict(task)


class EmailTemplateRepository(SQLAlchemyRepository):
    """Repository for EmailTemplate CRUD"""

    def __init__(self, session: DatabaseSession):
        super().__init__(session, EmailTemplate)

    def get_active_templates(
        self,
        template_type: Optional[str] = None,
        company_id: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """Get active templates with optional filtering"""
        query = self.db_session.query(EmailTemplate).filter(
            EmailTemplate.is_active == True
        )
        if template_type:
            query = query.filter(EmailTemplate.template_type == template_type)
        if company_id:
            query = query.filter(
                or_(
                    EmailTemplate.company_id == company_id,
                    EmailTemplate.company_id == None  # Include system templates
                )
            )
        else:
            query = query.filter(EmailTemplate.company_id == None)

        templates = query.order_by(EmailTemplate.template_type, EmailTemplate.name).all()
        return [self._convert_to_dict(t) for t in templates]

    def increment_usage(self, template_id: str) -> None:
        """Increment usage count for a template"""
        template = self.db_session.query(EmailTemplate).filter(
            EmailTemplate.id == template_id
        ).first()
        if template:
            template.usage_count = (template.usage_count or 0) + 1
            self.db_session.flush()


class CommunicationLogRepository(SQLAlchemyRepository):
    """Repository for CommunicationLog CRUD"""

    def __init__(self, session: DatabaseSession):
        super().__init__(session, CommunicationLog)

    def get_by_claim(self, claim_id: str, limit: int = 50) -> List[Dict[str, Any]]:
        """Get communication logs for a claim"""
        logs = self.db_session.query(CommunicationLog).filter(
            CommunicationLog.claim_id == claim_id
        ).order_by(CommunicationLog.created_at.desc()).limit(limit).all()
        return [self._convert_to_dict(log) for log in logs]

    def get_by_task(self, task_id: str) -> List[Dict[str, Any]]:
        """Get communication logs for a task"""
        logs = self.db_session.query(CommunicationLog).filter(
            CommunicationLog.followup_task_id == task_id
        ).order_by(CommunicationLog.created_at.desc()).all()
        return [self._convert_to_dict(log) for log in logs]


class SentEmailRepository(SQLAlchemyRepository):
    """Repository for SentEmail CRUD"""

    def __init__(self, session: DatabaseSession):
        super().__init__(session, SentEmail)

    def get_by_claim(self, claim_id: str, limit: int = 50) -> List[Dict[str, Any]]:
        """Get sent emails for a claim"""
        emails = self.db_session.query(SentEmail).filter(
            SentEmail.claim_id == claim_id
        ).order_by(SentEmail.sent_at.desc()).limit(limit).all()
        return [self._convert_to_dict(e) for e in emails]

    def get_by_task(self, task_id: str) -> List[Dict[str, Any]]:
        """Get sent emails for a task"""
        emails = self.db_session.query(SentEmail).filter(
            SentEmail.followup_task_id == task_id
        ).order_by(SentEmail.sent_at.desc()).all()
        return [self._convert_to_dict(e) for e in emails]

    def get_scheduled_emails(self) -> List[Dict[str, Any]]:
        """Get emails that are scheduled and ready to send"""
        now = datetime.now(timezone.utc)
        emails = self.db_session.query(SentEmail).filter(
            and_(
                SentEmail.status == 'queued',
                SentEmail.scheduled_at <= now,
            )
        ).order_by(SentEmail.scheduled_at.asc()).all()
        return [self._convert_to_dict(e) for e in emails]

    def mark_sent(self, email_id: str, smtp_message_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """Mark email as sent"""
        email = self.db_session.query(SentEmail).filter(
            SentEmail.id == email_id
        ).first()
        if not email:
            return None

        email.status = 'sent'
        email.sent_at = datetime.now(timezone.utc)
        if smtp_message_id:
            email.smtp_message_id = smtp_message_id

        self.db_session.flush()
        return self._convert_to_dict(email)

    def mark_failed(self, email_id: str, error_message: str) -> Optional[Dict[str, Any]]:
        """Mark email as failed"""
        email = self.db_session.query(SentEmail).filter(
            SentEmail.id == email_id
        ).first()
        if not email:
            return None

        email.status = 'failed'
        email.error_message = error_message
        self.db_session.flush()
        return self._convert_to_dict(email)


# Factory functions
def get_followup_task_repository(session: DatabaseSession) -> FollowUpTaskRepository:
    return FollowUpTaskRepository(session)

def get_email_template_repository(session: DatabaseSession) -> EmailTemplateRepository:
    return EmailTemplateRepository(session)

def get_communication_log_repository(session: DatabaseSession) -> CommunicationLogRepository:
    return CommunicationLogRepository(session)

def get_sent_email_repository(session: DatabaseSession) -> SentEmailRepository:
    return SentEmailRepository(session)
