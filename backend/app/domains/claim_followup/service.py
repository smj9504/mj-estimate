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

            # Set initial next_followup_date if auto follow-up is enabled
            if data.get('auto_followup_enabled'):
                interval = data.get('followup_interval_days', 3)
                data['next_followup_date'] = data['due_date']

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

    def resolve_task(self, task_id: str, resolution_notes: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """Mark a task as resolved"""
        session = self._get_session()
        try:
            from app.domains.claim_followup.repository import get_followup_task_repository
            repo = get_followup_task_repository(session)
            result = repo.resolve_task(task_id, resolution_notes)
            session.commit()
            return result
        except Exception as e:
            session.rollback()
            raise
        finally:
            session.close()

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
