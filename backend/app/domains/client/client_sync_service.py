"""
ClientSyncService - Auto-creates/updates Client and Claim from WM Job data.

Called after WM Job creation or update (from Google Sheets sync or manual API).
Handles duplicate prevention via multi-level matching.

Flow:
  WM Job (homeowner_name, property_address, insurance, claim_number, etc.)
    → Match or create Client
    → Match or create Claim (if claim_number present)
    → Link WM Job to Claim (via claim_id)
"""

import logging
from datetime import datetime
from typing import Any, Dict, Optional, Tuple

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.domains.client.models import Client, Claim
from app.domains.water_mitigation.models import WaterMitigationJob

logger = logging.getLogger(__name__)


class ClientSyncService:
    """
    Synchronizes Client/Claim records from WM Job data.
    Designed to be called after any WM Job create/update operation.
    """

    def __init__(self, db: Session):
        self.db = db

    def sync_from_wm_job(self, job: WaterMitigationJob) -> Dict[str, Any]:
        """
        Main entry point: sync Client and Claim from a WM Job.

        Returns dict with sync results:
          {
            'client_id': ...,
            'claim_id': ...,
            'client_action': 'created' | 'updated' | 'matched' | 'skipped',
            'claim_action': 'created' | 'updated' | 'matched' | 'skipped',
          }
        """
        result = {
            'client_id': None,
            'claim_id': None,
            'client_action': 'skipped',
            'claim_action': 'skipped',
        }

        homeowner_name = (job.homeowner_name or '').strip()
        if not homeowner_name:
            logger.debug(f"WM Job {job.id}: no homeowner_name, skipping client sync")
            return result

        try:
            # Step 1: Match or create Client
            client, client_action = self._sync_client(job)
            result['client_id'] = str(client.id)
            result['client_action'] = client_action

            # Step 2: Match or create Claim (if claim_number present)
            claim_number = (job.claim_number or '').strip()
            if claim_number:
                claim, claim_action = self._sync_claim(job, client)
                result['claim_id'] = str(claim.id)
                result['claim_action'] = claim_action

                # Link WM Job to Claim if not already linked
                if str(job.claim_id) != str(claim.id) if job.claim_id else True:
                    job.claim_id = claim.id
                    self.db.flush()

            self.db.commit()
            logger.info(
                f"WM Job {job.id} → Client {result['client_action']} ({result['client_id']}), "
                f"Claim {result['claim_action']} ({result['claim_id']})"
            )

        except Exception as e:
            self.db.rollback()
            logger.error(f"Client sync failed for WM Job {job.id}: {e}")
            raise

        return result

    # ================================================================
    # Client matching & sync
    # ================================================================

    def _sync_client(self, job: WaterMitigationJob) -> Tuple[Client, str]:
        """Match or create a Client from WM Job data. Returns (client, action)."""

        # Priority 1: WM Job already linked to a Claim that has a Client
        if job.claim_id:
            claim = self.db.query(Claim).filter(Claim.id == job.claim_id).first()
            if claim and claim.client_id:
                client = self.db.query(Client).filter(Client.id == claim.client_id).first()
                if client:
                    self._update_client_from_job(client, job)
                    return client, 'updated'

        # Priority 2: Match by homeowner_name + property_address
        client = self._match_by_name_and_address(job)
        if client:
            self._update_client_from_job(client, job)
            return client, 'updated'

        # Priority 3: Match by phone (if available)
        phone = (job.homeowner_phone or '').strip()
        if phone:
            client = self._match_by_phone(phone)
            if client:
                self._update_client_from_job(client, job)
                return client, 'matched'

        # Priority 4: Match by email (if available)
        email = (job.homeowner_email or '').strip()
        if email:
            client = self._match_by_email(email)
            if client:
                self._update_client_from_job(client, job)
                return client, 'matched'

        # No match → create new Client
        client = self._create_client_from_job(job)
        return client, 'created'

    def _match_by_name_and_address(self, job: WaterMitigationJob) -> Optional[Client]:
        """Match client by normalized homeowner_name + property_address."""
        name = (job.homeowner_name or '').strip().lower()
        address = (job.property_address or '').strip().lower()

        if not name:
            return None

        # Exact name match (case-insensitive)
        candidates = self.db.query(Client).filter(
            func.lower(Client.display_name) == name,
            Client.is_active == True,
        ).all()

        if not candidates:
            # Try partial match (first + last name in display_name)
            candidates = self.db.query(Client).filter(
                func.lower(Client.display_name).contains(name),
                Client.is_active == True,
            ).all()

        if not candidates:
            return None

        # If address available, prefer address match
        if address:
            for c in candidates:
                c_addr = (c.address or '').strip().lower()
                if c_addr and (c_addr in address or address in c_addr):
                    return c
                # Also check city match as fallback
                c_city = (c.city or '').strip().lower()
                job_city = (job.property_city or '').strip().lower()
                if c_city and job_city and c_city == job_city:
                    return c

        # No address match, but name matched → return first candidate
        # (only if there's exactly one, to avoid ambiguity)
        if len(candidates) == 1:
            return candidates[0]

        return None

    def _match_by_phone(self, phone: str) -> Optional[Client]:
        """Match by phone number (normalized)."""
        normalized = self._normalize_phone(phone)
        if not normalized or len(normalized) < 7:
            return None

        # Search in Client.phone and in owners JSON
        clients = self.db.query(Client).filter(
            Client.is_active == True
        ).all()

        for c in clients:
            if c.phone and self._normalize_phone(c.phone) == normalized:
                return c
            # Check owners
            if c.owners:
                owners = c.owners if isinstance(c.owners, list) else []
                for owner in owners:
                    if isinstance(owner, dict):
                        owner_phone = owner.get('phone', '')
                        if owner_phone and self._normalize_phone(owner_phone) == normalized:
                            return c
        return None

    def _match_by_email(self, email: str) -> Optional[Client]:
        """Match by email (case-insensitive)."""
        email_lower = email.lower().strip()
        if not email_lower:
            return None

        client = self.db.query(Client).filter(
            func.lower(Client.email) == email_lower,
            Client.is_active == True,
        ).first()

        return client

    def _normalize_phone(self, phone: str) -> str:
        """Strip non-digit characters for comparison."""
        return ''.join(c for c in phone if c.isdigit())

    # ================================================================
    # Client create / update
    # ================================================================

    def _create_client_from_job(self, job: WaterMitigationJob) -> Client:
        """Create a new Client from WM Job homeowner data."""
        homeowner_name = (job.homeowner_name or '').strip()

        client = Client(
            display_name=homeowner_name,
            owners=[{
                'name': homeowner_name,
                'phone': (job.homeowner_phone or '').strip() or None,
                'email': (job.homeowner_email or '').strip() or None,
                'is_primary': True,
            }],
            address=job.property_street or job.property_address,
            city=job.property_city,
            state=job.property_state,
            zipcode=job.property_zipcode,
            phone=(job.homeowner_phone or '').strip() or None,
            email=(job.homeowner_email or '').strip() or None,
            insurance_company=(job.insurance_company or '').strip() or None,
            insurance_policy_number=(job.insurance_policy_number or '').strip() or None,
            company_id=job.company_id,
            is_active=True,
        )
        self.db.add(client)
        self.db.flush()  # Get the ID

        logger.info(f"Created Client '{homeowner_name}' (id={client.id}) from WM Job {job.id}")
        return client

    def _update_client_from_job(self, client: Client, job: WaterMitigationJob) -> None:
        """Update existing Client with latest WM Job data (non-destructive)."""
        # Update address if Client has no address or job has newer data
        job_street = job.property_street or job.property_address
        if job_street and not client.address:
            client.address = job_street
        if job.property_city and not client.city:
            client.city = job.property_city
        if job.property_state and not client.state:
            client.state = job.property_state
        if job.property_zipcode and not client.zipcode:
            client.zipcode = job.property_zipcode

        # Update contact if missing
        phone = (job.homeowner_phone or '').strip()
        if phone and not client.phone:
            client.phone = phone

        email = (job.homeowner_email or '').strip()
        if email and not client.email:
            client.email = email

        # Update insurance defaults if missing
        ins_company = (job.insurance_company or '').strip()
        if ins_company and not client.insurance_company:
            client.insurance_company = ins_company

        ins_policy = (job.insurance_policy_number or '').strip()
        if ins_policy and not client.insurance_policy_number:
            client.insurance_policy_number = ins_policy

        # Update company_id if missing
        if job.company_id and not client.company_id:
            client.company_id = job.company_id

        self.db.flush()

    # ================================================================
    # Claim matching & sync
    # ================================================================

    def _sync_claim(self, job: WaterMitigationJob, client: Client) -> Tuple[Claim, str]:
        """Match or create Claim from WM Job data."""
        claim_number = (job.claim_number or '').strip()

        # Priority 1: WM Job already linked to a Claim - reuse it whenever the
        # job's claim_number still agrees, OR the linked Claim already has real
        # follow-up history (a claim_number mismatch there is almost always a
        # typo/correction in the Sheet, not a genuinely new incident - and
        # silently re-pointing the job would orphan all of that history behind
        # a second, empty Claim). Only a claim with NO history is allowed to
        # fall through to Priority 2, where a mismatch may legitimately mean a
        # second incident/claim for the same property.
        if job.claim_id:
            claim = self.db.query(Claim).filter(Claim.id == job.claim_id).first()
            if claim:
                number_matches = (
                    not claim_number
                    or claim_number.lower() == (claim.claim_number or '').strip().lower()
                )
                if number_matches:
                    self._update_claim_from_job(claim, job)
                    return claim, 'updated'
                if self._claim_has_history(claim):
                    logger.warning(
                        f"WM Job {job.id}: Sheet claim_number '{claim_number}' differs from "
                        f"linked Claim {claim.id}'s '{claim.claim_number}', but that Claim has "
                        f"existing follow-up history - keeping the link and updating the number "
                        f"instead of creating a new Claim."
                    )
                    claim.claim_number = claim_number
                    self._update_claim_from_job(claim, job)
                    return claim, 'updated'

        # Priority 2: Match by claim_number within this client's claims
        if claim_number:
            claim = self.db.query(Claim).filter(
                Claim.client_id == client.id,
                func.lower(Claim.claim_number) == claim_number.lower(),
            ).first()
            if claim:
                self._update_claim_from_job(claim, job)
                return claim, 'matched'

            # Also search globally (claim might exist under different client - edge case)
            claim = self.db.query(Claim).filter(
                func.lower(Claim.claim_number) == claim_number.lower(),
            ).first()
            if claim:
                # If found under different client, still match (claim_number is unique per insurance)
                self._update_claim_from_job(claim, job)
                return claim, 'matched'

        # No match → create new Claim
        claim = self._create_claim_from_job(job, client)
        return claim, 'created'

    def _claim_has_history(self, claim: Claim) -> bool:
        """
        Check whether a Claim has any real follow-up activity (tasks or
        logged activity), as opposed to being an empty shell. Used to decide
        whether a claim_number mismatch is safe to treat as a new incident.
        """
        # Import locally to avoid a circular import between client and
        # claim_followup domains.
        from app.domains.claim_followup.models import FollowUpTask
        from app.domains.client.models import ClaimActivity

        has_task = self.db.query(FollowUpTask.id).filter(
            FollowUpTask.claim_id == claim.id
        ).first()
        if has_task:
            return True

        has_activity = self.db.query(ClaimActivity.id).filter(
            ClaimActivity.claim_id == claim.id
        ).first()
        return has_activity is not None

    def _create_claim_from_job(self, job: WaterMitigationJob, client: Client) -> Claim:
        """Create a new Claim from WM Job data."""
        claim = Claim(
            client_id=client.id,
            company_id=job.company_id,
            claim_number=(job.claim_number or '').strip(),
            insurance_company=(job.insurance_company or '').strip() or None,
            insurance_policy_number=(job.insurance_policy_number or '').strip() or None,
            adjuster_name=(job.adjuster_name or '').strip() or None,
            adjuster_phone=(job.adjuster_phone or '').strip() or None,
            adjuster_email=(job.adjuster_email or '').strip() or None,
            date_of_loss=job.date_of_loss,
            status='open',
        )
        self.db.add(claim)
        self.db.flush()

        logger.info(
            f"Created Claim '{claim.claim_number}' (id={claim.id}) "
            f"for Client {client.id} from WM Job {job.id}"
        )
        return claim

    def _update_claim_from_job(self, claim: Claim, job: WaterMitigationJob) -> None:
        """Update existing Claim with latest WM Job data (non-destructive)."""
        # Update insurance info if missing
        ins_company = (job.insurance_company or '').strip()
        if ins_company and not claim.insurance_company:
            claim.insurance_company = ins_company

        ins_policy = (job.insurance_policy_number or '').strip()
        if ins_policy and not claim.insurance_policy_number:
            claim.insurance_policy_number = ins_policy

        # Update adjuster if missing
        adj_name = (job.adjuster_name or '').strip()
        if adj_name and not claim.adjuster_name:
            claim.adjuster_name = adj_name

        adj_phone = (job.adjuster_phone or '').strip()
        if adj_phone and not claim.adjuster_phone:
            claim.adjuster_phone = adj_phone

        adj_email = (job.adjuster_email or '').strip()
        if adj_email and not claim.adjuster_email:
            claim.adjuster_email = adj_email

        # Update date_of_loss if missing
        if job.date_of_loss and not claim.date_of_loss:
            claim.date_of_loss = job.date_of_loss

        # Update company if missing
        if job.company_id and not claim.company_id:
            claim.company_id = job.company_id

        self.db.flush()


def sync_client_from_wm_job(db: Session, job: WaterMitigationJob) -> Dict[str, Any]:
    """
    Convenience function - creates ClientSyncService and runs sync.
    Safe to call - catches errors and logs them without propagating.
    """
    try:
        service = ClientSyncService(db)
        return service.sync_from_wm_job(job)
    except Exception as e:
        logger.error(f"Client sync failed for WM Job {job.id}: {e}", exc_info=True)
        return {
            'client_id': None,
            'claim_id': None,
            'client_action': 'error',
            'claim_action': 'error',
            'error': str(e),
        }
