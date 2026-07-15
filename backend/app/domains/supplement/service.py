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

            # Auto-populate PA info from claim's pa_contact_id if not provided
            if not data.get('submitted_to') and data.get('claim_id'):
                try:
                    from app.domains.client.models import Claim
                    from app.domains.company.models import CompanyContact
                    claim = session.query(Claim).filter(
                        Claim.id == data['claim_id']
                    ).first()
                    if claim and claim.pa_contact_id:
                        contact = session.query(CompanyContact).filter(
                            CompanyContact.id == claim.pa_contact_id
                        ).first()
                        if contact:
                            data['submitted_to'] = contact.name
                            if not data.get('submitted_to_email') and contact.email:
                                data['submitted_to_email'] = contact.email
                except Exception:
                    pass

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

            # Auto-set submitted_date when manually changing status to 'submitted'
            if data.get('status') == 'submitted':
                existing_rec = repo.get_by_id(request_id)
                if existing_rec and not existing_rec.get('submitted_date'):
                    from datetime import datetime, timezone
                    data['submitted_date'] = datetime.now(timezone.utc)

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

    def _generate_linked_estimate_pdf(self, session, item) -> Optional[Dict[str, Any]]:
        """Generate a PDF on-the-fly for a bid item linked to an existing estimate.

        Returns an attachment dict with raw bytes (data mode) or None if not applicable.
        """
        try:
            if item.bathroom_estimate_id:
                from app.domains.bathroom_estimate.service import BathroomEstimateService
                from app.domains.bathroom_estimate.export_service import BathroomExportService
                svc = BathroomEstimateService(session)
                estimate = svc.get_estimate(str(item.bathroom_estimate_id))
                if estimate:
                    pdf_buf = BathroomExportService().generate_pdf(
                        estimate, show_signature=False
                    )
                    return {
                        "filename": f"Bathroom_Estimate_{str(item.bathroom_estimate_id)[:8]}.pdf",
                        "data": pdf_buf.getvalue(),
                        "mime_type": "application/pdf",
                    }

            elif item.cabinet_estimate_id:
                from app.domains.cabinet_estimate.service import CabinetEstimateService
                from app.domains.cabinet_estimate.export_service import CabinetExportService
                svc = CabinetEstimateService(session)
                estimate = svc.get_estimate(str(item.cabinet_estimate_id))
                if estimate:
                    pdf_buf = CabinetExportService().generate_pdf(
                        estimate, show_signature=False
                    )
                    return {
                        "filename": f"Cabinet_Estimate_{str(item.cabinet_estimate_id)[:8]}.pdf",
                        "data": pdf_buf.getvalue(),
                        "mime_type": "application/pdf",
                    }

            elif item.roofing_estimate_id:
                from app.domains.roofing_estimate.service import RoofingEstimateService
                from app.domains.roofing_estimate.export_service import RoofingExportService
                svc = RoofingEstimateService(session)
                estimate = svc.get_estimate(str(item.roofing_estimate_id))
                if estimate:
                    pdf_buf = RoofingExportService().generate_pdf(
                        estimate, show_signature=False
                    )
                    return {
                        "filename": f"Roofing_Estimate_{str(item.roofing_estimate_id)[:8]}.pdf",
                        "data": pdf_buf.getvalue(),
                        "mime_type": "application/pdf",
                    }

            elif item.pack_calculation_id:
                from app.domains.pack_calculation.models import PackCalculation
                from app.domains.pack_calculation.export import (
                    generate_estimate_pdf as generate_pack_pdf,
                    build_company_info,
                )
                calc = session.query(PackCalculation).filter(
                    PackCalculation.id == item.pack_calculation_id
                ).first()
                if calc:
                    estimate_data = {
                        "sections": calc.sections or {},
                        "section_details": calc.section_details or {},
                        "materials_summary": calc.materials_summary or {},
                        "material_details": calc.material_details or [],
                        "supplements": calc.supplements or [],
                        "subtotal": calc.subtotal or 0,
                        "op_amount": calc.op_amount or 0,
                        "contingency_amount": calc.contingency_amount or 0,
                        "supplements_total": calc.supplements_total or 0,
                        "grand_total": calc.grand_total or 0,
                        "include_op": calc.include_op,
                        "op_rate": calc.op_rate,
                        "include_contingency": calc.include_contingency,
                        "contingency_rate": calc.contingency_rate,
                        "crew_size": calc.crew_size,
                        "storage_months": calc.storage_months,
                        "staging_type": calc.staging_type,
                        "include_packback": calc.include_packback,
                        "storage_sf": calc.storage_sf or 0,
                        "total_hours": calc.total_hours or 0,
                        "room_summaries": calc.room_summaries or [],
                        "special_items": calc.special_items or [],
                        "custom_special_items": calc.custom_special_items or [],
                    }
                    client_name = calc.client.display_name if calc.client else None
                    company_info = build_company_info(calc.company) if calc.company else None
                    pdf_bytes = generate_pack_pdf(
                        estimate_data=estimate_data,
                        client_name=client_name,
                        property_address=calc.project_address,
                        company_info=company_info,
                    )
                    return {
                        "filename": f"Packing_Estimate_{str(item.pack_calculation_id)[:8]}.pdf",
                        "data": pdf_bytes if isinstance(pdf_bytes, bytes) else pdf_bytes.getvalue(),
                        "mime_type": "application/pdf",
                    }

        except Exception as e:
            logger.warning(
                f"Could not generate PDF for bid item {item.id} "
                f"(type={item.estimate_type}): {e}"
            )
        return None

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

    def get_claim_pa_info(self, claim_id: str) -> Dict[str, Any]:
        """Get PA info directly from a claim (for supplement create form pre-fill)."""
        session = self._get_readonly_session()
        try:
            from app.domains.client.models import Claim
            claim = session.query(Claim).filter(Claim.id == claim_id).first()
            if not claim:
                return {}
            pa_name = claim.pa_name or ""
            pa_email = claim.pa_email or ""
            pa_contact_id = getattr(claim, "pa_contact_id", None)
            if pa_contact_id:
                try:
                    from app.domains.company.models import CompanyContact, Company
                    contact = session.query(CompanyContact).filter(
                        CompanyContact.id == pa_contact_id
                    ).first()
                    if contact:
                        pa_name = contact.name or pa_name
                        pa_email = contact.email or pa_email
                except Exception:
                    pass
            return {
                "pa_name": pa_name,
                "pa_email": pa_email,
                "pa_contact_id": str(pa_contact_id) if pa_contact_id else None,
                "has_public_adjuster": bool(claim.has_public_adjuster),
            }
        finally:
            session.close()

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

            # Resolve PA info priority:
            # 1. claim.pa_contact_id → CompanyContact (most reliable, set by WM sheet mapping)
            # 2. claim freetext fields (pa_name, pa_email, etc.)
            # 3. water_mitigation_jobs adjuster fields (fallback when claim PA fields are empty)
            # 4. supplement.submitted_to / submitted_to_email (set at create time)
            pa_name = claim.pa_name or getattr(sup, "submitted_to", "") or ""
            pa_email = claim.pa_email or getattr(sup, "submitted_to_email", "") or ""
            pa_phone = claim.pa_phone or ""
            pa_company = claim.pa_company or ""
            pa_contact_id = getattr(claim, "pa_contact_id", None)
            pa_company_id = None  # Track for reliable CC lookup

            # Fallback: derive PA from WM sheet→PA mapping when claim PA fields are empty
            # WM job's google_sheet_name → WMSheetPAMapping → CompanyContact
            if not pa_name and not pa_email:
                try:
                    from app.domains.water_mitigation.models import WaterMitigationJob, WMSheetPAMapping
                    from app.domains.company.models import CompanyContact, Company
                    wm_job = session.query(WaterMitigationJob).filter(
                        WaterMitigationJob.claim_id == claim.id
                    ).first()
                    if wm_job and wm_job.google_sheet_name:
                        mapping = session.query(WMSheetPAMapping).filter(
                            WMSheetPAMapping.sheet_name == wm_job.google_sheet_name
                        ).first()
                        if mapping and mapping.pa_contact_id:
                            contact = session.query(CompanyContact).filter(
                                CompanyContact.id == mapping.pa_contact_id
                            ).first()
                            if contact:
                                pa_name = contact.name or ""
                                pa_email = contact.email or ""
                                pa_phone = contact.phone or ""
                                pa_contact_id = contact.id
                                comp = session.query(Company).filter(
                                    Company.id == contact.company_id
                                ).first()
                                if comp:
                                    pa_company = comp.name
                                    pa_company_id = str(comp.id)
                except Exception:
                    pass

            if pa_contact_id:
                try:
                    from app.domains.company.models import CompanyContact, Company
                    contact = session.query(CompanyContact).filter(
                        CompanyContact.id == pa_contact_id
                    ).first()
                    if contact:
                        pa_name = contact.name or pa_name
                        pa_email = contact.email or pa_email
                        pa_phone = contact.phone or pa_phone
                        comp = session.query(Company).filter(
                            Company.id == contact.company_id
                        ).first()
                        if comp:
                            pa_company = comp.name
                            pa_company_id = str(comp.id)
                except Exception:
                    pass

            result = {
                "pa_name": pa_name,
                "pa_email": pa_email,
                "pa_phone": pa_phone,
                "pa_company": pa_company,
                "pa_contact_id": str(pa_contact_id) if pa_contact_id else None,
                "has_public_adjuster": bool(claim.has_public_adjuster),
                "claim_number": claim.claim_number or "",
                "insurance_company": claim.insurance_company or "",
                "property_address": client.address if client else "",
                "homeowner_name": client.display_name if client else "",
                "cc_emails": [],
            }

            # Find other contacts from the same PA company for CC
            if pa_email:
                try:
                    from app.domains.company.models import CompanyContact, Company

                    if pa_company_id:
                        # Reliable: use company_id directly (set from pa_contact_id lookup)
                        other_contacts = (
                            session.query(CompanyContact)
                            .filter(
                                CompanyContact.company_id == pa_company_id,
                                CompanyContact.is_active == True,
                                CompanyContact.email.isnot(None),
                                CompanyContact.email != "",
                                CompanyContact.email != pa_email,
                            )
                            .all()
                        )
                        seen = set()
                        for c in other_contacts:
                            if c.email and c.email not in seen:
                                seen.add(c.email)
                                result["cc_emails"].append({
                                    "name": c.name or "",
                                    "email": c.email,
                                })
                    elif pa_company:
                        # Fallback: look up company by name
                        same_company = (
                            session.query(Company)
                            .filter(Company.name == pa_company, Company.is_active == True)
                            .first()
                        )
                        if same_company:
                            other_contacts = (
                                session.query(CompanyContact)
                                .filter(
                                    CompanyContact.company_id == same_company.id,
                                    CompanyContact.is_active == True,
                                    CompanyContact.email.isnot(None),
                                    CompanyContact.email != "",
                                    CompanyContact.email != pa_email,
                                )
                                .all()
                            )
                            seen = set()
                            for c in other_contacts:
                                if c.email and c.email not in seen:
                                    seen.add(c.email)
                                    result["cc_emails"].append({
                                        "name": c.name or "",
                                        "email": c.email,
                                    })
                        else:
                            # Last resort: search other claims with same pa_company
                            other_pas = (
                                session.query(Claim.pa_name, Claim.pa_email)
                                .filter(
                                    Claim.pa_company == pa_company,
                                    Claim.pa_email.isnot(None),
                                    Claim.pa_email != "",
                                    Claim.pa_email != pa_email,
                                )
                                .distinct()
                                .all()
                            )
                            seen = set()
                            for other_name, other_email in other_pas:
                                if other_email and other_email not in seen:
                                    seen.add(other_email)
                                    result["cc_emails"].append({
                                        "name": other_name or "",
                                        "email": other_email,
                                    })
                except Exception:
                    pass

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
                else:
                    # Generate PDF on-the-fly for linked estimates
                    pdf_attachment = self._generate_linked_estimate_pdf(
                        session, item
                    )
                    if pdf_attachment:
                        attachments.append(pdf_attachment)

            # Add manually uploaded extra files
            extra_file_ids = data.get("extra_file_ids") or []
            if extra_file_ids:
                from app.domains.file.models import File as FileModel
                for file_id in extra_file_ids:
                    file_rec = session.query(FileModel).filter(FileModel.id == file_id).first()
                    if file_rec:
                        attachments.append({
                            "filename": file_rec.original_name or file_rec.filename,
                            "file_id": file_id,
                            "mime_type": file_rec.content_type or "application/octet-stream",
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
            send_payload = {
                "claim_id": str(sup.claim_id),
                "email_account_id": email_account_id,
                "to_addresses": to_addresses,
                "cc_addresses": cc_addresses,
                "subject": subject,
                "body_html": body_html,
                "attachments": attachments,
            }
            if data.get("from_address"):
                send_payload["from_address"] = data["from_address"]
            email_result = email_service.send_email(send_payload)

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

            # Resolve PA name: claim.pa_contact_id → contact > claim.pa_name > supplement.submitted_to
            pa_name = (claim.pa_name if claim else "") or getattr(sup, "submitted_to", "") or ""
            if claim:
                pa_contact_id = getattr(claim, "pa_contact_id", None)
                if pa_contact_id and not pa_name:
                    try:
                        from app.domains.company.models import CompanyContact
                        contact = session.query(CompanyContact).filter(
                            CompanyContact.id == pa_contact_id
                        ).first()
                        if contact and contact.name:
                            pa_name = contact.name
                    except Exception:
                        pass
            original = float(sup.original_amount or 0)
            supplement = float(sup.supplement_amount or 0)
            diff = float(sup.difference or 0)

            # Build bid item table rows
            bid_rows = ""
            for item in bid_items:
                amt = float(item.custom_amount or 0)
                has_pdf = "&#10003;" if (
                    item.custom_document_file_id
                    or item.bathroom_estimate_id
                    or item.cabinet_estimate_id
                    or item.roofing_estimate_id
                    or item.pack_calculation_id
                ) else "&#8212;"
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

            # Build scope changes section — card layout per bid item
            _type_colors = {
                'xactimate': '#1890ff', 'bathroom': '#52c41a', 'cabinet': '#fa8c16',
                'packing': '#722ed1', 'roofing': '#eb2f96', 'kitchen': '#13c2c2',
                'flooring': '#faad14', 'other': '#8c8c8c',
            }
            scope_cards = ""
            for item in bid_items:
                amt = float(item.custom_amount or 0)
                border_color = _type_colors.get(item.estimate_type, '#8c8c8c')
                type_label = item.estimate_type.title()
                in_xact_badge = (
                    " <span style='font-size:11px;color:#888;font-weight:normal;'>"
                    "(included in Xactimate)</span>"
                    if item.included_in_xactimate else ""
                )
                desc_html = ""
                if item.description and item.description.strip():
                    lines = [
                        l.strip()
                        for l in item.description.replace('\r\n', '\n').split('\n')
                        if l.strip()
                    ]
                    if len(lines) > 1:
                        li_items = "".join(
                            f"<li style='margin-bottom:4px;'>{l}</li>" for l in lines
                        )
                        desc_html = (
                            f"<ul style='margin:8px 0 0;padding-left:18px;"
                            f"color:#444;font-size:13px;line-height:1.6;'>{li_items}</ul>"
                        )
                    else:
                        desc_html = (
                            f"<p style='margin:8px 0 0;color:#444;"
                            f"font-size:13px;line-height:1.6;'>{lines[0]}</p>"
                        )
                scope_cards += (
                    f"<div style='margin-bottom:10px;padding:12px 16px;"
                    f"background:#fafafa;border-left:4px solid {border_color};"
                    f"border-radius:0 4px 4px 0;'>"
                    f"<table width='100%' cellpadding='0' cellspacing='0'"
                    f" style='border-collapse:collapse;'>"
                    f"<tr>"
                    f"<td style='font-weight:bold;font-size:13px;color:#1a1a1a;padding:0;'>"
                    f"{item.title}{in_xact_badge}</td>"
                    f"<td width='1' style='text-align:right;font-weight:bold;"
                    f"font-size:13px;color:#1a1a1a;white-space:nowrap;padding:0 0 0 12px;'>"
                    f"${amt:,.2f}</td>"
                    f"</tr>"
                    f"<tr>"
                    f"<td colspan='2' style='font-size:11px;color:#888;padding:2px 0 0;'>"
                    f"{type_label} Estimate</td>"
                    f"</tr>"
                    f"</table>"
                    f"{desc_html}"
                    f"</div>"
                )
            scope_notes_section = ""
            if scope_cards:
                scope_notes_section = (
                    f"<h3 style='margin:20px 0 12px;color:#1a1a1a;font-size:15px;'>"
                    f"Scope Changes / Additions</h3>"
                    f"{scope_cards}"
                )

            custom_section = ""
            if custom_notes:
                custom_section = (
                    f"<h3 style='margin:20px 0 8px;'>Additional Notes</h3>"
                    f"<p>{custom_notes}</p>"
                )

            # Use first name only for greeting
            pa_first_name = (pa_name or '').strip().split()[0] if (pa_name or '').strip() else ''

            body_html = f"""
<p>{pa_first_name + ',' if pa_first_name else 'Hello,'}</p>

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

{scope_notes_section}

{custom_section}

<p>Please review the attached documents and let me know if you have any questions or need additional information.</p>

<p>Thank you.</p>
<p>Best regards</p>
"""
            return {"subject": subject, "body_html": body_html.strip()}
        finally:
            session.close()

    def _enrich_with_claim_info(self, session, item: Dict[str, Any]):
        """Add claim info to supplement request including assigned companies"""
        try:
            from app.domains.client.models import Claim, Client
            from app.domains.contract.models import ClaimCompany
            from app.domains.company.models import Company

            claim = session.query(Claim).filter(Claim.id == item.get('claim_id')).first()
            if claim:
                item['claim_number'] = claim.claim_number
                item['insurance_company'] = claim.insurance_company
                client = session.query(Client).filter(Client.id == claim.client_id).first()
                if client:
                    item['property_address'] = client.address

                # Get assigned companies by role
                claim_companies = (
                    session.query(ClaimCompany, Company)
                    .join(Company, ClaimCompany.company_id == Company.id)
                    .filter(ClaimCompany.claim_id == claim.id)
                    .all()
                )
                for cc, comp in claim_companies:
                    if cc.role == 'water_mitigation':
                        item['wm_company_id'] = str(comp.id)
                        item['wm_company_name'] = comp.name
                    elif cc.role == 'reconstruction':
                        item['rebuild_company_id'] = str(comp.id)
                        item['rebuild_company_name'] = comp.name

                # Fallback: get WM company from water_mitigation_jobs if not in claim_companies
                if not item.get('wm_company_id'):
                    try:
                        from app.domains.water_mitigation.models import WaterMitigationJob
                        wm_job = (
                            session.query(WaterMitigationJob)
                            .filter(WaterMitigationJob.claim_id == claim.id)
                            .first()
                        )
                        if wm_job and wm_job.company_id:
                            wm_comp = session.query(Company).filter(Company.id == wm_job.company_id).first()
                            if wm_comp:
                                item['wm_company_id'] = str(wm_comp.id)
                                item['wm_company_name'] = wm_comp.name
                    except Exception:
                        pass
        except Exception:
            pass

    def send_info_request(self, supplement_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
        """Send an info request email and create a followup record."""
        session = self._get_session()
        try:
            from app.domains.supplement.models import SupplementRequest, SupplementFollowUp
            from app.domains.client.models import Claim, Client

            sup = session.query(SupplementRequest).filter(
                SupplementRequest.id == supplement_id
            ).first()
            if not sup:
                raise ValueError("Supplement not found")

            claim = session.query(Claim).filter(Claim.id == sup.claim_id).first()
            client = session.query(Client).filter(
                Client.id == claim.client_id
            ).first() if claim else None

            to_email = data.get("to_email", "")
            to_name = data.get("to_name", "")
            request_to_type = data.get("request_to_type", "public_adjuster")
            items_needed = data.get("items_needed", [])
            email_account_id = data.get("email_account_id")

            if not to_email:
                raise ValueError("Recipient email is required")

            address = client.address if client else ""
            claim_number = claim.claim_number if claim else ""

            # Build email content
            subject = data.get("subject") or (
                f"Information Request - {address} (Claim #{claim_number})"
            )

            if data.get("body_html"):
                body_html = data["body_html"]
            else:
                items_html = "".join(
                    f"<li>{item.get('description', '')}</li>"
                    for item in items_needed
                )
                role_label = "Public Adjuster" if request_to_type == "public_adjuster" else "Contractor"
                body_html = (
                    f"<p>Hi {to_name or role_label},</p>"
                    f"<p>We are working on the supplement estimate for <strong>{address}</strong> "
                    f"(Claim #{claim_number}) and need the following information to proceed:</p>"
                    f"<ul>{items_html}</ul>"
                    f"<p>Could you please provide this information at your earliest convenience?</p>"
                    f"<p>Thank you,<br/>SimpleWorks Team</p>"
                )

            # Send email
            from app.domains.claim_followup.service import ClaimFollowUpService
            email_service = ClaimFollowUpService()
            email_result = email_service.send_email({
                "claim_id": str(sup.claim_id),
                "email_account_id": email_account_id,
                "to_addresses": [to_email],
                "subject": subject,
                "body_html": body_html,
                "attachments": [],
            })

            now = __import__("datetime").datetime.now(
                __import__("datetime").timezone.utc
            )

            # Create followup record (linked to sent email for auto reply detection)
            now_iso = __import__("datetime").datetime.now(
                __import__("datetime").timezone.utc
            ).isoformat()
            followup = SupplementFollowUp(
                supplement_id=sup.id,
                followup_type="info_request",
                contact_method="email",
                contact_name=to_name,
                contact_email=to_email,
                summary=f"Info request sent: {', '.join(i.get('description', '') for i in items_needed[:3])}",
                items_needed=[{**item, 'resolved': False} for item in items_needed],
                request_to_type=request_to_type,
                info_status="sent",
                response_received=False,
                follow_up_count=0,
                sent_email_id=email_result.get("id"),
                conversation=[{
                    "type": "sent",
                    "date": now_iso,
                    "sender": email_result.get("from_address", ""),
                    "body_html": body_html,
                    "summary": f"Info request: {', '.join(i.get('description', '') for i in items_needed[:3])}",
                }],
            )
            session.add(followup)
            session.commit()

            return {
                "success": True,
                "followup_id": str(followup.id),
                "email_id": str(email_result.get("id", "")),
            }
        except Exception as e:
            session.rollback()
            logger.error(f"Error sending info request: {e}")
            raise
        finally:
            session.close()

    def resend_info_request(
        self, supplement_id: str, followup_id: str, data: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Resend/follow-up on an existing info request."""
        session = self._get_session()
        try:
            from app.domains.supplement.models import SupplementRequest, SupplementFollowUp
            from app.domains.client.models import Claim, Client

            followup = session.query(SupplementFollowUp).filter(
                SupplementFollowUp.id == followup_id,
                SupplementFollowUp.supplement_id == supplement_id,
            ).first()
            if not followup:
                raise ValueError("Info request not found")

            sup = session.query(SupplementRequest).filter(
                SupplementRequest.id == supplement_id
            ).first()
            claim = session.query(Claim).filter(Claim.id == sup.claim_id).first() if sup else None
            client = session.query(Client).filter(
                Client.id == claim.client_id
            ).first() if claim else None

            to_email = followup.contact_email
            to_name = followup.contact_name or ""
            if not to_email:
                raise ValueError("No email address on original request")

            address = client.address if client else ""
            claim_number = claim.claim_number if claim else ""
            follow_up_num = (followup.follow_up_count or 0) + 1

            # Unresolved items only
            unresolved = [
                item for item in (followup.items_needed or [])
                if not item.get('resolved', False)
            ]
            items_html = "".join(
                f"<li>{item.get('description', '')}</li>"
                for item in unresolved
            )

            additional_msg = data.get("additional_message", "")
            additional_html = f"<p>{additional_msg}</p>" if additional_msg else ""

            subject = f"Follow-up #{follow_up_num}: Information Request - {address} (Claim #{claim_number})"
            body_html = (
                f"<p>Hi {to_name},</p>"
                f"<p>This is a follow-up regarding our information request for "
                f"<strong>{address}</strong> (Claim #{claim_number}).</p>"
                f"<p>We are still waiting for the following information:</p>"
                f"<ul>{items_html}</ul>"
                f"{additional_html}"
                f"<p>Please let me know if you need any clarification.</p>"
                f"<p>Thank you,<br/>SimpleWorks Team</p>"
            )

            # Send email
            from app.domains.claim_followup.service import ClaimFollowUpService
            email_service = ClaimFollowUpService()
            email_result = email_service.send_email({
                "claim_id": str(sup.claim_id) if sup else "",
                "email_account_id": data.get("email_account_id"),
                "to_addresses": [to_email],
                "subject": subject,
                "body_html": body_html,
                "attachments": [],
            })

            now = __import__("datetime").datetime.now(
                __import__("datetime").timezone.utc
            )
            followup.follow_up_count = follow_up_num
            followup.last_follow_up_date = now
            followup.info_status = "awaiting_response"
            # Update sent_email_id to track latest email for reply detection
            followup.sent_email_id = email_result.get("id")
            # Append to conversation thread
            conv = list(followup.conversation or [])
            conv.append({
                "type": "sent",
                "date": now.isoformat(),
                "sender": email_result.get("from_address", ""),
                "body_html": body_html,
                "summary": f"Follow-up #{follow_up_num}",
            })
            followup.conversation = conv
            session.commit()

            return {
                "success": True,
                "followup_id": str(followup.id),
                "follow_up_count": follow_up_num,
                "email_id": str(email_result.get("id", "")),
            }
        except Exception as e:
            session.rollback()
            logger.error(f"Error resending info request: {e}")
            raise
        finally:
            session.close()

    def assign_rebuild_company(self, claim_id: str, company_id: str) -> Dict[str, Any]:
        """Assign or update the reconstruction company for a claim via ClaimCompany.
        Also auto-assigns the matching RebuildContractor to any rebuild projects for this claim.
        """
        session = self._get_session()
        try:
            from app.domains.contract.models import ClaimCompany
            from app.domains.company.models import Company
            from app.domains.rebuild.models import RebuildContractor, RebuildProject

            # Verify company exists
            company = session.query(Company).filter(Company.id == company_id).first()
            if not company:
                raise ValueError("Company not found")

            # Find existing reconstruction assignment
            existing = (
                session.query(ClaimCompany)
                .filter(
                    ClaimCompany.claim_id == claim_id,
                    ClaimCompany.role == 'reconstruction',
                )
                .first()
            )

            if existing:
                existing.company_id = company_id
            else:
                cc = ClaimCompany(
                    claim_id=claim_id,
                    company_id=company_id,
                    role='reconstruction',
                    is_primary=True,
                )
                session.add(cc)

            # Auto-assign contractor to rebuild projects for this claim
            contractor = (
                session.query(RebuildContractor)
                .filter(RebuildContractor.company_id == company_id, RebuildContractor.is_active == True)
                .first()
            )
            if not contractor:
                # Create RebuildContractor from Company
                contractor = RebuildContractor(
                    company_id=company_id,
                    company_name=company.name,
                    contact_name=None,
                    phone=company.phone,
                    email=company.email,
                    address=company.address,
                    is_active=True,
                )
                session.add(contractor)
                session.flush()

            # Update all rebuild projects for this claim
            projects = (
                session.query(RebuildProject)
                .filter(RebuildProject.claim_id == claim_id)
                .all()
            )
            for proj in projects:
                proj.contractor_id = contractor.id
                if proj.status == 'pending':
                    proj.status = 'assigned'

            session.commit()
            return {"company_id": str(company.id), "company_name": company.name}
        except Exception as e:
            session.rollback()
            logger.error(f"Error assigning rebuild company: {e}")
            raise
        finally:
            session.close()

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
