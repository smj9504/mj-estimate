"""
Water Mitigation Adjuster Email Service.
Handles document readiness checks, email generation, and sending to insurance adjusters.
"""

import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional
from uuid import UUID

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

            # 2. Invoice - check WMScopeInvoice existence
            invoice_link = (
                session.query(WMScopeInvoice)
                .filter(WMScopeInvoice.job_id == job_id)
                .order_by(WMScopeInvoice.generated_at.desc())
                .first()
            )

            # 3. W9 - check company w9_file_id
            w9_ready = False
            if job.company_id:
                from app.domains.company.models import Company
                company = session.query(Company).filter(Company.id == job.company_id).first()
                if company and getattr(company, 'w9_file_id', None):
                    w9_ready = True

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

            # 6. Sketch - check WMFloorSketch existence
            sketch_exists = (
                session.query(WMFloorSketch)
                .filter(WMFloorSketch.job_id == job_id)
                .first()
            ) is not None

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
                    "ready": invoice_link is not None,
                    "invoice_id": str(invoice_link.invoice_id) if invoice_link else None,
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
                },
                "all_ready": all([
                    photo_report_doc is not None,
                    invoice_link is not None,
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

            address = job.property_address or "N/A"
            claim_number = job.claim_number or "N/A"
            insurance = job.insurance_company or "N/A"
            homeowner = job.homeowner_name or "N/A"

            # Use adjuster first name for greeting
            adjuster_name = (job.adjuster_name or "").strip()
            adjuster_first = adjuster_name.split()[0] if adjuster_name else ""

            subject = claim_number

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
                    f"<h3 style='margin:20px 0 8px;color:#1a1a1a;font-size:15px;'>"
                    f"Additional Notes</h3>"
                    f"<p style='color:#444;font-size:14px;line-height:1.6;'>{custom_notes}</p>"
                )

            body_html = f"""
<p>{adjuster_first + ',' if adjuster_first else 'Hello,'}</p>

<p>Please find attached the water mitigation documents for the following claim:</p>

<table style="border-collapse:collapse;margin:16px 0;width:100%;max-width:500px;">
  <tr>
    <td style="padding:6px 10px;background:#f5f5f5;font-weight:bold;border:1px solid #ddd;">Property</td>
    <td style="padding:6px 10px;border:1px solid #ddd;">{address}</td>
  </tr>
  <tr>
    <td style="padding:6px 10px;background:#f5f5f5;font-weight:bold;border:1px solid #ddd;">Homeowner</td>
    <td style="padding:6px 10px;border:1px solid #ddd;">{homeowner}</td>
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

<h3 style="margin:20px 0 8px;color:#1a1a1a;font-size:15px;">Attached Documents</h3>
<ul style="margin:8px 0;padding-left:18px;color:#444;font-size:14px;line-height:1.8;">
  <li>Photo Report</li>
  <li>Invoice</li>
  <li>Company W-9</li>
  <li>Certificate of Satisfaction (COS)</li>
  <li>Emergency Work Authorization (EWA)</li>
  <li>Sketch</li>
</ul>

{custom_section}

<p>Please review the attached documents and let us know if you have any questions or need additional information.</p>

<p>Thank you.</p>
<p>Best regards,<br/>{company_name}</p>
"""
            return {"subject": subject, "body_html": body_html.strip()}
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
            attachments = self._collect_attachments(session, job, selected_docs)

            # Send via claim_followup email service
            from app.domains.claim_followup.service import ClaimFollowUpService
            email_service = ClaimFollowUpService()

            # Build claim_id for the email record (may be None)
            claim_id = str(job.claim_id) if job.claim_id else None

            email_result = email_service.send_email({
                "claim_id": claim_id,
                "email_account_id": email_account_id,
                "to_addresses": to_addresses,
                "cc_addresses": cc_addresses,
                "bcc_addresses": bcc_addresses,
                "subject": subject,
                "body_html": body_html,
                "attachments": attachments,
            })

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
            self._create_followup_task(session, job, to_addresses[0])

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
    # Attachment Collection
    # ================================================================

    def _collect_attachments(
        self, session, job, selected_docs: List[str]
    ) -> List[Dict[str, Any]]:
        """Collect file attachments for email based on selected document types."""
        from .models import WMDocument, WMScopeInvoice

        attachments = []
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
                if att:
                    attachments.append(att)

        # 2. Invoice
        if "invoice" in selected_docs:
            att = self._get_invoice_attachment(session, job, address_short)
            if att:
                attachments.append(att)

        # 3. W9
        if "w9" in selected_docs:
            att = self._get_w9_attachment(session, job)
            if att:
                attachments.append(att)

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

        # 6. Sketch
        if "sketch" in selected_docs:
            att = self._get_sketch_attachment(session, job, address_short)
            if att:
                attachments.append(att)

        return attachments

    def _attachment_from_wm_document(
        self, doc, display_filename: str
    ) -> Optional[Dict[str, Any]]:
        """Create attachment dict from a WMDocument (file stored on disk)."""
        try:
            file_path = Path(doc.file_path)
            if file_path.exists():
                file_data = file_path.read_bytes()
                return {
                    "filename": display_filename,
                    "data": file_data,
                    "mime_type": doc.mime_type or "application/pdf",
                }
            else:
                logger.warning(f"WMDocument file not found: {doc.file_path}")
                return None
        except Exception as e:
            logger.warning(f"Error reading WMDocument {doc.id}: {e}")
            return None

    def _get_invoice_attachment(
        self, session, job, address_short: str
    ) -> Optional[Dict[str, Any]]:
        """Generate invoice PDF on-the-fly and return as attachment."""
        try:
            from .models import WMScopeInvoice
            from app.domains.invoice.service import InvoiceService

            invoice_link = (
                session.query(WMScopeInvoice)
                .filter(WMScopeInvoice.job_id == str(job.id))
                .order_by(WMScopeInvoice.generated_at.desc())
                .first()
            )
            if not invoice_link:
                return None

            invoice_service = InvoiceService(self.database)
            invoice = invoice_service.get_with_items(str(invoice_link.invoice_id))
            if not invoice:
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
                "date": str(invoice.get('date', '')),
                "due_date": str(invoice.get('due_date', '')),
                "client_name": invoice.get('client_name', ''),
                "client_address": invoice.get('client_address', ''),
                "company_name": invoice.get('company_name', ''),
                "company_address": invoice.get('company_address', ''),
                "company_city": invoice.get('company_city', ''),
                "company_state": invoice.get('company_state', ''),
                "company_zip": invoice.get('company_zip', ''),
                "company_phone": invoice.get('company_phone', ''),
                "company_email": invoice.get('company_email', ''),
                "company_logo": invoice.get('company_logo', ''),
                "sections": sections,
                "subtotal": float(invoice.get('subtotal', 0) or 0),
                "tax_amount": float(invoice.get('tax_amount', 0) or 0),
                "total": float(invoice.get('total_amount', 0) or 0),
                "insurance_company": invoice.get('insurance_company', ''),
                "policy_number": invoice.get('policy_number', ''),
                "claim_number": invoice.get('claim_number', ''),
                "notes": invoice.get('notes', ''),
            }

            with tempfile.NamedTemporaryFile(suffix='.pdf', delete=False) as tmp:
                temp_path = tmp.name

            pdf_path = get_pdf_service().generate_invoice_pdf(pdf_data, temp_path)
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
            logger.error(f"Error generating invoice attachment: {e}")
            return None

    def _get_w9_attachment(self, session, job) -> Optional[Dict[str, Any]]:
        """Get company W9 file as attachment."""
        try:
            if not job.company_id:
                return None

            from app.domains.company.models import Company
            company = session.query(Company).filter(Company.id == job.company_id).first()
            if not company:
                return None

            w9_file_id = getattr(company, 'w9_file_id', None)
            if not w9_file_id:
                return None

            from app.domains.file.models import File as FileModel
            file_rec = session.query(FileModel).filter(FileModel.id == w9_file_id).first()
            if not file_rec:
                return None

            # Read file data
            file_url = file_rec.url or ''
            file_data = None

            if file_url.startswith(('gs://', 'https://', 'http://')):
                from app.domains.file.service import get_storage_provider
                storage = get_storage_provider()
                file_data = storage.download(file_url)
            else:
                file_path = Path(file_url)
                if file_path.exists():
                    file_data = file_path.read_bytes()

            if not file_data:
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
        """Generate sketch PDF on-the-fly and return as attachment."""
        try:
            from .sketch_pdf_service import SketchPdfService

            sketch_service = SketchPdfService(session)
            pdf_bytes = sketch_service.generate_sketch_report(job.id)

            if not pdf_bytes:
                return None

            return {
                "filename": f"Sketch - {address_short}.pdf",
                "data": pdf_bytes,
                "mime_type": "application/pdf",
            }
        except Exception as e:
            logger.error(f"Error generating sketch attachment: {e}")
            return None

    # ================================================================
    # Follow-up Task
    # ================================================================

    def _create_followup_task(self, session, job, adjuster_email: str):
        """Create a follow-up task after sending documents."""
        try:
            if not job.claim_id:
                return

            from app.domains.claim_followup.models import FollowUpTask
            from datetime import timedelta

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
