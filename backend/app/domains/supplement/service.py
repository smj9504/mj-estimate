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
            # Auto-advance status from 'identified' to 'in_progress' when bid item is added
            self._auto_advance_status(session, str(data['supplement_id']))
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
        """Recalculate supplement_amount from bid items.

        Logic:
        - Xactimate item: use its amount minus any "In Xact" items
          (those items' amounts are already inside the Xactimate total)
        - Separate items (not in xact): add their amounts directly
        - "In Xact" items: excluded (already counted inside Xactimate)
        """
        from sqlalchemy import or_
        from app.domains.supplement.models import BidItemEstimate, SupplementRequest

        items = (
            session.query(BidItemEstimate)
            .filter(BidItemEstimate.supplement_id == supplement_id)
            .all()
        )

        xact_amount = 0.0
        in_xact_total = 0.0
        separate_total = 0.0

        for item in items:
            amt = float(item.custom_amount or 0)
            if item.estimate_type == 'xactimate':
                xact_amount = amt
            elif item.included_in_xactimate:
                in_xact_total += amt
            else:
                separate_total += amt

        # Xactimate net = original xact minus items already inside it
        xact_net = max(xact_amount - in_xact_total, 0)

        # Total = Xactimate net + separate items + in-xact items (counted once)
        # in-xact items are included as standalone since they were subtracted from xact
        total = xact_net + in_xact_total + separate_total

        supplement = session.query(SupplementRequest).filter(
            SupplementRequest.id == supplement_id
        ).first()
        if supplement:
            supplement.supplement_amount = total
            supplement.difference = total - float(supplement.original_amount or 0)

    # ============================================================
    # PA Info & Send to PA
    # ============================================================

    def get_pa_info(self, supplement_id: str) -> Dict[str, Any]:
        """Get PA info for a supplement's claim + CC candidates from same PA company."""
        session = self._get_readonly_session()
        try:
            from app.domains.client.models import Claim, Client
            from app.domains.supplement.models import SupplementRequest

            sup = session.query(SupplementRequest).filter(
                SupplementRequest.id == supplement_id
            ).first()
            if not sup:
                return {}

            claim = session.query(Claim).filter(Claim.id == sup.claim_id).first()
            if not claim:
                return {}

            client = session.query(Client).filter(
                Client.id == claim.client_id
            ).first()

            result = {
                "pa_name": claim.pa_name or "",
                "pa_email": claim.pa_email or "",
                "pa_phone": claim.pa_phone or "",
                "pa_company": claim.pa_company or "",
                "has_public_adjuster": bool(claim.has_public_adjuster),
                "claim_number": claim.claim_number or "",
                "insurance_company": claim.insurance_company or "",
                "property_address": client.address if client else "",
                "homeowner_name": client.display_name if client else "",
                "cc_emails": [],
            }

            # Find other PAs from the same company for CC
            if claim.pa_company and claim.pa_email:
                other_pas = (
                    session.query(Claim.pa_name, Claim.pa_email)
                    .filter(
                        Claim.pa_company == claim.pa_company,
                        Claim.pa_email.isnot(None),
                        Claim.pa_email != "",
                        Claim.pa_email != claim.pa_email,
                    )
                    .distinct()
                    .all()
                )
                seen = set()
                for pa_name, pa_email in other_pas:
                    if pa_email and pa_email not in seen:
                        seen.add(pa_email)
                        result["cc_emails"].append({
                            "name": pa_name or "",
                            "email": pa_email,
                        })

            return result
        finally:
            session.close()

    def send_to_pa(self, supplement_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
        """Send supplement bid items to PA via email with PDF attachments."""
        session = self._get_session()
        try:
            from app.domains.supplement.models import SupplementRequest, BidItemEstimate
            from app.domains.client.models import Claim, Client, ClaimActivity

            sup = session.query(SupplementRequest).filter(
                SupplementRequest.id == supplement_id
            ).first()
            if not sup:
                raise ValueError("Supplement not found")

            claim = session.query(Claim).filter(Claim.id == sup.claim_id).first()
            client = session.query(Client).filter(
                Client.id == claim.client_id
            ).first() if claim else None

            # Gather bid items with PDFs
            bid_items = (
                session.query(BidItemEstimate)
                .filter(BidItemEstimate.supplement_id == supplement_id)
                .all()
            )

            # Build attachment list from bid item PDFs
            attachments = []
            for item in bid_items:
                if item.custom_document_file_id:
                    attachments.append({
                        "filename": item.custom_document_file_name or f"{item.title}.pdf",
                        "file_id": item.custom_document_file_id,
                        "mime_type": "application/pdf",
                    })

            to_addresses = data.get("to_addresses", [])
            cc_addresses = data.get("cc_addresses", [])
            subject = data.get("subject", "")
            body_html = data.get("body_html", "")
            email_account_id = data.get("email_account_id")

            if not to_addresses:
                raise ValueError("No recipient email address provided")

            # Send via claim_followup email service
            from app.domains.claim_followup.service import ClaimFollowUpService
            email_service = ClaimFollowUpService()
            email_result = email_service.send_email({
                "claim_id": str(sup.claim_id),
                "email_account_id": email_account_id,
                "to_addresses": to_addresses,
                "cc_addresses": cc_addresses,
                "subject": subject,
                "body_html": body_html,
                "attachments": attachments,
            })

            # Update supplement status & submission info
            now = __import__("datetime").datetime.now(
                __import__("datetime").timezone.utc
            )
            sup.submitted_to = data.get("pa_name", to_addresses[0])
            sup.submitted_to_email = to_addresses[0]
            sup.submitted_date = now
            if sup.status in ("identified", "in_progress"):
                sup.status = "submitted"
                self._update_claim_supplement_status(
                    session, str(sup.claim_id), "submitted"
                )

            # Mark bid items as sent
            for item in bid_items:
                if item.status == "draft":
                    item.status = "sent"
                    item.sent_to_pa_date = now

            # Auto-create SupplementFollowUp record
            from app.domains.supplement.models import SupplementFollowUp
            followup = SupplementFollowUp(
                supplement_id=sup.id,
                contact_method="email",
                contact_name=data.get("pa_name", to_addresses[0]),
                contact_email=to_addresses[0],
                summary=(
                    f"Supplement estimate sent to PA with "
                    f"{len(attachments)} PDF attachment(s). "
                    f"Total: ${float(sup.supplement_amount or 0):,.2f}"
                ),
                response_received=False,
            )
            session.add(followup)

            # Log activity
            address = client.address if client else ""
            session.add(ClaimActivity(
                claim_id=sup.claim_id,
                activity_type="supplement_sent",
                title=f"Supplement sent to PA ({to_addresses[0]})",
                description=(
                    f"Supplement for {address} sent with "
                    f"{len(attachments)} PDF attachment(s). "
                    f"Total: ${float(sup.supplement_amount or 0):,.2f}"
                ),
                related_entity_type="supplement",
                related_entity_id=sup.id,
            ))

            session.commit()
            return {
                "success": True,
                "email_id": str(email_result.get("id", "")),
                "attachments_count": len(attachments),
                "status": sup.status,
            }
        except Exception as e:
            session.rollback()
            logger.error(f"Error sending supplement to PA: {e}")
            raise
        finally:
            session.close()

    def generate_pa_email_content(
        self, supplement_id: str, custom_notes: str = ""
    ) -> Dict[str, str]:
        """Generate preset email content for sending supplement to PA."""
        session = self._get_readonly_session()
        try:
            from app.domains.supplement.models import SupplementRequest, BidItemEstimate
            from app.domains.client.models import Claim, Client

            sup = session.query(SupplementRequest).filter(
                SupplementRequest.id == supplement_id
            ).first()
            if not sup:
                return {"subject": "", "body_html": ""}

            claim = session.query(Claim).filter(
                Claim.id == sup.claim_id
            ).first()
            client = session.query(Client).filter(
                Client.id == claim.client_id
            ).first() if claim else None

            bid_items = (
                session.query(BidItemEstimate)
                .filter(BidItemEstimate.supplement_id == supplement_id)
                .order_by(BidItemEstimate.created_at)
                .all()
            )

            address = client.address if client else "N/A"
            claim_number = claim.claim_number if claim else "N/A"
            insurance = claim.insurance_company if claim else "N/A"
            pa_name = claim.pa_name if claim else ""
            original = float(sup.original_amount or 0)
            supplement = float(sup.supplement_amount or 0)
            diff = float(sup.difference or 0)

            # Build bid item table rows
            bid_rows = ""
            for item in bid_items:
                amt = float(item.custom_amount or 0)
                has_pdf = "Yes" if item.custom_document_file_id else "No"
                in_xact = " (in Xactimate)" if item.included_in_xactimate else ""
                bid_rows += (
                    f"<tr>"
                    f"<td style='padding:6px 10px;border:1px solid #ddd;'>"
                    f"{item.estimate_type.title()}{in_xact}</td>"
                    f"<td style='padding:6px 10px;border:1px solid #ddd;'>"
                    f"{item.title}</td>"
                    f"<td style='padding:6px 10px;border:1px solid #ddd;"
                    f"text-align:right;'>${amt:,.2f}</td>"
                    f"<td style='padding:6px 10px;border:1px solid #ddd;"
                    f"text-align:center;'>{has_pdf}</td>"
                    f"</tr>"
                )

            subject = (
                f"Supplement Estimate - {address} - "
                f"Claim #{claim_number} ({insurance})"
            )

            custom_section = ""
            if custom_notes:
                custom_section = (
                    f"<h3 style='margin:20px 0 8px;'>Additional Notes</h3>"
                    f"<p>{custom_notes}</p>"
                )

            body_html = f"""
<p>Dear {pa_name or 'Public Adjuster'},</p>

<p>Please find attached the supplement estimate documents for the following claim:</p>

<table style="border-collapse:collapse;margin:16px 0;width:100%;max-width:500px;">
  <tr>
    <td style="padding:6px 10px;background:#f5f5f5;font-weight:bold;border:1px solid #ddd;">Property</td>
    <td style="padding:6px 10px;border:1px solid #ddd;">{address}</td>
  </tr>
  <tr>
    <td style="padding:6px 10px;background:#f5f5f5;font-weight:bold;border:1px solid #ddd;">Claim #</td>
    <td style="padding:6px 10px;border:1px solid #ddd;">{claim_number}</td>
  </tr>
  <tr>
    <td style="padding:6px 10px;background:#f5f5f5;font-weight:bold;border:1px solid #ddd;">Insurance</td>
    <td style="padding:6px 10px;border:1px solid #ddd;">{insurance}</td>
  </tr>
  <tr>
    <td style="padding:6px 10px;background:#f5f5f5;font-weight:bold;border:1px solid #ddd;">Insurance Estimate</td>
    <td style="padding:6px 10px;border:1px solid #ddd;">${original:,.2f}</td>
  </tr>
  <tr>
    <td style="padding:6px 10px;background:#f5f5f5;font-weight:bold;border:1px solid #ddd;">Our Estimate</td>
    <td style="padding:6px 10px;border:1px solid #ddd;font-weight:bold;">${supplement:,.2f}</td>
  </tr>
  <tr>
    <td style="padding:6px 10px;background:#f5f5f5;font-weight:bold;border:1px solid #ddd;">Difference</td>
    <td style="padding:6px 10px;border:1px solid #ddd;color:{'#cf1322' if diff < 0 else '#389e0d'};">${diff:,.2f}</td>
  </tr>
</table>

<h3 style="margin:20px 0 8px;">Bid Item Estimates</h3>
<table style="border-collapse:collapse;margin:8px 0;width:100%;">
  <thead>
    <tr style="background:#f5f5f5;">
      <th style="padding:6px 10px;border:1px solid #ddd;text-align:left;">Type</th>
      <th style="padding:6px 10px;border:1px solid #ddd;text-align:left;">Description</th>
      <th style="padding:6px 10px;border:1px solid #ddd;text-align:right;">Amount</th>
      <th style="padding:6px 10px;border:1px solid #ddd;text-align:center;">PDF</th>
    </tr>
  </thead>
  <tbody>
    {bid_rows}
  </tbody>
</table>

{custom_section}

<p>Please review the attached documents and let us know if you have any questions or need additional information.</p>

<p>Thank you.</p>
<p>Best regards</p>
"""
            return {"subject": subject, "body_html": body_html.strip()}
        finally:
            session.close()

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

    def _auto_advance_status(self, session, supplement_id: str):
        """Auto-advance supplement from 'identified' to 'in_progress' when bid items are added."""
        from app.domains.supplement.models import SupplementRequest
        supplement = session.query(SupplementRequest).filter(
            SupplementRequest.id == supplement_id
        ).first()
        if supplement and supplement.status == 'identified':
            supplement.status = 'in_progress'
            self._update_claim_supplement_status(session, str(supplement.claim_id), 'in_progress')

    def _update_claim_supplement_status(self, session, claim_id: str, status: str):
        from app.domains.client.models import Claim
        claim = session.query(Claim).filter(Claim.id == claim_id).first()
        if claim:
            claim.supplement_status = status
