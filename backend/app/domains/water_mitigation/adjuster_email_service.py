"""
Water Mitigation Adjuster Email Service.
Handles document readiness checks, email generation, and sending to insurance adjusters.
"""

import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional
from uuid import UUID
from zoneinfo import ZoneInfo

from app.common.utils.storage_helpers import download_from_storage, is_cloud_ref
from app.core.database_factory import get_database

logger = logging.getLogger(__name__)


class AdjusterEmailService:
    """Service for sending water mitigation documents to insurance adjusters."""

    def __init__(self, database=None):
        self.database = database or get_database()

    def _get_session(self):
        return self.database.get_session()

    def _get_readonly_session(self):
        return self.database.get_readonly_session()

    # ================================================================
    # Document Readiness
    # ================================================================

    def get_document_readiness(self, job_id: str) -> Dict[str, Any]:
        """Check which of the 6 required documents are ready for sending."""
        session = self._get_readonly_session()
        try:
            from .models import WaterMitigationJob, WMDocument, WMScopeInvoice
            from .sketch_models import WMFloorSketch

            job = session.query(WaterMitigationJob).filter(
                WaterMitigationJob.id == job_id
            ).first()
            if not job:
                raise ValueError("Job not found")

            # 1. Photo Report - check WMDocument with document_type containing 'report'
            photo_report_doc = (
                session.query(WMDocument)
                .filter(
                    WMDocument.job_id == job_id,
                    WMDocument.is_active == True,
                    WMDocument.document_type.in_(['report', 'photo_report']),
                )
                .order_by(WMDocument.created_at.desc())
                .first()
            )

            # 2. Invoice - check WMScopeInvoice or uploaded WMDocument
            invoice_link = (
                session.query(WMScopeInvoice)
                .filter(WMScopeInvoice.job_id == job_id)
                .order_by(WMScopeInvoice.generated_at.desc())
                .first()
            )
            # Fallback: uploaded invoice document
            invoice_doc = None
            if not invoice_link:
                invoice_doc = (
                    session.query(WMDocument)
                    .filter(
                        WMDocument.job_id == job_id,
                        WMDocument.is_active == True,
                        WMDocument.document_type.in_(
                            ['Invoice', 'invoice']
                        ),
                    )
                    .order_by(WMDocument.created_at.desc())
                    .first()
                )
            invoice_ready = (
                invoice_link is not None or invoice_doc is not None
            )

            # 3. W9 - check company w9_file_id
            w9_ready = False
            if job.company_id:
                from app.domains.company.models import Company
                company = session.query(Company).filter(Company.id == job.company_id).first()
                w9_file_id = getattr(company, 'w9_file_id', None) if company else None
                logger.info(f"W9 readiness: company_id={job.company_id}, company={company.name if company else None}, w9_file_id={w9_file_id}")
                if company and w9_file_id:
                    # Verify the File record actually exists
                    from app.domains.file.models import File as FileModel
                    file_exists = session.query(FileModel).filter(
                        FileModel.id == str(w9_file_id)
                    ).first() is not None
                    w9_ready = file_exists
                    if not file_exists:
                        logger.warning(f"W9: file_id={w9_file_id} referenced but File record not found in DB")
            else:
                logger.warning(f"W9 readiness: job has no company_id")

            # 4. COS - check WMDocument
            cos_doc = (
                session.query(WMDocument)
                .filter(
                    WMDocument.job_id == job_id,
                    WMDocument.is_active == True,
                    WMDocument.document_type == 'COS',
                )
                .order_by(WMDocument.created_at.desc())
                .first()
            )

            # 5. EWA - check WMDocument
            ewa_doc = (
                session.query(WMDocument)
                .filter(
                    WMDocument.job_id == job_id,
                    WMDocument.is_active == True,
                    WMDocument.document_type == 'EWA',
                )
                .order_by(WMDocument.created_at.desc())
                .first()
            )

            # 6. Sketch - check WMFloorSketch existence, and whether the
            # last-generated sketch_report PDF is stale (floor sketch edited
            # after the PDF was last rendered)
            sketch_exists = (
                session.query(WMFloorSketch)
                .filter(WMFloorSketch.job_id == job_id)
                .first()
            ) is not None

            sketch_doc = (
                session.query(WMDocument)
                .filter(
                    WMDocument.job_id == job_id,
                    WMDocument.is_active == True,
                    WMDocument.document_type == 'sketch_report',
                )
                .order_by(WMDocument.created_at.desc())
                .first()
            )
            sketch_stale = False
            if sketch_doc:
                from .sketch_pdf_service import SketchPdfService
                sketch_last_modified = SketchPdfService(session).get_last_modified(job_id)
                doc_generated_at = sketch_doc.updated_at or sketch_doc.created_at
                if sketch_last_modified and doc_generated_at and sketch_last_modified > doc_generated_at:
                    sketch_stale = True

            def _doc_info(doc):
                if not doc:
                    return None
                return {
                    "id": str(doc.id),
                    "filename": doc.filename,
                    "created_at": doc.created_at.isoformat() if doc.created_at else None,
                }

            return {
                "photo_report": {
                    "ready": photo_report_doc is not None,
                    "document": _doc_info(photo_report_doc),
                },
                "invoice": {
                    "ready": invoice_ready,
                    "invoice_id": str(invoice_link.invoice_id) if invoice_link else None,
                    "document": _doc_info(invoice_doc) if invoice_doc else None,
                },
                "w9": {
                    "ready": w9_ready,
                },
                "cos": {
                    "ready": cos_doc is not None,
                    "document": _doc_info(cos_doc),
                },
                "ewa": {
                    "ready": ewa_doc is not None,
                    "document": _doc_info(ewa_doc),
                },
                "sketch": {
                    "ready": sketch_exists,
                    "stale": sketch_stale,
                    "document": _doc_info(sketch_doc),
                },
                "all_ready": all([
                    photo_report_doc is not None,
                    invoice_ready,
                    w9_ready,
                    cos_doc is not None,
                    ewa_doc is not None,
                    sketch_exists,
                ]),
            }
        finally:
            session.close()

    # ================================================================
    # Adjuster & PA Info
    # ================================================================

    def get_adjuster_info(self, job_id: str) -> Dict[str, Any]:
        """Get adjuster contact info and PA email for BCC."""
        session = self._get_readonly_session()
        try:
            from .models import WaterMitigationJob, WMSheetPAMapping
            from app.domains.company.models import CompanyContact

            job = session.query(WaterMitigationJob).filter(
                WaterMitigationJob.id == job_id
            ).first()
            if not job:
                raise ValueError("Job not found")

            # Adjuster info from job
            adjuster_info = {
                "name": job.adjuster_name or "",
                "email": job.adjuster_email or "",
                "phone": job.adjuster_phone or "",
            }

            # Fallback: if job has no adjuster info, try from linked Claim
            if job.claim_id and not adjuster_info["email"]:
                from app.domains.client.models import Claim as ClaimModel
                claim_for_adj = session.query(ClaimModel).filter(
                    ClaimModel.id == job.claim_id
                ).first()
                if claim_for_adj:
                    if not adjuster_info["email"]:
                        adjuster_info["email"] = getattr(
                            claim_for_adj, 'adjuster_email', ''
                        ) or ""
                    if not adjuster_info["name"]:
                        adjuster_info["name"] = getattr(
                            claim_for_adj, 'adjuster_name', ''
                        ) or ""
                    if not adjuster_info["phone"]:
                        adjuster_info["phone"] = getattr(
                            claim_for_adj, 'adjuster_phone', ''
                        ) or ""

            # PA info for BCC - resolve via sheet_name → WMSheetPAMapping → CompanyContact
            pa_info = {
                "name": "",
                "email": "",
                "company": "",
            }

            # Try claim-level PA info first
            if job.claim_id:
                from app.domains.client.models import Claim
                claim = session.query(Claim).filter(Claim.id == job.claim_id).first()
                if claim:
                    # Priority 1: pa_contact_id → CompanyContact
                    pa_contact_id = getattr(claim, 'pa_contact_id', None)
                    if pa_contact_id:
                        contact = session.query(CompanyContact).filter(
                            CompanyContact.id == pa_contact_id
                        ).first()
                        if contact:
                            pa_info["name"] = contact.name or ""
                            pa_info["email"] = contact.email or ""
                            if contact.company:
                                pa_info["company"] = contact.company.name or ""

                    # Priority 2: Claim freetext fields
                    if not pa_info["email"]:
                        pa_info["name"] = getattr(claim, 'pa_name', '') or ""
                        pa_info["email"] = getattr(claim, 'pa_email', '') or ""
                        pa_info["company"] = getattr(claim, 'pa_company', '') or ""

            # Priority 3: WM sheet name → PA mapping
            if not pa_info["email"] and job.google_sheet_name:
                mapping = session.query(WMSheetPAMapping).filter(
                    WMSheetPAMapping.sheet_name == job.google_sheet_name
                ).first()
                if mapping and mapping.pa_contact_id:
                    contact = session.query(CompanyContact).filter(
                        CompanyContact.id == mapping.pa_contact_id
                    ).first()
                    if contact:
                        pa_info["name"] = contact.name or ""
                        pa_info["email"] = contact.email or ""
                        if contact.company:
                            pa_info["company"] = contact.company.name or ""

            # Build preset_emails: all known email contacts
            # for pre-populating the To field
            preset_emails = []
            seen_emails = set()

            # 1. Primary adjuster email
            if adjuster_info["email"]:
                email_lower = adjuster_info["email"].lower()
                seen_emails.add(email_lower)
                preset_emails.append({
                    "name": adjuster_info["name"],
                    "email": adjuster_info["email"],
                    "role": "adjuster",
                })

            # 2. Additional emails from adjuster_emails JSON
            extra_emails = getattr(job, 'adjuster_emails', None)
            if extra_emails and isinstance(extra_emails, list):
                for entry in extra_emails:
                    em = (entry.get("email") or "").strip()
                    if em and em.lower() not in seen_emails:
                        seen_emails.add(em.lower())
                        preset_emails.append({
                            "name": entry.get("name", ""),
                            "email": em,
                            "role": entry.get(
                                "role", "adjuster"
                            ),
                        })

            # 3. Claim adjuster email (if different)
            if job.claim_id:
                from app.domains.client.models import (
                    Claim as ClaimModel,
                )
                claim_rec = session.query(ClaimModel).filter(
                    ClaimModel.id == job.claim_id
                ).first()
                if claim_rec:
                    ce = getattr(
                        claim_rec, 'adjuster_email', ''
                    ) or ""
                    if ce and ce.lower() not in seen_emails:
                        seen_emails.add(ce.lower())
                        cn = getattr(
                            claim_rec, 'adjuster_name', ''
                        ) or ""
                        preset_emails.append({
                            "name": cn,
                            "email": ce,
                            "role": "adjuster",
                        })

            # 4. Public adjuster (PA) email
            if pa_info["email"] and pa_info["email"].lower() not in seen_emails:
                seen_emails.add(pa_info["email"].lower())
                preset_emails.append({
                    "name": pa_info["name"] or pa_info["company"] or "Public Adjuster",
                    "email": pa_info["email"],
                    "role": "pa",
                })

            # Job context info
            job_info = {
                "property_address": job.property_address or "",
                "homeowner_name": job.homeowner_name or "",
                "claim_number": job.claim_number or "",
                "insurance_company": job.insurance_company or "",
                "date_of_loss": job.date_of_loss.isoformat() if job.date_of_loss else "",
                "documents_sent_date": job.documents_sent_date.isoformat() if job.documents_sent_date else None,
            }

            # Get email accounts for sender selection
            email_accounts = self._get_email_accounts(
                session, company_id=job.company_id
            )

            return {
                "adjuster": adjuster_info,
                "pa": pa_info,
                "job": job_info,
                "email_accounts": email_accounts,
                "preset_emails": preset_emails,
            }
        finally:
            session.close()

    def _get_email_accounts(self, session, company_id=None) -> List[Dict[str, str]]:
        """Get available email accounts for sending.
        Returns accounts matching company_id first, then others.
        """
        try:
            from app.domains.email_ingestion.models import EmailAccount
            accounts = session.query(EmailAccount).filter(
                EmailAccount.is_active == True
            ).all()

            result = []
            for a in accounts:
                result.append({
                    "id": str(a.id),
                    "email_address": a.email_address,
                    "display_name": getattr(a, 'display_name', '') or a.email_address,
                    "company_id": str(a.company_id) if a.company_id else None,
                })

            # Sort: matching company_id first
            if company_id:
                company_id_str = str(company_id)
                result.sort(key=lambda x: (0 if x.get("company_id") == company_id_str else 1))

            return result
        except Exception:
            return []

    # ================================================================
    # Email Generation
    # ================================================================

    def generate_adjuster_email(
        self, job_id: str, custom_notes: str = ""
    ) -> Dict[str, str]:
        """Generate email template for sending documents to adjuster."""
        session = self._get_readonly_session()
        try:
            from .models import WaterMitigationJob

            job = session.query(WaterMitigationJob).filter(
                WaterMitigationJob.id == job_id
            ).first()
            if not job:
                return {"subject": "", "body_html": ""}

            subject = job.claim_number or "N/A"

            # Determine greeting based on US Eastern time
            eastern_now = datetime.now(ZoneInfo("America/New_York"))
            greeting_time = "Good morning" if eastern_now.hour < 12 else "Good afternoon"

            # Adjuster first name for personalized greeting
            adjuster_name = (job.adjuster_name or "").strip()
            adjuster_first = adjuster_name.split()[0] if adjuster_name else ""

            # Property address for context
            address = job.property_address or ""

            # Get company name
            company_name = ""
            if job.company_id:
                from app.domains.company.models import Company
                company = session.query(Company).filter(Company.id == job.company_id).first()
                if company:
                    company_name = company.name or ""

            custom_section = ""
            if custom_notes:
                custom_section = (
                    f"<p style='color:#444;font-size:14px;line-height:1.6;'>{custom_notes}</p>"
                )

            # Personalized greeting reduces spam score significantly
            if adjuster_first:
                greeting = f"{greeting_time} {adjuster_first},"
            else:
                greeting = f"{greeting_time},"

            body_html = f"""
<p>{greeting} I hope this email finds you well.</p>

<p>Please find the attached documentation for the water mitigation work{f' at {address}' if address else ''}.</p>

{custom_section}

<p>I would appreciate a brief confirmation of receipt, and let me know if you have any questions.</p>

<p>Thank you.</p>
"""
            return {"subject": subject, "body_html": body_html.strip()}
        finally:
            session.close()

    # ================================================================
    # Follow-Up Email Generation
    # ================================================================

    def generate_followup_email(
        self, job_id: str, custom_notes: str = ""
    ) -> Dict[str, Any]:
        """Generate follow-up email template when adjuster hasn't responded."""
        session = self._get_readonly_session()
        try:
            from .models import WaterMitigationJob
            from app.domains.claim_followup.models import SentEmail

            job = session.query(WaterMitigationJob).filter(
                WaterMitigationJob.id == job_id
            ).first()
            if not job:
                return {"subject": "", "body_html": "", "followup_count": 0}

            subject = f"Follow Up - {job.claim_number or 'N/A'}"

            # Count previous follow-up emails for this job
            followup_count = 0
            if job.claim_id:
                followup_count = session.query(SentEmail).filter(
                    SentEmail.claim_id == job.claim_id,
                    SentEmail.subject.ilike(f"%follow%up%{job.claim_number}%"),
                ).count()

            # Calculate days since documents were sent
            days_since_sent = None
            sent_date_str = ""
            if job.documents_sent_date:
                delta = datetime.now(timezone.utc) - job.documents_sent_date.replace(
                    tzinfo=timezone.utc
                ) if job.documents_sent_date.tzinfo is None else (
                    datetime.now(timezone.utc) - job.documents_sent_date
                )
                days_since_sent = delta.days
                sent_date_str = job.documents_sent_date.strftime("%m/%d/%Y")

            # Determine greeting based on US Eastern time
            eastern_now = datetime.now(ZoneInfo("America/New_York"))
            greeting_time = "Good morning" if eastern_now.hour < 12 else "Good afternoon"

            # Adjuster first name
            adjuster_name = (job.adjuster_name or "").strip()
            adjuster_first = adjuster_name.split()[0] if adjuster_name else ""

            address = job.property_address or ""

            if adjuster_first:
                greeting = f"{greeting_time} {adjuster_first},"
            else:
                greeting = f"{greeting_time},"

            # Build context-aware follow-up body
            if days_since_sent is not None and sent_date_str:
                sent_context = (
                    f"I am following up on the water mitigation documentation "
                    f"that was submitted on {sent_date_str}"
                    f"{f' for the property at {address}' if address else ''}."
                )
            else:
                sent_context = (
                    f"I am following up on the water mitigation documentation "
                    f"previously submitted"
                    f"{f' for the property at {address}' if address else ''}."
                )

            custom_section = ""
            if custom_notes:
                custom_section = (
                    f"<p style='color:#444;font-size:14px;line-height:1.6;'>{custom_notes}</p>"
                )

            body_html = f"""
<p>{greeting} I hope this message finds you well.</p>

<p>{sent_context}</p>

<p>I wanted to check in to see if you had a chance to review the documents and if there is anything else you may need from our end.</p>

{custom_section}

<p>Please let me know if you have any questions or need any additional information. I look forward to hearing from you.</p>

<p>Thank you.</p>
"""
            return {
                "subject": subject,
                "body_html": body_html.strip(),
                "followup_count": followup_count,
                "days_since_sent": days_since_sent,
                "documents_sent_date": sent_date_str,
            }
        finally:
            session.close()

    # ================================================================
    # Send Email
    # ================================================================

    def send_to_adjuster(self, job_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
        """Send water mitigation documents to insurance adjuster via email."""
        session = self._get_session()
        try:
            from .models import (
                WaterMitigationJob, WMDocument, WMScopeInvoice,
                WMJobStatusHistory,
            )
            from .sketch_models import WMFloorSketch
            from app.domains.client.models import ClaimActivity

            job = session.query(WaterMitigationJob).filter(
                WaterMitigationJob.id == job_id
            ).first()
            if not job:
                raise ValueError("Job not found")

            to_addresses = data.get("to_addresses", [])
            cc_addresses = data.get("cc_addresses", [])
            bcc_addresses = data.get("bcc_addresses", [])
            subject = data.get("subject", "")
            body_html = data.get("body_html", "")
            email_account_id = data.get("email_account_id")
            selected_docs = data.get("selected_documents", [
                "photo_report", "invoice", "w9", "cos", "ewa", "sketch"
            ])

            if not to_addresses:
                raise ValueError("No recipient email address provided")

            # Collect attachments based on selected documents
            attachments, failed_docs = self._collect_attachments(session, job, selected_docs)

            # Compress PDF attachments if total size exceeds email limit (25MB)
            attachments = self._compress_attachments_if_needed(attachments)

            # Block send if any selected document failed to attach
            if failed_docs:
                doc_labels = {
                    "photo_report": "Photo Report",
                    "invoice": "Invoice",
                    "w9": "W-9",
                    "cos": "COS",
                    "ewa": "EWA",
                    "sketch": "Sketch",
                }
                failed_names = [doc_labels.get(d, d) for d in failed_docs]
                raise ValueError(
                    f"Failed to generate attachment(s): {', '.join(failed_names)}. "
                    f"Email was NOT sent. Please check the documents and try again."
                )

            # Block send if the payload is still too big for SMTP to accept
            self._assert_within_email_limit(attachments)

            # Send via claim_followup email service
            from app.domains.claim_followup.service import ClaimFollowUpService
            email_service = ClaimFollowUpService()

            # Build claim_id for the email record (may be None)
            claim_id = str(job.claim_id) if job.claim_id else None

            send_payload = {
                "claim_id": claim_id,
                "email_account_id": email_account_id,
                "to_addresses": to_addresses,
                "cc_addresses": cc_addresses,
                "bcc_addresses": bcc_addresses,
                "subject": subject,
                "body_html": body_html,
                "attachments": attachments,
            }
            if data.get("from_address"):
                send_payload["from_address"] = data["from_address"]
            email_result = email_service.send_email(send_payload)

            # Update job: documents_sent_date
            now = datetime.now(timezone.utc)
            job.documents_sent_date = now

            # Auto-advance status to "Sent to adjuster" if applicable
            previous_status = job.status
            if job.status in ('Lead', 'Doc prepping'):
                job.status = 'Sent to adjuster'

                # Record status history
                history = WMJobStatusHistory(
                    job_id=job.id,
                    previous_status=previous_status,
                    new_status='Sent to adjuster',
                    notes="Auto-updated: documents sent to adjuster via email",
                )
                session.add(history)

            # Log claim activity
            if job.claim_id:
                activity = ClaimActivity(
                    claim_id=job.claim_id,
                    activity_type='wm_sent_to_adjuster',
                    title=f"WM Docs sent to adjuster ({to_addresses[0]})",
                    description=(
                        f"Water mitigation documents sent to adjuster for "
                        f"{job.property_address}. "
                        f"{len(attachments)} document(s) attached."
                    ),
                    related_entity_type='wm_job',
                    related_entity_id=str(job.id),
                )
                session.add(activity)

            # Auto-create follow-up task
            self._create_followup_task(session, job)

            session.commit()

            return {
                "success": True,
                "email_id": str(email_result.get("id", "")),
                "attachments_count": len(attachments),
                "status": job.status,
                "documents_sent_date": now.isoformat(),
            }
        except Exception as e:
            session.rollback()
            logger.error(f"Error sending to adjuster: {e}")
            raise
        finally:
            session.close()

    # ================================================================
    # Send Follow-Up Email
    # ================================================================

    def send_followup(self, job_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
        """Send follow-up email to adjuster (does NOT update documents_sent_date)."""
        session = self._get_session()
        try:
            from .models import WaterMitigationJob
            from app.domains.client.models import ClaimActivity

            job = session.query(WaterMitigationJob).filter(
                WaterMitigationJob.id == job_id
            ).first()
            if not job:
                raise ValueError("Job not found")

            to_addresses = data.get("to_addresses", [])
            cc_addresses = data.get("cc_addresses", [])
            bcc_addresses = data.get("bcc_addresses", [])
            subject = data.get("subject", "")
            body_html = data.get("body_html", "")
            email_account_id = data.get("email_account_id")
            selected_docs = data.get("selected_documents", [])

            if not to_addresses:
                raise ValueError("No recipient email address provided")

            # Collect attachments only if user selected documents to re-attach
            attachments = []
            if selected_docs:
                attachments, _failed = self._collect_attachments(session, job, selected_docs)
                attachments = self._compress_attachments_if_needed(attachments)
                self._assert_within_email_limit(attachments)

            # Send via claim_followup email service
            from app.domains.claim_followup.service import ClaimFollowUpService
            email_service = ClaimFollowUpService()

            claim_id = str(job.claim_id) if job.claim_id else None

            send_payload = {
                "claim_id": claim_id,
                "email_account_id": email_account_id,
                "to_addresses": to_addresses,
                "cc_addresses": cc_addresses,
                "bcc_addresses": bcc_addresses,
                "subject": subject,
                "body_html": body_html,
                "attachments": attachments,
            }
            if data.get("from_address"):
                send_payload["from_address"] = data["from_address"]
            email_result = email_service.send_email(send_payload)

            # Log claim activity (but do NOT update documents_sent_date or status)
            if job.claim_id:
                activity = ClaimActivity(
                    claim_id=job.claim_id,
                    activity_type='wm_followup_sent',
                    title=f"WM Follow-up email sent to adjuster ({to_addresses[0]})",
                    description=(
                        f"Follow-up email sent for water mitigation job at "
                        f"{job.property_address}."
                        f"{f' {len(attachments)} document(s) re-attached.' if attachments else ''}"
                    ),
                    related_entity_type='wm_job',
                    related_entity_id=str(job.id),
                )
                session.add(activity)

            session.commit()

            return {
                "success": True,
                "email_id": str(email_result.get("id", "")),
                "attachments_count": len(attachments),
            }
        except Exception as e:
            session.rollback()
            logger.error(f"Error sending follow-up: {e}")
            raise
        finally:
            session.close()

    # ================================================================
    # Attachment Collection
    # ================================================================

    def _collect_attachments(
        self, session, job, selected_docs: List[str]
    ) -> tuple:
        """Collect file attachments for email based on selected document types.

        Returns:
            Tuple of (attachments_list, failed_docs_list)
        """
        from .models import WMDocument, WMScopeInvoice

        logger.info(f"Collecting attachments for selected_docs={selected_docs}")
        attachments = []
        failed_docs = []
        address_short = (job.property_address or "property").split(",")[0].strip()

        # 1. Photo Report
        if "photo_report" in selected_docs:
            doc = (
                session.query(WMDocument)
                .filter(
                    WMDocument.job_id == str(job.id),
                    WMDocument.is_active == True,
                    WMDocument.document_type.in_(['report', 'photo_report']),
                )
                .order_by(WMDocument.created_at.desc())
                .first()
            )
            if doc:
                att = self._attachment_from_wm_document(doc, f"Photo Report - {address_short}.pdf")
                if not att:
                    logger.warning(
                        f"Photo report doc exists (id={doc.id}, type={doc.document_type}, "
                        f"path={doc.file_path}, storage_id={getattr(doc, 'storage_file_id', None)}) "
                        f"but file download failed - falling back to regenerating from saved config"
                    )
                    att = self._generate_photo_report_attachment(session, job, address_short)
                if att:
                    attachments.append(att)
                else:
                    failed_docs.append("photo_report")
            else:
                # No saved report yet - auto-generate one from the job's saved
                # report config (the same sections/photos the user configured
                # in the Documents tab), so users don't have to manually click
                # "Generate Report" before sending to adjuster.
                att = self._generate_photo_report_attachment(session, job, address_short)
                if att:
                    attachments.append(att)
                else:
                    failed_docs.append("photo_report")

        # 2. Invoice
        if "invoice" in selected_docs:
            att = self._get_invoice_attachment(session, job, address_short)
            if att:
                attachments.append(att)
            else:
                failed_docs.append("invoice")

        # 3. W9
        if "w9" in selected_docs:
            att = self._get_w9_attachment(session, job)
            if att:
                attachments.append(att)
            else:
                failed_docs.append("w9")

        # 4. COS
        if "cos" in selected_docs:
            doc = (
                session.query(WMDocument)
                .filter(
                    WMDocument.job_id == str(job.id),
                    WMDocument.is_active == True,
                    WMDocument.document_type == 'COS',
                )
                .order_by(WMDocument.created_at.desc())
                .first()
            )
            if doc:
                att = self._attachment_from_wm_document(doc, f"COS - {address_short}.pdf")
                if att:
                    attachments.append(att)
                else:
                    failed_docs.append("cos")
            else:
                failed_docs.append("cos")

        # 5. EWA
        if "ewa" in selected_docs:
            doc = (
                session.query(WMDocument)
                .filter(
                    WMDocument.job_id == str(job.id),
                    WMDocument.is_active == True,
                    WMDocument.document_type == 'EWA',
                )
                .order_by(WMDocument.created_at.desc())
                .first()
            )
            if doc:
                att = self._attachment_from_wm_document(doc, f"EWA - {address_short}.pdf")
                if att:
                    attachments.append(att)
                else:
                    failed_docs.append("ewa")
            else:
                failed_docs.append("ewa")

        # 6. Sketch
        if "sketch" in selected_docs:
            att = self._get_sketch_attachment(session, job, address_short)
            if att:
                attachments.append(att)
            else:
                failed_docs.append("sketch")

        if failed_docs:
            logger.warning(
                f"Failed to collect attachments for: {failed_docs} "
                f"(selected={selected_docs}, succeeded={len(attachments)})"
            )

        return attachments, failed_docs

    def _attachment_from_wm_document(
        self, doc, display_filename: str
    ) -> Optional[Dict[str, Any]]:
        """Create attachment dict from a WMDocument (local or cloud storage)."""
        try:
            import os
            file_data = None
            file_path_str = doc.file_path or ''
            storage_file_id = getattr(doc, 'storage_file_id', None) or ''
            storage_provider = getattr(doc, 'storage_provider', None) or ''

            if not storage_provider:
                # Legacy records (created before the storage_provider column
                # existed) were always saved to local disk. Check local disk
                # first rather than assuming today's env default (e.g. gcs) -
                # guessing cloud for what is actually a local path silently
                # fails since the path isn't a valid object key.
                local_path = Path(file_path_str) if file_path_str else None
                if local_path and local_path.exists():
                    storage_provider = 'local'
                else:
                    storage_provider = os.getenv('STORAGE_PROVIDER', 'local').lower()

            logger.info(
                f"Attachment resolve: doc={doc.id}, provider={storage_provider}, "
                f"file_path={file_path_str[:80]}, storage_file_id={storage_file_id[:80]}"
            )

            if storage_provider != 'local':
                # Cloud storage (GCS, B2, GDrive, ...). Try file_path first,
                # then storage_file_id as fallback. The record's own provider
                # is passed through so a document written under an earlier
                # provider still resolves after a migration.
                download_keys = []
                for key in (file_path_str, storage_file_id):
                    if key and key not in download_keys:
                        download_keys.append(key)
                if not download_keys:
                    logger.warning(f"WMDocument {doc.id}: no file_path or storage_file_id for cloud download")
                    return None
                for key in download_keys:
                    try:
                        file_data = download_from_storage(key, storage_provider)
                        logger.info(f"Downloaded WMDocument {doc.id} from {storage_provider}: {key}")
                        break
                    except Exception as e:
                        logger.warning(f"Cloud download failed for WMDocument {doc.id} ({key}): {e}")
            else:
                # Local filesystem
                local_path = Path(file_path_str)
                if local_path.exists():
                    file_data = local_path.read_bytes()
                else:
                    logger.warning(f"WMDocument file not found locally: {file_path_str}")

            if not file_data:
                logger.warning(f"No file data for WMDocument {doc.id} ({file_path_str})")
                return None

            return {
                "filename": display_filename,
                "data": file_data,
                "mime_type": doc.mime_type or "application/pdf",
            }
        except Exception as e:
            logger.warning(f"Error reading WMDocument {doc.id}: {e}")
            return None

    def _generate_photo_report_attachment(
        self, session, job, address_short: str
    ) -> Optional[Dict[str, Any]]:
        """No saved Photo Report yet - generate one on the fly using the
        job's saved report config (same one shown/edited in the Documents
        tab), persisting it as a WMDocument so it doesn't need to be
        regenerated next time."""
        try:
            from .models import WMDocument
            from .service import WaterMitigationService

            service = WaterMitigationService(session)
            config = service.get_report_config(job.id)
            if not config:
                all_docs = (
                    session.query(WMDocument.id, WMDocument.document_type, WMDocument.is_active, WMDocument.filename)
                    .filter(WMDocument.job_id == str(job.id))
                    .all()
                )
                logger.warning(
                    f"Photo report WMDocument not found for job {job.id} and no report "
                    f"config saved - can't auto-generate. Please build the photo report "
                    f"in the Documents tab first. "
                    f"Existing documents: {[(str(d.id)[:8], d.document_type, d.is_active, d.filename) for d in all_docs]}"
                )
                return None

            logger.info(f"Photo report attachment: no saved WMDocument, auto-generating from saved config for job {job.id}")
            # compress=True so the PDF this saves is already email-sized
            # (50% quality, 1200px cap) instead of the full 95%-quality
            # original - the email attachment path used to always start
            # from the heaviest possible version and then try to shrink it
            # back down under 512MB of RAM.
            result = service.generate_and_save_photo_report(
                job.id, config=config, commit=False, compress=True,
            )
            return {
                "filename": f"Photo Report - {address_short}.pdf",
                "data": result["pdf_bytes"],
                "mime_type": "application/pdf",
            }
        except Exception as e:
            logger.warning(f"Auto-generating photo report failed for job {job.id}: {e}")
            return None

    def _get_invoice_attachment(
        self, session, job, address_short: str
    ) -> Optional[Dict[str, Any]]:
        """Use uploaded invoice WMDocument first; fall back to
        on-the-fly PDF generation from WMScopeInvoice."""
        try:
            from .models import WMScopeInvoice, WMDocument
            from app.domains.invoice.service import InvoiceService

            # --- Priority 1: uploaded invoice document ---
            inv_doc = (
                session.query(WMDocument)
                .filter(
                    WMDocument.job_id == str(job.id),
                    WMDocument.is_active == True,
                    WMDocument.document_type.in_(
                        ['Invoice', 'invoice']
                    ),
                )
                .order_by(WMDocument.created_at.desc())
                .first()
            )
            if inv_doc:
                logger.info(
                    f"Invoice attachment: Using uploaded "
                    f"WMDocument {inv_doc.id} "
                    f"({inv_doc.filename})"
                )
                return self._attachment_from_wm_document(
                    inv_doc,
                    f"Invoice - {address_short}.pdf",
                )

            # --- Priority 2: generate from WMScopeInvoice ---
            invoice_link = (
                session.query(WMScopeInvoice)
                .filter(WMScopeInvoice.job_id == str(job.id))
                .order_by(WMScopeInvoice.generated_at.desc())
                .first()
            )
            if not invoice_link:
                logger.warning(
                    f"Invoice attachment: No uploaded invoice and "
                    f"no WMScopeInvoice for job_id={job.id}"
                )
                return None

            logger.info(
                f"Invoice attachment: Found WMScopeInvoice "
                f"invoice_id={invoice_link.invoice_id} "
                f"for job_id={job.id}"
            )

            invoice_service = InvoiceService(self.database)
            invoice = invoice_service.get_with_items(
                str(invoice_link.invoice_id)
            )
            if not invoice:
                logger.warning(
                    f"Invoice attachment: Invoice record not found "
                    f"for invoice_id={invoice_link.invoice_id}"
                )
                return None

            # Generate PDF
            from app.common.services.pdf_service import get_pdf_service
            import tempfile
            from collections import OrderedDict

            # Ensure company info
            if invoice.get('company_id') and not invoice.get('company_name'):
                from app.domains.company.models import Company
                company = session.query(Company).filter(
                    Company.id == invoice['company_id']
                ).first()
                if company:
                    invoice['company_name'] = company.name
                    invoice['company_address'] = company.address
                    invoice['company_city'] = getattr(company, 'city', '')
                    invoice['company_state'] = getattr(company, 'state', '')
                    invoice['company_zip'] = getattr(company, 'zipcode', '')
                    invoice['company_phone'] = company.phone
                    invoice['company_email'] = company.email
                    invoice['company_logo'] = company.logo

            # Build sections from items
            all_items = invoice.get('items', [])
            sorted_items = sorted(all_items, key=lambda x: x.get('sort_order', 0) or 0)
            items_by_section = OrderedDict()
            for item in sorted_items:
                section_name = item.get('primary_group') or 'Items'
                if section_name not in items_by_section:
                    items_by_section[section_name] = []
                items_by_section[section_name].append({
                    "name": item.get('name', ''),
                    "description": item.get('description'),
                    "note": item.get('note'),
                    "quantity": item.get('quantity', 0),
                    "unit": item.get('unit', ''),
                    "rate": item.get('rate', 0),
                    "amount": item.get('quantity', 0) * item.get('rate', 0),
                })

            sections = []
            for section_name, section_items in items_by_section.items():
                section_subtotal = sum(i['amount'] for i in section_items)
                sections.append({
                    "title": section_name,
                    "items": section_items,
                    "subtotal": section_subtotal,
                })

            pdf_data = {
                "invoice_number": invoice.get('invoice_number', ''),
                "date": str(invoice.get('invoice_date',
                            invoice.get('date', ''))),
                "due_date": str(invoice.get('due_date', '')),
                "company": {
                    "name": invoice.get('company_name', ''),
                    "address": invoice.get('company_address', ''),
                    "city": invoice.get('company_city', ''),
                    "state": invoice.get('company_state', ''),
                    "zip": invoice.get('company_zip', ''),
                    "phone": invoice.get('company_phone', ''),
                    "email": invoice.get('company_email', ''),
                    "logo": None,
                },
                "client": {
                    "name": invoice.get('client_name', ''),
                    "address": invoice.get('client_address', ''),
                    "city": invoice.get('client_city', ''),
                    "state": invoice.get('client_state', ''),
                    "zip": invoice.get('client_zipcode',
                                       invoice.get('client_zip', '')),
                },
                "items": all_items,
                "sections": sections,
                "subtotal": float(invoice.get('subtotal', 0) or 0),
                "adjustments": invoice.get('adjustments', []),
                "tax_amount": float(invoice.get('tax_amount', 0) or 0),
                "total": float(invoice.get('total_amount', 0) or 0),
                "payments": invoice.get('payments', []),
                "balance_due": float(invoice.get('balance_due',
                                     invoice.get('total_amount', 0)) or 0),
                "notes": invoice.get('notes', ''),
            }

            with tempfile.NamedTemporaryFile(suffix='.pdf', delete=False) as tmp:
                temp_path = tmp.name

            pdf_path = get_pdf_service().generate_invoice_pdf(pdf_data, temp_path, template_variant="a")
            pdf_bytes = Path(pdf_path).read_bytes()

            # Cleanup temp file
            try:
                Path(pdf_path).unlink()
            except Exception:
                pass

            inv_num = invoice.get('invoice_number', 'invoice')
            return {
                "filename": f"Invoice {inv_num} - {address_short}.pdf",
                "data": pdf_bytes,
                "mime_type": "application/pdf",
            }
        except Exception as e:
            import traceback
            logger.error(
                f"Error generating invoice attachment for job {job.id}: {e}\n"
                f"{traceback.format_exc()}"
            )
            return None

    def _get_w9_attachment(self, session, job) -> Optional[Dict[str, Any]]:
        """Get company W9 file as attachment."""
        try:
            if not job.company_id:
                logger.warning("W9: job has no company_id")
                return None

            from app.domains.company.models import Company
            company = session.query(Company).filter(Company.id == job.company_id).first()
            if not company:
                logger.warning(f"W9: company not found for id={job.company_id}")
                return None

            w9_file_id = getattr(company, 'w9_file_id', None)
            if not w9_file_id:
                logger.warning(f"W9: company '{company.name}' has no w9_file_id")
                return None

            # File.id is String, w9_file_id may be UUID — cast to str for matching
            from app.domains.file.models import File as FileModel
            file_rec = session.query(FileModel).filter(
                FileModel.id == str(w9_file_id)
            ).first()
            if not file_rec:
                logger.warning(f"W9: File record not found for w9_file_id={w9_file_id} (type={type(w9_file_id).__name__})")
                return None

            # Read file data. The record's own storage_provider column is
            # authoritative here: a W-9 uploaded before the move to B2 still
            # carries its original "gs://" url, and handing that straight to
            # today's provider is a guaranteed miss - "gs://bucket/key" is not
            # a valid B2 object key. download_from_storage() tries the
            # record's provider first, then today's provider with the bare key.
            file_url = file_rec.url or ''
            record_provider = getattr(file_rec, 'storage_provider', None)
            file_data = None
            logger.info(
                f"W9: file_url={file_url}, storage_provider={record_provider}"
            )

            if is_cloud_ref(file_url) or (record_provider and record_provider != 'local'):
                file_data = download_from_storage(file_url, record_provider)
            else:
                file_path = Path(file_url)
                if file_path.exists():
                    file_data = file_path.read_bytes()
                else:
                    logger.warning(f"W9: local file not found at {file_path}")

            if not file_data:
                logger.warning(f"W9: no file data retrieved for {file_url}")
                return None

            company_name = (company.name or "Company").replace(" ", "_")
            original_name = getattr(file_rec, 'original_name', '') or getattr(file_rec, 'filename', 'W9.pdf')
            ext = Path(original_name).suffix or '.pdf'
            return {
                "filename": f"W9 - {company_name}{ext}",
                "data": file_data,
                "mime_type": getattr(file_rec, 'content_type', 'application/pdf') or "application/pdf",
            }
        except Exception as e:
            logger.error(f"Error getting W9 attachment: {e}")
            return None

    def _get_sketch_attachment(
        self, session, job, address_short: str
    ) -> Optional[Dict[str, Any]]:
        """Use the previously generated sketch_report WMDocument if one
        exists (avoids re-rendering through the headless browser on every
        send); fall back to generating fresh if there's no saved copy or
        its file can't be read. Staleness (floor sketch edited after the
        last render) is surfaced to the user as a warning in the send
        dialog, not enforced here - we still attach the existing PDF."""
        try:
            from .models import WMDocument
            from .sketch_pdf_service import SketchPdfService

            doc = (
                session.query(WMDocument)
                .filter(
                    WMDocument.job_id == str(job.id),
                    WMDocument.is_active == True,
                    WMDocument.document_type == 'sketch_report',
                )
                .order_by(WMDocument.created_at.desc())
                .first()
            )
            if doc:
                att = self._attachment_from_wm_document(doc, f"Sketch - {address_short}.pdf")
                if att:
                    return att
                logger.warning(
                    f"Sketch report doc exists (id={doc.id}) but file download failed - "
                    f"falling back to regenerating"
                )

            sketch_service = SketchPdfService(session)
            result = sketch_service.generate_and_save_sketch_report(job.id, commit=False)
            return {
                "filename": f"Sketch - {address_short}.pdf",
                "data": result["pdf_bytes"],
                "mime_type": "application/pdf",
            }
        except Exception as e:
            logger.error(f"Error generating sketch attachment: {e}")
            return None

    # ================================================================
    # Follow-up Task
    # ================================================================

    def _create_followup_task(self, session, job):
        """Create a follow-up task after sending documents (skip if one already exists)."""
        try:
            if not job.claim_id:
                return

            from app.domains.claim_followup.models import FollowUpTask
            from datetime import timedelta

            # Skip if an active wm_docs_sent task already exists for this job
            existing = session.query(FollowUpTask).filter(
                FollowUpTask.claim_id == job.claim_id,
                FollowUpTask.wm_job_id == str(job.id),
                FollowUpTask.task_type == 'wm_docs_sent',
                FollowUpTask.status.notin_(['resolved', 'cancelled']),
            ).first()
            if existing:
                logger.info(f"Follow-up task already exists for WM Job {job.id}, skipping")
                return

            # Use adjuster email from WM job (not from send payload)
            adjuster_email = job.adjuster_email or ""
            # Fallback to claim adjuster email
            if not adjuster_email and job.claim_id:
                from app.domains.client.models import (
                    Claim as ClaimModel,
                )
                claim = session.query(ClaimModel).filter(
                    ClaimModel.id == job.claim_id
                ).first()
                if claim:
                    adjuster_email = getattr(
                        claim, 'adjuster_email', ''
                    ) or ""

            sheet_name = job.google_sheet_name or ""
            pa_info = f" | PA: {sheet_name}" if sheet_name else ""

            followup = FollowUpTask(
                claim_id=job.claim_id,
                wm_job_id=str(job.id),
                task_type='wm_docs_sent',
                title=f"WM Follow up - Docs sent to adjuster ({job.property_address}){pa_info}",
                description=(
                    f"Water mitigation documents (Invoice, COS, EWA, Photo Report, W9, Sketch) "
                    f"sent to adjuster.{pa_info}"
                ),
                status='pending',
                next_followup_date=datetime.now(timezone.utc) + timedelta(days=3),
                auto_followup_enabled=True,
                followup_interval_days=3,
                max_followup_count=5,
                assigned_to_name=job.adjuster_name or "",
                assigned_to_email=adjuster_email,
                assigned_to_phone=job.adjuster_phone or "",
                assigned_to_role='adjuster',
                priority='normal',
            )
            session.add(followup)
            logger.info(f"Created follow-up task for WM Job {job.id} (sent to adjuster)")
        except Exception as e:
            logger.error(f"Error creating follow-up for WM Job {job.id}: {e}")

    # ================================================================
    # Attachment Compression
    # ================================================================

    # Gmail/SMTP 25MB limit; use 23MB threshold to account for
    # base64 encoding overhead (~33% increase) in MIME messages.
    _EMAIL_SIZE_LIMIT = 23 * 1024 * 1024

    # Render's production instance has a 512MB hard memory cap, shared with
    # the rest of the running app (DB connections, request handlers for
    # other users, etc.) - not 512MB free for this one compression job.
    # Compressing a PDF needs the original bytes, the reopened
    # fitz.Document, and the reassembled output alive at once, and a
    # photo-heavy report can multiply that further as each embedded JPEG is
    # decoded to raw pixels before being re-encoded smaller. 80MB leaves
    # real headroom for that working set instead of just fitting the raw
    # attachment bytes; refuse before attempting compression rather than
    # finding out the hard way (this OOM-killed the whole instance once
    # already at a 150MB threshold - see git history on this file).
    _MAX_COMPRESSIBLE_SIZE = 80 * 1024 * 1024

    # Compression levels: try gentle first, then stronger if still over limit.
    # max_image_px / jpeg_quality drive the PyMuPDF fallback and are the
    # equivalent of the Ghostscript dpi settings for a full-page photo
    # (max_image_px ~= color_dpi x 8 inches).
    _COMPRESSION_LEVELS = [
        {
            "name": "printer",
            "settings": "/printer",   # 300 dpi — high quality print
            "color_dpi": 300,
            "gray_dpi": 300,
            "mono_dpi": 600,
            "max_image_px": 2400,
            "jpeg_quality": 80,
        },
        {
            "name": "ebook",
            "settings": "/ebook",     # 150 dpi — good quality for screen
            "color_dpi": 150,
            "gray_dpi": 150,
            "mono_dpi": 300,
            "max_image_px": 1200,
            "jpeg_quality": 65,
        },
        {
            "name": "screen",
            "settings": "/screen",    # 72 dpi — last resort before refusing
            "color_dpi": 100,
            "gray_dpi": 100,
            "mono_dpi": 200,
            "max_image_px": 900,
            "jpeg_quality": 55,
        },
    ]

    def _compress_attachments_if_needed(
        self, attachments: List[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        """Compress PDF attachments progressively until under email size limit.

        Tries gentle compression (300dpi) first. If still over limit,
        applies stronger compression (150dpi) to the largest remaining PDFs.
        """
        total_size = sum(len(att["data"]) for att in attachments)
        if total_size <= self._EMAIL_SIZE_LIMIT:
            return attachments

        if total_size > self._MAX_COMPRESSIBLE_SIZE:
            largest = sorted(
                attachments, key=lambda a: len(a["data"]), reverse=True
            )[:3]
            detail = ", ".join(
                f"{a.get('filename', 'attachment')} "
                f"({len(a['data']) / 1024 / 1024:.1f}MB)"
                for a in largest
            )
            raise ValueError(
                f"Attachments total {total_size / 1024 / 1024:.1f}MB, too large "
                f"to compress safely. Email was NOT sent. Largest: {detail}. "
                f"Reduce the number of photos in the Photo Report, or send the "
                f"largest documents in a separate email."
            )

        logger.info(
            f"Total attachment size {total_size / 1024 / 1024:.1f}MB "
            f"exceeds {self._EMAIL_SIZE_LIMIT / 1024 / 1024:.0f}MB limit, "
            f"compressing PDF attachments..."
        )

        # Swap each attachment's bytes in place rather than building a second
        # list: an over-limit payload is hundreds of MB, and dropping the
        # original as soon as its smaller version exists keeps peak memory
        # near one copy instead of two. Every caller rebinds to the return
        # value, so sharing the list is not observable.
        result = attachments

        for level in self._COMPRESSION_LEVELS:
            current_total = sum(len(a["data"]) for a in result)
            if current_total <= self._EMAIL_SIZE_LIMIT:
                break

            logger.info(
                f"Trying compression level '{level['name']}' "
                f"({level['color_dpi']}dpi)..."
            )

            # Sort by size descending — compress largest PDFs first
            largest_first = sorted(
                result, key=lambda a: len(a["data"]), reverse=True
            )

            for att in largest_first:
                current_total = sum(len(a["data"]) for a in result)
                if current_total <= self._EMAIL_SIZE_LIMIT:
                    break

                mime = att.get("mime_type", "")
                fname = att.get("filename", "")
                if (
                    mime != "application/pdf"
                    and not fname.lower().endswith(".pdf")
                ):
                    continue

                original_size = len(att["data"])
                compressed = self._compress_pdf(att["data"], level)
                if compressed and len(compressed) < original_size:
                    saved = original_size - len(compressed)
                    logger.info(
                        f"[{level['name']}] '{fname}': "
                        f"{original_size / 1024 / 1024:.1f}MB -> "
                        f"{len(compressed) / 1024 / 1024:.1f}MB "
                        f"(saved {saved / 1024 / 1024:.1f}MB)"
                    )
                    att["data"] = compressed

        final_size = sum(len(a["data"]) for a in result)
        logger.info(
            f"Compression complete: "
            f"{total_size / 1024 / 1024:.1f}MB -> "
            f"{final_size / 1024 / 1024:.1f}MB"
        )
        return result

    # Ghostscript ships under a different binary name per platform
    # ('gs' on Linux/macOS, 'gswin64c'/'gswin32c' on Windows) and isn't
    # installed at all on Render's Python runtime. Resolve it once and fall
    # back to the pure-Python downsampler when it's missing.
    _GS_BINARIES = ("gs", "gswin64c", "gswin32c")
    _gs_binary: Optional[str] = None
    _gs_lookup_done = False

    @classmethod
    def _find_ghostscript(cls) -> Optional[str]:
        """Path to the Ghostscript binary, or None if it isn't installed."""
        if not cls._gs_lookup_done:
            import shutil
            cls._gs_lookup_done = True
            for name in cls._GS_BINARIES:
                found = shutil.which(name)
                if found:
                    cls._gs_binary = found
                    logger.info(f"Using Ghostscript for PDF compression: {found}")
                    break
            else:
                logger.info(
                    f"Ghostscript not found (tried {', '.join(cls._GS_BINARIES)}) - "
                    f"falling back to the PyMuPDF image downsampler"
                )
        return cls._gs_binary

    @classmethod
    def _compress_pdf(
        cls, pdf_bytes: bytes, level: Dict[str, Any]
    ) -> Optional[bytes]:
        """Compress a PDF at the given quality level.

        Prefers Ghostscript (best ratio, rewrites the whole file) and falls
        back to re-encoding the embedded images with PyMuPDF + Pillow, which
        needs no system binary.
        """
        gs_binary = cls._find_ghostscript()
        if gs_binary:
            compressed = cls._compress_pdf_gs(pdf_bytes, level, gs_binary)
            # Ghostscript can hand back a *larger* file for a PDF that is
            # already well optimized; the image pass may still win there.
            if compressed and len(compressed) < len(pdf_bytes):
                return compressed
        return cls._compress_pdf_images(pdf_bytes, level)

    @staticmethod
    def _compress_pdf_gs(
        pdf_bytes: bytes, level: Dict[str, Any], gs_binary: str
    ) -> Optional[bytes]:
        """Compress a PDF using Ghostscript at the given quality level."""
        import subprocess
        import tempfile

        src_path = dst_path = None
        try:
            with tempfile.NamedTemporaryFile(
                suffix=".pdf", delete=False
            ) as src:
                src.write(pdf_bytes)
                src_path = src.name

            dst_path = src_path.replace(".pdf", "_compressed.pdf")

            cmd = [
                gs_binary, "-sDEVICE=pdfwrite",
                "-dCompatibilityLevel=1.4",
                f"-dPDFSETTINGS={level['settings']}",
                "-dNOPAUSE", "-dQUIET", "-dBATCH",
                f"-dColorImageResolution={level['color_dpi']}",
                f"-dGrayImageResolution={level['gray_dpi']}",
                f"-dMonoImageResolution={level['mono_dpi']}",
                f"-sOutputFile={dst_path}",
                src_path,
            ]
            proc = subprocess.run(
                cmd, capture_output=True, text=True, timeout=120
            )
            if proc.returncode != 0:
                logger.warning(
                    f"Ghostscript compression failed: {proc.stderr}"
                )
                return None

            compressed = Path(dst_path).read_bytes()
            return compressed
        except Exception as e:
            logger.warning(f"Ghostscript compression error: {e}")
            return None
        finally:
            for p in [src_path, dst_path]:
                if p:
                    try:
                        Path(p).unlink(missing_ok=True)
                    except Exception:
                        pass

    @classmethod
    def _compress_pdf_images(
        cls, pdf_bytes: bytes, level: Dict[str, Any]
    ) -> Optional[bytes]:
        """Shrink a PDF by re-encoding its embedded images (no Ghostscript).

        Photo reports are almost entirely full-resolution camera JPEGs, so
        downsampling those recovers essentially all of the size. Returns None
        when nothing could be shrunk.
        """
        try:
            import fitz  # PyMuPDF
        except ImportError as e:
            logger.warning(f"PyMuPDF unavailable, cannot compress PDF: {e}")
            return None

        max_px = level.get("max_image_px", 1200)
        quality = level.get("jpeg_quality", 65)

        doc = None
        try:
            doc = fitz.open(stream=pdf_bytes, filetype="pdf")
            handled = set()
            replaced = 0

            for page in doc:
                for img in page.get_images(full=True):
                    xref = img[0]
                    if xref in handled:
                        continue
                    handled.add(xref)

                    try:
                        info = doc.extract_image(xref)
                    except Exception:
                        continue
                    original = (info or {}).get("image")
                    if not original:
                        continue
                    # A soft mask carries transparency a flat JPEG can't
                    # represent - leave those images alone.
                    if info.get("smask"):
                        continue

                    shrunk = cls._shrink_image_bytes(original, max_px, quality)
                    if shrunk and len(shrunk) < len(original):
                        try:
                            page.replace_image(xref, stream=shrunk)
                            replaced += 1
                        except Exception as e:
                            logger.debug(f"Could not replace image {xref}: {e}")
                    # `info`/`original`/`shrunk` hold full-resolution camera
                    # JPEGs (several MB each) that would otherwise stay
                    # reachable via this frame until the whole page/doc loop
                    # finishes - a photo report with 50+ images means 50+ of
                    # these piling up before any get collected.
                    del info, original, shrunk

            if not replaced:
                return None

            return doc.tobytes(garbage=4, deflate=True)
        except Exception as e:
            logger.warning(f"PyMuPDF compression error: {e}")
            return None
        finally:
            if doc is not None:
                try:
                    doc.close()
                except Exception:
                    pass

    @staticmethod
    def _shrink_image_bytes(
        img_bytes: bytes, max_px: int, quality: int
    ) -> Optional[bytes]:
        """Re-encode one embedded image as a smaller JPEG."""
        import io as _io

        try:
            from PIL import Image

            img = Image.open(_io.BytesIO(img_bytes))
            img.load()

            # JPEG has no alpha channel - flatten onto white first.
            if img.mode in ("RGBA", "LA", "P"):
                rgba = img.convert("RGBA")
                flat = Image.new("RGB", rgba.size, (255, 255, 255))
                flat.paste(rgba, mask=rgba.split()[3])
                img = flat
            elif img.mode != "RGB":
                img = img.convert("RGB")

            longest = max(img.width, img.height)
            if longest > max_px:
                ratio = max_px / longest
                img = img.resize(
                    (
                        max(1, int(img.width * ratio)),
                        max(1, int(img.height * ratio)),
                    ),
                    Image.LANCZOS,
                )

            buf = _io.BytesIO()
            img.save(buf, format="JPEG", quality=quality, optimize=True)
            return buf.getvalue()
        except Exception as e:
            logger.debug(f"Image shrink failed: {e}")
            return None

    def _assert_within_email_limit(
        self, attachments: List[Dict[str, Any]]
    ) -> None:
        """Refuse to send a payload SMTP will reject anyway.

        Without this the send hangs on a doomed multi-hundred-MB upload and
        comes back with an opaque SMTP error, so say plainly what's too big.
        """
        total = sum(len(att["data"]) for att in attachments)
        if total <= self._EMAIL_SIZE_LIMIT:
            return

        largest = sorted(
            attachments, key=lambda a: len(a["data"]), reverse=True
        )[:3]
        detail = ", ".join(
            f"{a.get('filename', 'attachment')} "
            f"({len(a['data']) / 1024 / 1024:.1f}MB)"
            for a in largest
        )
        raise ValueError(
            f"Attachments total {total / 1024 / 1024:.1f}MB, which is over the "
            f"{self._EMAIL_SIZE_LIMIT / 1024 / 1024:.0f}MB email limit even after "
            f"compression. Email was NOT sent. Largest: {detail}. "
            f"Reduce the number of photos in the Photo Report, or send the "
            f"largest documents in a separate email."
        )
