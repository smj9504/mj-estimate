"""
Claim Follow-up service.
Orchestrates follow-up task management, email template rendering, and communication logging.
"""

import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

from app.core.config import settings

logger = logging.getLogger(__name__)


class ClaimFollowUpService:
    """Service for managing claim follow-up tasks and communications"""

    def __init__(self, database=None):
        from app.core.database_factory import get_database
        self.database = database or get_database()

    def _get_session(self):
        return self.database.get_session()

    def _get_readonly_session(self):
        return self.database.get_readonly_session()

    # ============================================================
    # Follow-Up Tasks
    # ============================================================

    def create_task(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Create a new follow-up task"""
        session = self._get_session()
        try:
            from app.domains.claim_followup.repository import get_followup_task_repository
            repo = get_followup_task_repository(session)

            # Set initial next_followup_date if not already set
            if not data.get('next_followup_date'):
                if data.get('due_date'):
                    data['next_followup_date'] = data['due_date']
                else:
                    interval = data.get('followup_interval_days', 3)
                    data['next_followup_date'] = datetime.now(timezone.utc) + timedelta(days=interval)

            result = repo.create(data)
            session.commit()
            return result
        except Exception as e:
            session.rollback()
            logger.error(f"Error creating follow-up task: {e}")
            raise
        finally:
            session.close()

    def update_task(self, task_id: str, data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Update a follow-up task"""
        session = self._get_session()
        try:
            from app.domains.claim_followup.repository import get_followup_task_repository
            repo = get_followup_task_repository(session)

            # Handle status transitions
            if data.get('status') == 'resolved':
                data['resolved_at'] = datetime.now(timezone.utc)

            result = repo.update(task_id, data)
            session.commit()
            return result
        except Exception as e:
            session.rollback()
            logger.error(f"Error updating follow-up task: {e}")
            raise
        finally:
            session.close()

    def get_task(self, task_id: str) -> Optional[Dict[str, Any]]:
        """Get a single task by ID"""
        session = self._get_readonly_session()
        try:
            from app.domains.claim_followup.repository import get_followup_task_repository
            repo = get_followup_task_repository(session)
            return repo.get_by_id(task_id)
        finally:
            session.close()

    def get_tasks(self, params: Dict[str, Any]) -> Tuple[List[Dict[str, Any]], int]:
        """Get tasks with filtering and pagination"""
        session = self._get_readonly_session()
        try:
            from app.domains.claim_followup.repository import get_followup_task_repository
            repo = get_followup_task_repository(session)
            return repo.get_tasks_with_filters(**params)
        finally:
            session.close()

    def get_tasks_by_claim(self, claim_id: str) -> List[Dict[str, Any]]:
        """Get all tasks for a specific claim"""
        session = self._get_readonly_session()
        try:
            from app.domains.claim_followup.repository import get_followup_task_repository
            repo = get_followup_task_repository(session)
            return repo.get_tasks_by_claim(claim_id)
        finally:
            session.close()

    def get_dashboard_stats(self) -> Dict[str, Any]:
        """Get dashboard statistics"""
        session = self._get_readonly_session()
        try:
            from app.domains.claim_followup.repository import get_followup_task_repository
            repo = get_followup_task_repository(session)
            return repo.get_dashboard_stats()
        finally:
            session.close()

    def resolve_task(
        self,
        task_id: str,
        resolution_notes: Optional[str] = None,
        outcome: Optional[str] = None,
        estimate_data: Optional[Dict[str, Any]] = None,
    ) -> Optional[Dict[str, Any]]:
        """Mark a task as resolved and process outcome"""
        session = self._get_session()
        try:
            from app.domains.claim_followup.repository import get_followup_task_repository
            repo = get_followup_task_repository(session)
            result = repo.resolve_task(task_id, resolution_notes)
            if not result:
                return None

            claim_id = result.get('claim_id')

            # Process outcome
            if outcome and claim_id:
                self._process_resolve_outcome(
                    session, claim_id, result, outcome, resolution_notes,
                    estimate_data=estimate_data,
                )

            session.commit()
            return result
        except Exception as e:
            session.rollback()
            logger.error(f"Error resolving task: {e}")
            raise
        finally:
            session.close()

    def reopen_task(self, task_id: str) -> Optional[Dict[str, Any]]:
        """Reopen a resolved task back to pending"""
        session = self._get_session()
        try:
            from app.domains.claim_followup.repository import get_followup_task_repository
            repo = get_followup_task_repository(session)
            task = repo.get_by_id(task_id)
            if not task:
                return None
            result = repo.update(task_id, {
                'status': 'pending',
                'resolved_at': None,
                'resolution_notes': None,
            })
            session.commit()
            return result
        except Exception as e:
            session.rollback()
            logger.error(f"Error reopening task: {e}")
            raise
        finally:
            session.close()

    def _process_resolve_outcome(
        self,
        session,
        claim_id: str,
        task: Dict[str, Any],
        outcome: str,
        notes: Optional[str] = None,
        estimate_data: Optional[Dict[str, Any]] = None,
    ):
        """Process follow-up resolution outcome - update claim, create rebuild, log activity"""
        from app.domains.client.models import Claim, ClaimActivity

        claim = session.query(Claim).filter(Claim.id == claim_id).first()
        if not claim:
            logger.warning(f"Claim {claim_id} not found for outcome processing")
            return

        property_address = task.get('property_address', '') or ''

        if outcome == 'estimate_received':
            # Update claim - insurance estimate received
            claim.insurance_estimate_received = True
            claim.insurance_estimate_received_date = datetime.now(timezone.utc)
            if claim.status == 'open':
                claim.status = 'negotiating'

            # Store file info on claim if provided
            if estimate_data:
                if estimate_data.get('file_id'):
                    claim.insurance_estimate_file_id = estimate_data['file_id']
                    claim.insurance_estimate_file_name = estimate_data.get('file_name', '')

                # Store WM estimate file if uploaded separately
                if estimate_data.get('wm_file_id'):
                    claim.wm_estimate_file_id = estimate_data['wm_file_id']
                    claim.wm_estimate_file_name = estimate_data.get('wm_file_name', '')

                # Update claim amounts
                acv = estimate_data.get('acv_amount', 0)
                rcv = estimate_data.get('rcv_amount', 0)
                dep = estimate_data.get('depreciation_amount', 0)
                if acv or rcv:
                    claim.current_acv = acv
                    claim.current_rcv = rcv
                    claim.current_depreciation = dep

                # Create ClaimNegotiation record
                self._create_negotiation_from_estimate(
                    session, claim_id, estimate_data
                )

            # WM cost status tracking
            wm_cost_status = None
            if estimate_data:
                wm_cost_status = estimate_data.get('wm_cost_status')
                if wm_cost_status:
                    claim.wm_cost_status = wm_cost_status
                wm_est_amount = estimate_data.get('wm_estimate_amount')
                if wm_est_amount:
                    claim.wm_estimate_amount = wm_est_amount

            # Log activity
            amount_info = ''
            if estimate_data and (estimate_data.get('acv_amount') or estimate_data.get('rcv_amount')):
                amount_info = f" ACV: ${estimate_data.get('acv_amount', 0):,.2f}, RCV: ${estimate_data.get('rcv_amount', 0):,.2f}"

            wm_info = ''
            if wm_cost_status == 'included_in_rebuild':
                wm_info = ' | WM costs included in rebuild estimate.'
            elif wm_cost_status == 'separate_estimate':
                wm_info = f' | WM estimate received separately.'
                wm_amt = estimate_data.get('wm_estimate_amount') if estimate_data else None
                if wm_amt:
                    wm_info += f" WM Amount: ${wm_amt:,.2f}"
                if estimate_data and estimate_data.get('wm_file_name'):
                    wm_info += f" (File: {estimate_data['wm_file_name']})"
            elif wm_cost_status == 'not_received':
                wm_info = ' | WM costs NOT received - follow-up needed.'

            session.add(ClaimActivity(
                claim_id=claim_id,
                activity_type='estimate_received',
                title='Insurance estimate received',
                description=(notes or 'Insurance company sent their estimate.') + amount_info + wm_info,
                related_entity_type='followup_task',
                related_entity_id=task.get('id'),
            ))

            # Auto-create Rebuild Project
            self._auto_create_rebuild_project(session, claim, property_address)

            # Auto-create Supplement for estimate review
            self._auto_create_supplement(session, claim, estimate_data)

            # Update WM job status if paperwork received
            if wm_cost_status in ('included_in_rebuild', 'separate_estimate'):
                self._update_wm_jobs_paperwork_received(session, claim_id)

            # Auto-create WM follow-up task if WM costs not received
            if wm_cost_status == 'not_received':
                self._auto_create_wm_followup(session, claim_id, task, claim)

        elif outcome == 'denied':
            claim.status = 'denied'

            session.add(ClaimActivity(
                claim_id=claim_id,
                activity_type='estimate_denied',
                title='Insurance claim denied',
                description=notes or 'Insurance company denied the claim.',
                related_entity_type='followup_task',
                related_entity_id=task.get('id'),
            ))

        session.flush()

    def _auto_create_wm_followup(
        self, session, claim_id: str, source_task: Dict[str, Any], claim
    ):
        """Auto-create a follow-up task for WM cost recovery when not received"""
        try:
            from app.domains.claim_followup.models import FollowUpTask as FollowUpTaskModel
            from app.domains.client.models import ClaimActivity

            # Check if a WM payment follow-up already exists
            existing = session.query(FollowUpTaskModel).filter(
                FollowUpTaskModel.claim_id == claim_id,
                FollowUpTaskModel.task_type == 'payment_check',
                FollowUpTaskModel.status.in_(['pending', 'awaiting_response']),
                FollowUpTaskModel.title.ilike('%water mitigation%'),
            ).first()
            if existing:
                logger.info(f"WM follow-up already exists for claim {claim_id}")
                return

            wm_task = FollowUpTaskModel(
                claim_id=claim_id,
                task_type='wm_payment_check',
                title=f'Follow up: WM costs not included in estimate',
                description=(
                    'Insurance estimate was received but Water Mitigation costs were not included. '
                    'Follow up with insurance company to request WM cost coverage.'
                ),
                status='pending',
                priority='high',
                next_followup_date=datetime.now(timezone.utc) + timedelta(days=3),
                assigned_to_name=source_task.get('assigned_to_name'),
                assigned_to_email=source_task.get('assigned_to_email'),
                assigned_to_role=source_task.get('assigned_to_role', 'adjuster'),
                auto_followup_enabled=True,
                followup_interval_days=3,
                max_followup_count=5,
            )
            session.add(wm_task)
            session.flush()

            session.add(ClaimActivity(
                claim_id=claim_id,
                activity_type='followup_created',
                title='WM cost follow-up auto-created',
                description='Water mitigation costs not included in insurance estimate. Auto-created follow-up task.',
                related_entity_type='followup_task',
                related_entity_id=wm_task.id,
            ))

            logger.info(f"Auto-created WM follow-up task for claim {claim_id}")
        except Exception as e:
            logger.error(f"Error auto-creating WM follow-up: {e}")

    def _update_wm_jobs_paperwork_received(self, session, claim_id: str):
        """Update WM jobs linked to this claim to 'Paperwork received' status"""
        try:
            from app.domains.water_mitigation.models import WaterMitigationJob, WMJobStatusHistory
            from app.domains.client.models import ClaimActivity

            wm_jobs = session.query(WaterMitigationJob).filter(
                WaterMitigationJob.claim_id == claim_id,
                WaterMitigationJob.active == True,
                WaterMitigationJob.status.in_(['Sent to adjuster', 'Follow up']),
            ).all()

            for job in wm_jobs:
                prev_status = job.status
                job.status = 'Paperwork received'

                # Create status history
                history = WMJobStatusHistory(
                    job_id=job.id,
                    previous_status=prev_status,
                    new_status='Paperwork received',
                    notes='Auto-updated: insurance estimate received with WM costs included.',
                )
                session.add(history)

                session.add(ClaimActivity(
                    claim_id=claim_id,
                    activity_type='status_changed',
                    title=f'WM Job: {prev_status} → Paperwork received',
                    description=f'Auto-updated after insurance estimate received ({job.property_address}).',
                    related_entity_type='wm_job',
                    related_entity_id=job.id,
                ))

            if wm_jobs:
                session.flush()
                logger.info(f"Updated {len(wm_jobs)} WM job(s) to 'Paperwork received' for claim {claim_id}")
        except Exception as e:
            logger.error(f"Error updating WM jobs to paperwork received: {e}")

    def _auto_create_supplement(
        self, session, claim, estimate_data: Optional[Dict[str, Any]]
    ):
        """Auto-create a Supplement Request when insurance estimate is received for review"""
        try:
            from app.domains.supplement.models import SupplementRequest
            from app.domains.client.models import ClaimActivity, Client

            claim_id = str(claim.id)

            # Check if pending review supplement already exists
            existing = session.query(SupplementRequest).filter(
                SupplementRequest.claim_id == claim_id,
                SupplementRequest.status == 'identified',
            ).first()
            if existing:
                logger.info(f"Pending supplement already exists for claim {claim_id}")
                return

            # Get address
            client = session.query(Client).filter(Client.id == claim.client_id).first()
            address = client.address if client else ''

            insurance_rcv = float(estimate_data.get('rcv_amount', 0)) if estimate_data else 0

            supplement = SupplementRequest(
                claim_id=claim_id,
                title=f"Review Insurance Estimate - {address}" if address else "Review Insurance Estimate",
                reason="Insurance estimate received. Review and compare with our estimate to identify supplement needs.",
                original_amount=insurance_rcv,
                supplement_amount=0,
                difference=0 - insurance_rcv,
                status='identified',
                priority='high',
            )
            session.add(supplement)
            session.flush()

            # Update claim
            claim.needs_supplement = True
            claim.supplement_status = 'identified'

            session.add(ClaimActivity(
                claim_id=claim_id,
                activity_type='supplement_created',
                title='Supplement review created',
                description=f'Insurance estimate received (RCV: ${insurance_rcv:,.2f}). Review needed to identify supplement requirements.',
                related_entity_type='supplement',
                related_entity_id=supplement.id,
            ))

            logger.info(f"Auto-created supplement for claim {claim_id}")
        except Exception as e:
            logger.error(f"Error auto-creating supplement: {e}")

    def _create_negotiation_from_estimate(
        self, session, claim_id: str, estimate_data: Dict[str, Any]
    ):
        """Create a ClaimNegotiation record from insurance estimate data"""
        try:
            from app.domains.client.models import ClaimNegotiation
            from sqlalchemy import func as sqlfunc

            # Get next revision number
            max_rev = session.query(sqlfunc.max(ClaimNegotiation.revision_number)).filter(
                ClaimNegotiation.claim_id == claim_id
            ).scalar() or 0

            negotiation = ClaimNegotiation(
                claim_id=claim_id,
                revision_number=max_rev + 1,
                revision_type='initial',
                acv_amount=estimate_data.get('acv_amount', 0),
                rcv_amount=estimate_data.get('rcv_amount', 0),
                depreciation_amount=estimate_data.get('depreciation_amount', 0),
                deductible=estimate_data.get('deductible', 0),
                date_received=datetime.now(timezone.utc),
                received_from='Insurance Company',
                document_url=estimate_data.get('file_id', ''),
                document_name=estimate_data.get('file_name', ''),
                sections_data=estimate_data.get('sections_data'),
                notes='Uploaded during follow-up resolution',
            )
            session.add(negotiation)
            session.flush()
            logger.info(f"Created negotiation revision {max_rev + 1} for claim {claim_id}")
        except Exception as e:
            logger.error(f"Error creating negotiation: {e}")

    def _auto_create_rebuild_project(self, session, claim, property_address: str):
        """Auto-create a Rebuild Project when insurance estimate is received"""
        try:
            from app.domains.rebuild.models import RebuildProject
            from app.domains.client.models import ClaimActivity

            # Check if rebuild project already exists for this claim
            existing = session.query(RebuildProject).filter(
                RebuildProject.claim_id == str(claim.id)
            ).first()
            if existing:
                logger.info(f"Rebuild project already exists for claim {claim.id}")
                return

            claim_number = claim.claim_number or ''
            address = property_address or (
                getattr(claim, 'client', None) and
                getattr(claim.client, 'address', '')
            ) or ''

            project = RebuildProject(
                claim_id=str(claim.id),
                title=f"Rebuild - {address or claim_number}",
                property_address=address,
                status='pending',
                insurance_estimate_amount=float(claim.current_rcv or 0),
                priority='normal',
            )
            session.add(project)
            session.flush()

            # Log activity
            session.add(ClaimActivity(
                claim_id=str(claim.id),
                activity_type='rebuild_created',
                title='Rebuild project created',
                description=f'Auto-created rebuild project after insurance estimate received.',
                related_entity_type='rebuild_project',
                related_entity_id=project.id,
            ))

            logger.info(f"Auto-created rebuild project for claim {claim.id}")
        except Exception as e:
            logger.error(f"Error auto-creating rebuild project: {e}")

    def delete_task(self, task_id: str) -> bool:
        """Delete a follow-up task"""
        session = self._get_session()
        try:
            from app.domains.claim_followup.repository import get_followup_task_repository
            repo = get_followup_task_repository(session)
            result = repo.delete(task_id)
            session.commit()
            return result
        except Exception as e:
            session.rollback()
            raise
        finally:
            session.close()

    # ============================================================
    # Email Templates
    # ============================================================

    def create_template(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Create a new email template"""
        session = self._get_session()
        try:
            from app.domains.claim_followup.repository import get_email_template_repository
            repo = get_email_template_repository(session)
            result = repo.create(data)
            session.commit()
            return result
        except Exception as e:
            session.rollback()
            raise
        finally:
            session.close()

    def update_template(self, template_id: str, data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Update an email template"""
        session = self._get_session()
        try:
            from app.domains.claim_followup.repository import get_email_template_repository
            repo = get_email_template_repository(session)
            result = repo.update(template_id, data)
            session.commit()
            return result
        except Exception as e:
            session.rollback()
            raise
        finally:
            session.close()

    def get_template(self, template_id: str) -> Optional[Dict[str, Any]]:
        """Get a template by ID"""
        session = self._get_readonly_session()
        try:
            from app.domains.claim_followup.repository import get_email_template_repository
            repo = get_email_template_repository(session)
            return repo.get_by_id(template_id)
        finally:
            session.close()

    def get_templates(
        self,
        template_type: Optional[str] = None,
        company_id: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """Get all active templates"""
        session = self._get_readonly_session()
        try:
            from app.domains.claim_followup.repository import get_email_template_repository
            repo = get_email_template_repository(session)
            return repo.get_active_templates(template_type, company_id)
        finally:
            session.close()

    def delete_template(self, template_id: str) -> bool:
        """Delete an email template (soft delete by deactivating)"""
        session = self._get_session()
        try:
            from app.domains.claim_followup.repository import get_email_template_repository
            repo = get_email_template_repository(session)
            result = repo.update(template_id, {"is_active": False})
            session.commit()
            return result is not None
        except Exception as e:
            session.rollback()
            raise
        finally:
            session.close()

    def render_template(self, template_id: str, variables: Dict[str, str]) -> Dict[str, str]:
        """Render a template with provided variables"""
        template = self.get_template(template_id)
        if not template:
            raise ValueError(f"Template {template_id} not found")

        subject = self._substitute_variables(template['subject_template'], variables)
        body = self._substitute_variables(template['body_template'], variables)

        return {"subject": subject, "body_html": body}

    def _substitute_variables(self, text: str, variables: Dict[str, str]) -> str:
        """Replace {{variable}} placeholders with actual values"""
        def replace_match(match):
            var_name = match.group(1).strip()
            return variables.get(var_name, match.group(0))

        return re.sub(r'\{\{(\w+)\}\}', replace_match, text)

    # ============================================================
    # Communication Logs
    # ============================================================

    def log_communication(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Log a communication event"""
        session = self._get_session()
        try:
            from app.domains.claim_followup.repository import (
                get_communication_log_repository,
                get_followup_task_repository,
            )
            log_repo = get_communication_log_repository(session)
            result = log_repo.create(data)

            # Update task contact info if linked to a task
            if data.get('followup_task_id') and data.get('direction') == 'outbound':
                task_repo = get_followup_task_repository(session)
                interval_days = 3  # default
                task = task_repo.get_by_id(data['followup_task_id'])
                if task and task.get('followup_interval_days'):
                    interval_days = task['followup_interval_days']
                next_date = datetime.now(timezone.utc) + timedelta(days=interval_days)
                task_repo.mark_contacted(data['followup_task_id'], next_date)

            session.commit()
            return result
        except Exception as e:
            session.rollback()
            raise
        finally:
            session.close()

    def update_communication(self, log_id: str, data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Update a communication log (e.g., mark response received)"""
        session = self._get_session()
        try:
            from app.domains.claim_followup.repository import get_communication_log_repository
            repo = get_communication_log_repository(session)
            result = repo.update(log_id, data)
            session.commit()
            return result
        except Exception as e:
            session.rollback()
            raise
        finally:
            session.close()

    def get_communications_by_claim(self, claim_id: str) -> List[Dict[str, Any]]:
        """Get all communications for a claim"""
        session = self._get_readonly_session()
        try:
            from app.domains.claim_followup.repository import get_communication_log_repository
            repo = get_communication_log_repository(session)
            return repo.get_by_claim(claim_id)
        finally:
            session.close()

    def get_communications_by_task(self, task_id: str) -> List[Dict[str, Any]]:
        """Get all communications for a task"""
        session = self._get_readonly_session()
        try:
            from app.domains.claim_followup.repository import get_communication_log_repository
            repo = get_communication_log_repository(session)
            return repo.get_by_task(task_id)
        finally:
            session.close()

    # ============================================================
    # Sent Emails
    # ============================================================

    def get_sent_emails_by_claim(self, claim_id: str) -> List[Dict[str, Any]]:
        """Get all sent emails for a claim"""
        session = self._get_readonly_session()
        try:
            from app.domains.claim_followup.repository import get_sent_email_repository
            repo = get_sent_email_repository(session)
            return repo.get_by_claim(claim_id)
        finally:
            session.close()

    def get_sent_emails_by_task(self, task_id: str) -> List[Dict[str, Any]]:
        """Get all sent emails for a task"""
        session = self._get_readonly_session()
        try:
            from app.domains.claim_followup.repository import get_sent_email_repository
            repo = get_sent_email_repository(session)
            return repo.get_by_task(task_id)
        finally:
            session.close()

    def mark_reply(self, email_id: str, reply_summary: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """Mark a sent email as having received a reply"""
        session = self._get_session()
        try:
            from app.domains.claim_followup.models import SentEmail
            email = session.query(SentEmail).filter(SentEmail.id == email_id).first()
            if not email:
                return None

            email.reply_received = True
            email.reply_received_at = datetime.now(timezone.utc)
            if reply_summary:
                email.reply_summary = reply_summary

            session.flush()

            # Convert to dict
            from app.domains.claim_followup.repository import get_sent_email_repository
            repo = get_sent_email_repository(session)
            result = repo.get_by_id(email_id)

            session.commit()
            return result
        except Exception as e:
            session.rollback()
            logger.error(f"Error marking reply: {e}")
            raise
        finally:
            session.close()

    # ============================================================
    # Email Sending (delegates to smtp_service)
    # ============================================================

    def send_email(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Send an email and record it"""
        session = self._get_session()
        try:
            from app.domains.claim_followup.repository import (
                get_sent_email_repository,
                get_email_template_repository,
                get_followup_task_repository,
            )
            from app.domains.claim_followup.smtp_service import SmtpService

            email_repo = get_sent_email_repository(session)

            # Determine from_address
            from_address = data.get('from_address')
            if not from_address and data.get('email_account_id'):
                from app.domains.email_ingestion.repository import get_email_account_repository
                account_repo = get_email_account_repository(session)
                account = account_repo.get_by_id(data['email_account_id'])
                if account:
                    from_address = account['email_address']

            if not from_address:
                from_address = getattr(settings, 'DEFAULT_FROM_EMAIL', 'noreply@example.com')

            # Create sent email record
            email_data = {
                'claim_id': data['claim_id'],
                'followup_task_id': data.get('followup_task_id'),
                'email_account_id': data.get('email_account_id'),
                'from_address': from_address,
                'to_addresses': data['to_addresses'],
                'cc_addresses': data.get('cc_addresses', []),
                'bcc_addresses': data.get('bcc_addresses', []),
                'reply_to': data.get('reply_to'),
                'subject': data['subject'],
                'body_html': data['body_html'],
                'body_text': data.get('body_text'),
                'attachments': data.get('attachments', []),
                'template_id': data.get('template_id'),
                'template_variables': data.get('template_variables'),
                'is_ai_generated': data.get('is_ai_generated', False),
                'status': 'sending',
                'scheduled_at': data.get('scheduled_at'),
            }

            # If scheduled for later, queue it
            if data.get('scheduled_at'):
                email_data['status'] = 'queued'
                result = email_repo.create(email_data)
                session.commit()
                return result

            # Send immediately via SMTP
            result = email_repo.create(email_data)
            email_id = str(result['id'])

            try:
                smtp = SmtpService()
                smtp_result = smtp.send(
                    account_id=data.get('email_account_id'),
                    from_address=from_address,
                    to_addresses=data['to_addresses'],
                    cc_addresses=data.get('cc_addresses', []),
                    subject=data['subject'],
                    body_html=data['body_html'],
                    attachments=data.get('attachments', []),
                )
                email_repo.mark_sent(email_id, smtp_result.get('message_id'))
            except Exception as smtp_error:
                logger.error(f"SMTP send failed: {smtp_error}")
                email_repo.mark_failed(email_id, str(smtp_error))
                # Still commit the record with failed status
                session.commit()
                raise

            # Update template usage if applicable
            if data.get('template_id'):
                template_repo = get_email_template_repository(session)
                template_repo.increment_usage(str(data['template_id']))

            # Update follow-up task if linked
            if data.get('followup_task_id'):
                task_repo = get_followup_task_repository(session)
                from datetime import timedelta
                task = task_repo.get_by_id(str(data['followup_task_id']))
                interval = 3
                if task and task.get('followup_interval_days'):
                    interval = task['followup_interval_days']
                next_date = datetime.now(timezone.utc) + timedelta(days=interval)
                task_repo.mark_contacted(str(data['followup_task_id']), next_date)

            session.commit()
            return email_repo.get_by_id(email_id)
        except Exception as e:
            session.rollback()
            logger.error(f"Error sending email: {e}")
            raise
        finally:
            session.close()

    def send_from_template(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Send email using a template with variable substitution"""
        template_id = str(data['template_id'])
        variables = data.get('variables', {})

        # Render template
        rendered = self.render_template(template_id, variables)

        # Merge with send data
        send_data = {
            'claim_id': data['claim_id'],
            'followup_task_id': data.get('followup_task_id'),
            'email_account_id': data.get('email_account_id'),
            'to_addresses': data['to_addresses'],
            'cc_addresses': data.get('cc_addresses', []),
            'subject': rendered['subject'],
            'body_html': rendered['body_html'],
            'attachments': data.get('attachments', []),
            'template_id': template_id,
            'template_variables': variables,
            'scheduled_at': data.get('scheduled_at'),
        }

        return self.send_email(send_data)

    def generate_ai_email(self, data: Dict[str, Any]) -> Dict[str, str]:
        """Generate email content using AI"""
        from app.domains.claim_followup.ai_composer import generate_email_content

        # Gather claim context
        claim_context = self._get_claim_context(data['claim_id'])

        return generate_email_content(
            context_type=data['context_type'],
            claim_context=claim_context,
            tone=data.get('tone', 'professional'),
            language=data.get('language', 'en'),
            additional_context=data.get('additional_context'),
            followup_task_id=data.get('followup_task_id'),
        )

    def _get_claim_context(self, claim_id: str) -> Dict[str, Any]:
        """Gather claim information for AI email generation"""
        session = self._get_readonly_session()
        try:
            from app.domains.client.models import Claim, Client
            claim = session.query(Claim).filter(Claim.id == claim_id).first()
            if not claim:
                return {}

            client = session.query(Client).filter(Client.id == claim.client_id).first()

            context = {
                'claim_number': claim.claim_number,
                'insurance_company': claim.insurance_company or '',
                'adjuster_name': claim.adjuster_name or '',
                'adjuster_email': claim.adjuster_email or '',
                'status': claim.status or '',
                'current_acv': float(claim.current_acv or 0),
                'current_rcv': float(claim.current_rcv or 0),
                'our_estimate_amount': float(claim.our_estimate_amount or 0),
            }

            if client:
                context['homeowner_name'] = client.display_name or ''
                context['property_address'] = client.address or ''

            return context
        finally:
            session.close()
