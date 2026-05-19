"""
Supplement domain service.
"""

import logging
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy.sql import func

logger = logging.getLogger(__name__)


class SupplementService:
    def __init__(self, database=None):
        from app.core.database_factory import get_database
        self.database = database or get_database()

    def _get_session(self):
        return self.database.get_session()

    def _get_readonly_session(self):
        return self.database.get_readonly_session()

    # ============================================================
    # Supplement Requests
    # ============================================================

    def create_request(self, data: Dict[str, Any]) -> Dict[str, Any]:
        session = self._get_session()
        try:
            from app.domains.supplement.repository import get_supplement_request_repository
            repo = get_supplement_request_repository(session)

            # Auto-calculate difference
            orig = float(data.get('original_amount', 0))
            supp = float(data.get('supplement_amount', 0))
            data['difference'] = supp - orig

            result = repo.create(data)

            # Update claim's needs_supplement flag
            self._update_claim_supplement_flag(session, str(data['claim_id']), True)

            session.commit()
            return result
        except Exception as e:
            session.rollback()
            logger.error(f"Error creating supplement request: {e}")
            raise
        finally:
            session.close()

    def update_request(self, request_id: str, data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        session = self._get_session()
        try:
            from app.domains.supplement.repository import get_supplement_request_repository
            repo = get_supplement_request_repository(session)

            # Recalculate difference if amounts changed
            if 'original_amount' in data or 'supplement_amount' in data:
                existing = repo.get_by_id(request_id)
                if existing:
                    orig = float(data.get('original_amount', existing.get('original_amount', 0)))
                    supp = float(data.get('supplement_amount', existing.get('supplement_amount', 0)))
                    data['difference'] = supp - orig

            result = repo.update(request_id, data)

            # Update claim supplement status if status changed
            if result and 'status' in data:
                self._update_claim_supplement_status(session, str(result['claim_id']), data['status'])

            session.commit()
            return result
        except Exception as e:
            session.rollback()
            raise
        finally:
            session.close()

    def get_request(self, request_id: str) -> Optional[Dict[str, Any]]:
        session = self._get_readonly_session()
        try:
            from app.domains.supplement.repository import (
                get_supplement_request_repository,
                get_bid_item_estimate_repository,
                get_supplement_followup_repository,
            )
            repo = get_supplement_request_repository(session)
            result = repo.get_by_id(request_id)
            if result:
                bid_repo = get_bid_item_estimate_repository(session)
                result['bid_items'] = bid_repo.get_by_supplement(request_id)
                result['bid_item_count'] = len(result['bid_items'])

                followup_repo = get_supplement_followup_repository(session)
                followups = followup_repo.get_by_supplement(request_id)
                result['followup_count'] = len(followups)

                # Enrich with claim info
                self._enrich_with_claim_info(session, result)
            return result
        finally:
            session.close()

    def get_requests(self, params: Dict[str, Any]) -> Tuple[List[Dict[str, Any]], int]:
        session = self._get_readonly_session()
        try:
            from app.domains.supplement.repository import get_supplement_request_repository
            repo = get_supplement_request_repository(session)
            items, total = repo.get_with_filters(**params)

            # Enrich each with claim info
            for item in items:
                self._enrich_with_claim_info(session, item)
                # Add bid item count
                from app.domains.supplement.repository import get_bid_item_estimate_repository
                bid_repo = get_bid_item_estimate_repository(session)
                item['bid_item_count'] = len(bid_repo.get_by_supplement(str(item['id'])))

            return items, total
        finally:
            session.close()

    def get_by_claim(self, claim_id: str) -> List[Dict[str, Any]]:
        session = self._get_readonly_session()
        try:
            from app.domains.supplement.repository import get_supplement_request_repository
            repo = get_supplement_request_repository(session)
            return repo.get_by_claim(claim_id)
        finally:
            session.close()

    def delete_request(self, request_id: str) -> bool:
        session = self._get_session()
        try:
            from app.domains.supplement.repository import get_supplement_request_repository
            repo = get_supplement_request_repository(session)
            existing = repo.get_by_id(request_id)
            result = repo.delete(request_id)
            if result and existing:
                # Check if claim still has other supplements
                remaining = repo.get_by_claim(str(existing['claim_id']))
                if not remaining:
                    self._update_claim_supplement_flag(session, str(existing['claim_id']), False)
            session.commit()
            return result
        except Exception as e:
            session.rollback()
            raise
        finally:
            session.close()

    def get_dashboard_stats(self) -> Dict[str, Any]:
        session = self._get_readonly_session()
        try:
            from app.domains.supplement.repository import get_supplement_request_repository
            repo = get_supplement_request_repository(session)
            return repo.get_dashboard_stats()
        finally:
            session.close()

    # ============================================================
    # Bid Item Estimates
    # ============================================================

    def create_bid_item(self, data: Dict[str, Any]) -> Dict[str, Any]:
        session = self._get_session()
        try:
            from app.domains.supplement.repository import get_bid_item_estimate_repository
            repo = get_bid_item_estimate_repository(session)
            result = repo.create(data)
            self._recalculate_supplement_amount(session, str(data['supplement_id']))
            session.commit()
            return result
        except Exception as e:
            session.rollback()
            raise
        finally:
            session.close()

    def update_bid_item(self, item_id: str, data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        session = self._get_session()
        try:
            from app.domains.supplement.repository import get_bid_item_estimate_repository
            repo = get_bid_item_estimate_repository(session)
            result = repo.update(item_id, data)
            if result:
                self._recalculate_supplement_amount(session, str(result['supplement_id']))
            session.commit()
            return result
        except Exception as e:
            session.rollback()
            raise
        finally:
            session.close()

    def delete_bid_item(self, item_id: str) -> bool:
        session = self._get_session()
        try:
            from app.domains.supplement.repository import get_bid_item_estimate_repository
            repo = get_bid_item_estimate_repository(session)
            existing = repo.get_by_id(item_id)
            result = repo.delete(item_id)
            if result and existing:
                self._recalculate_supplement_amount(session, str(existing['supplement_id']))
            session.commit()
            return result
        except Exception as e:
            session.rollback()
            raise
        finally:
            session.close()

    def get_bid_items_by_supplement(self, supplement_id: str) -> List[Dict[str, Any]]:
        session = self._get_readonly_session()
        try:
            from app.domains.supplement.repository import get_bid_item_estimate_repository
            repo = get_bid_item_estimate_repository(session)
            return repo.get_by_supplement(supplement_id)
        finally:
            session.close()

    # ============================================================
    # Follow-ups
    # ============================================================

    def create_followup(self, data: Dict[str, Any]) -> Dict[str, Any]:
        session = self._get_session()
        try:
            from app.domains.supplement.repository import get_supplement_followup_repository
            repo = get_supplement_followup_repository(session)
            result = repo.create(data)
            session.commit()
            return result
        except Exception as e:
            session.rollback()
            raise
        finally:
            session.close()

    def update_followup(self, followup_id: str, data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        session = self._get_session()
        try:
            from app.domains.supplement.repository import get_supplement_followup_repository
            repo = get_supplement_followup_repository(session)
            result = repo.update(followup_id, data)
            session.commit()
            return result
        except Exception as e:
            session.rollback()
            raise
        finally:
            session.close()

    def get_followups(self, supplement_id: str) -> List[Dict[str, Any]]:
        session = self._get_readonly_session()
        try:
            from app.domains.supplement.repository import get_supplement_followup_repository
            repo = get_supplement_followup_repository(session)
            return repo.get_by_supplement(supplement_id)
        finally:
            session.close()

    # ============================================================
    # Helpers
    # ============================================================

    def _recalculate_supplement_amount(self, session, supplement_id: str):
        """Sum all bid item custom_amount values and update supplement_amount + difference."""
        from app.domains.supplement.models import BidItemEstimate, SupplementRequest
        total = session.query(
            func.coalesce(func.sum(BidItemEstimate.custom_amount), 0)
        ).filter(BidItemEstimate.supplement_id == supplement_id).scalar()
        total = float(total or 0)

        supplement = session.query(SupplementRequest).filter(
            SupplementRequest.id == supplement_id
        ).first()
        if supplement:
            supplement.supplement_amount = total
            supplement.difference = total - float(supplement.original_amount or 0)

    def _enrich_with_claim_info(self, session, item: Dict[str, Any]):
        """Add claim info to supplement request"""
        try:
            from app.domains.client.models import Claim, Client
            claim = session.query(Claim).filter(Claim.id == item.get('claim_id')).first()
            if claim:
                item['claim_number'] = claim.claim_number
                item['insurance_company'] = claim.insurance_company
                client = session.query(Client).filter(Client.id == claim.client_id).first()
                if client:
                    item['property_address'] = client.address
        except Exception:
            pass

    def _update_claim_supplement_flag(self, session, claim_id: str, needs_supplement: bool):
        from app.domains.client.models import Claim
        claim = session.query(Claim).filter(Claim.id == claim_id).first()
        if claim:
            claim.needs_supplement = needs_supplement
            if needs_supplement and not claim.supplement_status:
                claim.supplement_status = 'identified'

    def _update_claim_supplement_status(self, session, claim_id: str, status: str):
        from app.domains.client.models import Claim
        claim = session.query(Claim).filter(Claim.id == claim_id).first()
        if claim:
            claim.supplement_status = status
