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

            # Sync payment status to WM job if applicable
            if result and ('payment_status' in data or 'payment_note' in data):
                self._sync_payment_to_wm(session, result, data)

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

    def save_estimate_data(
        self,
        task_id: str,
        estimate_data: Dict[str, Any],
    ) -> Optional[Dict[str, Any]]:
        """Save/update estimate data on a task without resolving it."""
        session = self._get_session()
        try:
            from app.domains.claim_followup.repository import (
                get_followup_task_repository,
            )
            repo = get_followup_task_repository(session)
            task = repo.get_by_id(task_id)
            if not task:
                return None

            claim_id = task.get('claim_id')
            if not claim_id:
                return None

            from app.domains.client.models import Claim
            claim = session.query(Claim).filter(
                Claim.id == claim_id
            ).first()
            if not claim:
                return None

            # Update claim amounts
            acv = estimate_data.get('acv_amount', 0)
            rcv = estimate_data.get('rcv_amount', 0)
            dep = estimate_data.get('depreciation_amount', 0)
            if acv or rcv:
                claim.current_acv = acv
                claim.current_rcv = rcv
                claim.current_depreciation = dep

            # Store file info
            if estimate_data.get('file_id'):
                claim.insurance_estimate_file_id = (
                    estimate_data['file_id']
                )
                claim.insurance_estimate_file_name = (
                    estimate_data.get('file_name', '')
                )
            if estimate_data.get('wm_file_id'):
                claim.wm_estimate_file_id = (
                    estimate_data['wm_file_id']
                )
                claim.wm_estimate_file_name = (
                    estimate_data.get('wm_file_name', '')
                )

            # WM cost status
            wm_cost_status = estimate_data.get('wm_cost_status')
            if wm_cost_status:
                claim.wm_cost_status = wm_cost_status
            wm_est_amount = estimate_data.get('wm_estimate_amount')
            if wm_est_amount:
                claim.wm_estimate_amount = wm_est_amount

            # Create/update ClaimNegotiation
            self._create_negotiation_from_estimate(
                session, str(claim_id), estimate_data
            )

            session.commit()
            return repo.get_by_id(task_id)
        except Exception as e:
            session.rollback()
            logger.error(f"Error saving estimate data: {e}")
            raise
        finally:
            session.close()

    def resolve_task(
        self,
        task_id: str,
        resolution_notes: Optional[str] = None,
        outcome: Optional[str] = None,
        estimate_data: Optional[Dict[str, Any]] = None,
        denied_action: Optional[str] = None,
        payment_status: Optional[str] = None,
        payment_note: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        """Mark a task as resolved and process outcome.

        When outcome='denied' and denied_action is dispute/appraisal/attorney,
        the task is NOT resolved — instead it is converted to the new type
        and the claim stays open.
        """
        session = self._get_session()
        try:
            from app.domains.claim_followup.repository import get_followup_task_repository
            repo = get_followup_task_repository(session)

            # Denied + continuing action → keep task open, change type
            if (outcome == 'denied'
                    and denied_action
                    and denied_action != 'complete'):
                result = self._handle_denied_continue(
                    session, repo, task_id,
                    denied_action, resolution_notes,
                )
                session.commit()
                return result

            # Normal resolve flow
            result = repo.resolve_task(task_id, resolution_notes)
            if not result:
                return None

            # Save payment info on the task and sync to WM job
            if payment_status or payment_note:
                update_data = {}
                if payment_status:
                    update_data['payment_status'] = payment_status
                if payment_note:
                    update_data['payment_note'] = payment_note
                repo.update(task_id, update_data)
                result.update(update_data)
                self._sync_payment_to_wm(session, result, update_data)

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
            })
            session.commit()
            return result
        except Exception as e:
            session.rollback()
            logger.error(f"Error reopening task: {e}")
            raise
        finally:
            session.close()

    def _handle_denied_continue(
        self, session, repo, task_id: str,
        denied_action: str,
        resolution_notes: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        """Handle denied claim with continuing action.

        Updates task type to dispute/appraisal/attorney_referral,
        keeps task open, and keeps claim.status as 'open'.
        """
        from app.domains.client.models import Claim, ClaimActivity

        task = repo.get_by_id(task_id)
        if not task:
            return None

        ACTION_MAP = {
            'dispute': {
                'task_type': 'dispute',
                'title': 'Dispute: Insurance claim denied',
                'desc': 'Claim denied. Preparing estimate '
                        'to dispute with insurance company.',
                'activity': 'Proceeding with dispute',
            },
            'appraisal': {
                'task_type': 'appraisal',
                'title': 'Appraisal: Insurance claim denied',
                'desc': 'Claim denied. '
                        'Proceeding to appraisal process.',
                'activity': 'Proceeding with appraisal',
            },
            'attorney': {
                'task_type': 'attorney_referral',
                'title': 'Attorney: Insurance claim denied',
                'desc': 'Claim denied. '
                        'Referred to attorney for review.',
                'activity': 'Referred to attorney',
            },
        }

        action_info = ACTION_MAP.get(denied_action)
        if not action_info:
            return None

        # Update task type and description, keep open
        update_data = {
            'task_type': action_info['task_type'],
            'title': action_info['title'],
            'description': (
                resolution_notes or action_info['desc']
            ),
            'status': 'pending',
            'resolved_at': None,
            'next_followup_date': (
                datetime.now(timezone.utc) + timedelta(days=3)
            ),
        }
        result = repo.update(task_id, update_data)

        # Log activity on claim
        claim_id = task.get('claim_id')
        if claim_id:
            claim = session.query(Claim).filter(
                Claim.id == claim_id
            ).first()
            # Keep claim status as open (not denied)
            if claim and claim.status == 'denied':
                claim.status = 'open'

            session.add(ClaimActivity(
                claim_id=claim_id,
                activity_type='denied_action',
                title=action_info['activity'],
                description=(
                    resolution_notes
                    or action_info['desc']
                ),
                related_entity_type='followup_task',
                related_entity_id=task.get('id'),
            ))

        session.flush()
        return result

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

            # Auto-create payment tasks based on WM cost status
            # Always create rebuild payment task when estimate is received
            self._auto_create_payment_task(
                session, claim_id, task, 'payment_check',
                title='Rebuild Payment',
                description='Insurance estimate received. Follow up for rebuild payment check.',
            )

            if wm_cost_status == 'separate_estimate':
                # WM costs are separate → need independent WM payment tracking
                self._auto_create_payment_task(
                    session, claim_id, task, 'wm_payment_check',
                    title='WM Payment',
                    description='Water mitigation estimate received separately. Follow up for WM payment check.',
                )
            elif wm_cost_status == 'not_received':
                # WM costs not included → follow up to request coverage
                self._auto_create_wm_followup(session, claim_id, task, claim)

        elif outcome == 'wm_estimate_only':
            # WM estimate received but rebuild estimate not yet available
            wm_est_amount = None
            if estimate_data:
                wm_est_amount = estimate_data.get('wm_estimate_amount')
                if estimate_data.get('wm_file_id'):
                    claim.wm_estimate_file_id = estimate_data['wm_file_id']
                    claim.wm_estimate_file_name = estimate_data.get('wm_file_name', '')
                if wm_est_amount:
                    claim.wm_estimate_amount = wm_est_amount

            claim.wm_cost_status = 'separate_estimate'

            # Update WM job status
            self._update_wm_jobs_paperwork_received(session, claim_id)

            # Auto-create WM payment task
            self._auto_create_payment_task(
                session, claim_id, task, 'wm_payment_check',
                title='WM Payment',
                description='WM estimate received. Follow up for WM payment check.',
            )

            wm_amount_info = f" WM Amount: ${wm_est_amount:,.2f}" if wm_est_amount else ''
            session.add(ClaimActivity(
                claim_id=claim_id,
                activity_type='wm_estimate_received',
                title='WM estimate received (rebuild pending)',
                description=(notes or 'Water mitigation estimate received. Rebuild estimate not yet available.') + wm_amount_info,
                related_entity_type='followup_task',
                related_entity_id=task.get('id'),
            ))

        elif outcome == 'estimate_requested':
            # Insurance asked us to provide the estimate
            self._auto_create_estimate_request(
                session, claim, task, notes
            )

            session.add(ClaimActivity(
                claim_id=claim_id,
                activity_type='estimate_requested',
                title='Insurance requested contractor estimate',
                description=(
                    notes
                    or 'Insurance company requested '
                       'our estimate for this claim.'
                ),
                related_entity_type='followup_task',
                related_entity_id=task.get('id'),
            ))

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

    def _sync_payment_to_wm(
        self, session, task: Dict[str, Any], data: Dict[str, Any]
    ):
        """Sync payment_status/payment_note from follow-up task to WM job"""
        try:
            task_type = task.get('task_type', '')
            if task_type not in ('payment_check', 'wm_payment_check'):
                return

            claim_id = task.get('claim_id')
            if not claim_id:
                return

            from app.domains.water_mitigation.models import (
                WaterMitigationJob,
            )
            wm_job = session.query(WaterMitigationJob).filter(
                WaterMitigationJob.claim_id == claim_id
            ).first()
            if not wm_job:
                return

            if 'payment_status' in data and data['payment_status']:
                wm_job.payment_status = data['payment_status']
            if 'payment_note' in data and data['payment_note']:
                wm_job.payment_note = data['payment_note']

            logger.info(
                f"Synced payment status to WM job {wm_job.id}: "
                f"{data.get('payment_status')}"
            )
        except Exception as e:
            logger.warning(f"Failed to sync payment to WM: {e}")

    def _auto_create_payment_task(
        self,
        session,
        claim_id: str,
        source_task: Dict[str, Any],
        task_type: str,
        title: str,
        description: str,
    ):
        """Auto-create a payment follow-up task (rebuild or WM) if one doesn't exist"""
        try:
            from app.domains.claim_followup.models import FollowUpTask as FollowUpTaskModel

            existing = session.query(FollowUpTaskModel).filter(
                FollowUpTaskModel.claim_id == claim_id,
                FollowUpTaskModel.task_type == task_type,
                FollowUpTaskModel.status.notin_(['cancelled']),
            ).first()
            if existing:
                logger.info(f"{task_type} task already exists for claim {claim_id}")
                return

            payment_task = FollowUpTaskModel(
                claim_id=claim_id,
                task_type=task_type,
                title=title,
                description=description,
                status='pending',
                priority='normal',
                next_followup_date=datetime.now(timezone.utc) + timedelta(days=7),
                assigned_to_name=source_task.get('assigned_to_name'),
                assigned_to_email=source_task.get('assigned_to_email'),
                assigned_to_phone=source_task.get('assigned_to_phone'),
                assigned_to_role=source_task.get('assigned_to_role', 'adjuster'),
                auto_followup_enabled=True,
                followup_interval_days=7,
                max_followup_count=10,
            )
            session.add(payment_task)
            session.flush()

            logger.info(f"Auto-created {task_type} task for claim {claim_id}")
        except Exception as e:
            logger.error(f"Error auto-creating {task_type} task: {e}")

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

            # Check if any active supplement already exists for this claim
            existing = session.query(SupplementRequest).filter(
                SupplementRequest.claim_id == claim_id,
                SupplementRequest.status.notin_(['approved', 'denied', 'withdrawn']),
            ).first()
            if existing:
                logger.info(f"Active supplement already exists for claim {claim_id} (status={existing.status})")
                return

            # Get address
            client = session.query(Client).filter(Client.id == claim.client_id).first()
            address = client.address if client else ''

            insurance_rcv = float(estimate_data.get('rcv_amount', 0)) if estimate_data else 0

            supplement = SupplementRequest(
                claim_id=claim_id,
                title="Review Insurance Estimate",
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

    def _auto_create_estimate_request(
        self, session, claim, task: Dict[str, Any],
        notes: Optional[str] = None,
    ):
        """Auto-create a SupplementRequest with request_type='estimate_request'
        when insurance asks the contractor to provide an estimate."""
        try:
            from app.domains.supplement.models import SupplementRequest
            from app.domains.client.models import ClaimActivity, Client

            claim_id = str(claim.id)

            # Check if one already exists
            existing = session.query(SupplementRequest).filter(
                SupplementRequest.claim_id == claim_id,
                SupplementRequest.request_type == 'estimate_request',
                SupplementRequest.status.notin_(
                    ['approved', 'denied', 'withdrawn']
                ),
            ).first()
            if existing:
                logger.info(
                    f"Estimate request already exists for claim {claim_id}"
                )
                return

            # Get address
            client = session.query(Client).filter(
                Client.id == claim.client_id
            ).first()
            address = client.address if client else ''

            # Get PA info from claim
            pa_name = claim.pa_name or ''
            pa_email = claim.pa_email or ''

            est_req = SupplementRequest(
                claim_id=claim_id,
                request_type='estimate_request',
                title=(
                    f"Estimate Request - {address}"
                    if address
                    else "Estimate Request"
                ),
                reason=(
                    notes
                    or 'Insurance company requested '
                       'contractor estimate for this claim.'
                ),
                original_amount=0,
                supplement_amount=0,
                our_estimate_amount=0,
                status='identified',
                priority='high',
                submitted_to=pa_name,
                submitted_to_email=pa_email,
            )
            session.add(est_req)
            session.flush()

            session.add(ClaimActivity(
                claim_id=claim_id,
                activity_type='estimate_request_created',
                title='Estimate request created',
                description=(
                    'Insurance requested contractor estimate. '
                    'Auto-created estimate request task.'
                ),
                related_entity_type='supplement',
                related_entity_id=est_req.id,
            ))

            logger.info(
                f"Auto-created estimate request for claim {claim_id}"
            )
        except Exception as e:
            logger.error(f"Error auto-creating estimate request: {e}")

    def _get_next_revision_number(self, session, claim_id: str, category: str) -> int:
        """Get next revision number per claim + category (independent tracks)."""
        from app.domains.client.models import ClaimNegotiation
        from sqlalchemy import func as sqlfunc
        max_rev = session.query(sqlfunc.max(ClaimNegotiation.revision_number)).filter(
            ClaimNegotiation.claim_id == claim_id,
            ClaimNegotiation.estimate_category == category,
        ).scalar() or 0
        return max_rev + 1

    def _upsert_negotiation(
        self, session, claim_id: str, category: str, data: Dict[str, Any]
    ):
        """Create or update a ClaimNegotiation by claim + category.

        Matches existing initial negotiation by estimate_category to avoid
        creating duplicate revisions. Reconstruction and WM estimates are
        independent and won't overwrite each other.
        """
        from app.domains.client.models import ClaimNegotiation

        existing = session.query(ClaimNegotiation).filter(
            ClaimNegotiation.claim_id == claim_id,
            ClaimNegotiation.revision_type == 'initial',
            ClaimNegotiation.estimate_category == category,
        ).first()

        if existing:
            existing.acv_amount = data.get('acv_amount', 0)
            existing.rcv_amount = data.get('rcv_amount', 0)
            existing.depreciation_amount = data.get('depreciation_amount', 0)
            existing.deductible = data.get('deductible', 0)
            existing.date_received = datetime.now(timezone.utc)
            existing.received_from = data.get('received_from', 'Insurance Company')
            # Only overwrite document fields if new data actually provides them;
            # otherwise preserve the previously uploaded PDF association.
            if data.get('document_url'):
                existing.document_url = data['document_url']
            if data.get('document_name'):
                existing.document_name = data['document_name']
            if data.get('sections_data') is not None:
                existing.sections_data = data['sections_data']
            existing.notes = data.get('notes', '')
            session.flush()
            logger.info(f"Updated {category} negotiation (rev {existing.revision_number}) for claim {claim_id}")
            return existing
        else:
            neg = ClaimNegotiation(
                claim_id=claim_id,
                revision_number=self._get_next_revision_number(session, claim_id, category),
                revision_type='initial',
                estimate_category=category,
                acv_amount=data.get('acv_amount', 0),
                rcv_amount=data.get('rcv_amount', 0),
                depreciation_amount=data.get('depreciation_amount', 0),
                deductible=data.get('deductible', 0),
                date_received=datetime.now(timezone.utc),
                received_from=data.get('received_from', 'Insurance Company'),
                document_url=data.get('document_url') or None,
                document_name=data.get('document_name') or None,
                sections_data=data.get('sections_data'),
                notes=data.get('notes', ''),
            )
            session.add(neg)
            session.flush()
            logger.info(f"Created {category} negotiation (rev {neg.revision_number}) for claim {claim_id}")
            return neg

    def _create_negotiation_from_estimate(
        self, session, claim_id: str, estimate_data: Dict[str, Any]
    ):
        """Create or update ClaimNegotiation record(s) from insurance estimate data.

        Uses estimate_category to match existing records, so Reconstruction
        and WM estimates are independent and won't overwrite each other.
        """
        try:
            wm_cost_status = estimate_data.get('wm_cost_status')
            wm_file_id = estimate_data.get('wm_file_id')
            all_sections = estimate_data.get('sections_data') or []

            wm_est_amount = estimate_data.get('wm_estimate_amount') or 0
            has_separate_wm = (
                wm_cost_status == 'separate_estimate'
                and (wm_file_id or wm_est_amount)
            )

            if has_separate_wm:
                # Separate: main = reconstruction, WM = water mitigation
                self._upsert_negotiation(session, claim_id, 'reconstruction', {
                    'acv_amount': estimate_data.get('acv_amount', 0),
                    'rcv_amount': estimate_data.get('rcv_amount', 0),
                    'depreciation_amount': estimate_data.get('depreciation_amount', 0),
                    'deductible': estimate_data.get('deductible', 0),
                    'document_url': estimate_data.get('file_id', ''),
                    'document_name': estimate_data.get('file_name', ''),
                    'sections_data': all_sections if all_sections else None,
                    'notes': 'Reconstruction estimate',
                })

                # WM: use WM PDF (if any) and amount
                self._upsert_negotiation(session, claim_id, 'water_mitigation', {
                    'acv_amount': wm_est_amount,
                    'rcv_amount': wm_est_amount,
                    'depreciation_amount': 0,
                    'deductible': 0,
                    'document_url': wm_file_id or '',
                    'document_name': estimate_data.get('wm_file_name', ''),
                    'sections_data': None,
                    'notes': 'Water Mitigation estimate',
                })
            else:
                # Single combined estimate
                self._upsert_negotiation(session, claim_id, 'combined', {
                    'acv_amount': estimate_data.get('acv_amount', 0),
                    'rcv_amount': estimate_data.get('rcv_amount', 0),
                    'depreciation_amount': estimate_data.get('depreciation_amount', 0),
                    'deductible': estimate_data.get('deductible', 0),
                    'document_url': estimate_data.get('file_id', ''),
                    'document_name': estimate_data.get('file_name', ''),
                    'sections_data': all_sections if all_sections else None,
                    'notes': 'Insurance estimate',
                })
        except Exception as e:
            logger.error(f"Error creating/updating negotiation: {e}")

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
        """Mark a sent email as having received a reply.

        Also updates the linked FollowUpTask status to 'responded',
        creates an inbound CommunicationLog entry, and logs a ClaimActivity.
        """
        session = self._get_session()
        try:
            from app.domains.claim_followup.models import (
                CommunicationLog,
                FollowUpTask as FollowUpTaskModel,
                SentEmail,
            )

            email = session.query(SentEmail).filter(SentEmail.id == email_id).first()
            if not email:
                return None

            now = datetime.now(timezone.utc)
            email.reply_received = True
            email.reply_received_at = now
            if reply_summary:
                email.reply_summary = reply_summary

            # Update linked FollowUpTask status to 'responded'
            if email.followup_task_id:
                task = session.query(FollowUpTaskModel).filter(
                    FollowUpTaskModel.id == email.followup_task_id
                ).first()
                if task and task.status in ('pending', 'awaiting_response'):
                    task.status = 'responded'

            # Create inbound CommunicationLog entry
            to_addresses = email.to_addresses or []
            comm_log = CommunicationLog(
                followup_task_id=email.followup_task_id,
                claim_id=email.claim_id,
                communication_type='email',
                direction='inbound',
                contact_name=None,
                contact_email=to_addresses[0] if to_addresses else None,
                subject=f"Re: {email.subject}" if email.subject else "Reply received",
                summary=reply_summary or "Reply received to follow-up email.",
                response_received=True,
                response_date=now,
                response_summary=reply_summary,
                sent_email_id=email.id,
            )
            session.add(comm_log)

            # Log ClaimActivity
            try:
                from app.domains.client.models import ClaimActivity
                responder = to_addresses[0] if to_addresses else "recipient"
                session.add(ClaimActivity(
                    claim_id=email.claim_id,
                    activity_type='reply_received',
                    title=f'Reply received from {responder}',
                    description=reply_summary or f'Reply received for: {email.subject}',
                    related_entity_type='sent_email',
                    related_entity_id=email.id,
                ))
            except Exception as activity_err:
                logger.warning(f"Failed to log ClaimActivity for reply: {activity_err}")

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

            # Collect WM document attachments if requested (for follow-up emails)
            raw_attachments = list(data.get('attachments', []))
            wm_job_id = data.get('wm_job_id')
            wm_documents = data.get('wm_documents')
            if wm_job_id and wm_documents:
                try:
                    from app.domains.water_mitigation.adjuster_email_service import AdjusterEmailService
                    from app.domains.water_mitigation.models import WaterMitigationJob

                    wm_service = AdjusterEmailService(self.database)
                    job = session.query(WaterMitigationJob).filter(
                        WaterMitigationJob.id == str(wm_job_id)
                    ).first()
                    if job:
                        wm_attachments, _failed = wm_service._collect_attachments(
                            session, job, wm_documents
                        )
                        raw_attachments.extend(wm_attachments)
                        logger.info(
                            f"Attached {len(wm_attachments)} WM documents "
                            f"from job {wm_job_id} for follow-up email"
                        )
                except Exception as e:
                    logger.error(f"Error collecting WM attachments: {e}")

            # Separate binary attachment data from metadata for DB storage
            # Store only JSON-safe metadata in the DB (strip binary 'data' field)
            attachments_metadata = [
                {k: v for k, v in att.items() if k != 'data'}
                for att in raw_attachments
            ]

            claim_id = data.get('claim_id')
            manual_from = bool(data.get('from_address')) and not data.get('email_account_id')

            # If no claim is linked, send via SMTP directly (no DB record)
            if claim_id is None:
                smtp = SmtpService()
                smtp_result = smtp.send(
                    account_id=data.get('email_account_id'),
                    from_address=from_address,
                    to_addresses=data['to_addresses'],
                    cc_addresses=data.get('cc_addresses', []),
                    bcc_addresses=data.get('bcc_addresses', []),
                    subject=data['subject'],
                    body_html=data['body_html'],
                    attachments=raw_attachments,
                    skip_signature=manual_from,
                )
                session.commit()
                return {'id': None, 'status': 'sent', 'smtp_message_id': smtp_result.get('message_id')}

            # Create sent email record
            email_data = {
                'claim_id': claim_id,
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
                'attachments': attachments_metadata,
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
                    bcc_addresses=data.get('bcc_addresses', []),
                    subject=data['subject'],
                    body_html=data['body_html'],
                    attachments=raw_attachments,
                    skip_signature=manual_from,
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

        # Enrich with follow-up task context if available
        task_id = data.get('followup_task_id')
        if task_id:
            task_context = self._get_task_context(task_id)
            claim_context.update(task_context)

        return generate_email_content(
            context_type=data['context_type'],
            claim_context=claim_context,
            tone=data.get('tone', 'professional'),
            language=data.get('language', 'en'),
            additional_context=data.get('additional_context'),
            followup_task_id=task_id,
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

    def _get_task_context(self, task_id: str) -> Dict[str, Any]:
        """Gather follow-up task context for AI email generation"""
        session = self._get_readonly_session()
        try:
            from app.domains.claim_followup.models import FollowUpTask

            task = session.query(FollowUpTask).filter(
                FollowUpTask.id == task_id
            ).first()
            if not task:
                return {}

            context: Dict[str, Any] = {
                'task_type': task.task_type,
                'contact_count': task.contact_count or 0,
                'assigned_to_name': task.assigned_to_name or '',
            }

            # Calculate days since last contact and since creation
            now = datetime.now(timezone.utc)
            if task.last_contacted_at:
                delta = now - task.last_contacted_at
                context['days_since_last_contact'] = delta.days
            if task.created_at:
                delta = now - task.created_at
                context['days_since_created'] = delta.days

            # Get WM job context if linked
            if task.wm_job_id:
                from app.domains.water_mitigation.models import WaterMitigationJob
                wm_job = session.query(WaterMitigationJob).filter(
                    WaterMitigationJob.id == str(task.wm_job_id)
                ).first()
                if wm_job:
                    context['wm_property_address'] = wm_job.property_address or ''
                    context['wm_homeowner_name'] = wm_job.homeowner_name or ''
                    if wm_job.documents_sent_date:
                        context['documents_sent_date'] = wm_job.documents_sent_date.strftime('%m/%d/%Y')
                        days_since_sent = (now - wm_job.documents_sent_date).days
                        context['days_since_docs_sent'] = days_since_sent

            # Determine follow-up stage for WM tasks
            contact_count = context.get('contact_count', 0)
            if task.task_type == 'wm_docs_sent':
                if contact_count == 0:
                    context['followup_stage'] = 'first'
                elif contact_count == 1:
                    context['followup_stage'] = 'second'
                elif contact_count == 2:
                    context['followup_stage'] = 'third'
                else:
                    context['followup_stage'] = 'escalated'

            return context
        finally:
            session.close()
