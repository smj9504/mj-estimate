"""
Rebuild domain service.
"""

import base64
import json
import logging
import uuid
from datetime import datetime
from io import BytesIO
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from reportlab.lib.utils import ImageReader

logger = logging.getLogger(__name__)


class RebuildService:
    def __init__(self, database=None):
        from app.core.database_factory import get_database
        self.database = database or get_database()

    def _s(self):
        return self.database.get_session()

    def _rs(self):
        return self.database.get_readonly_session()

    # ============================================================
    # Contractors
    # ============================================================

    def create_contractor(self, data: Dict[str, Any]) -> Dict[str, Any]:
        session = self._s()
        try:
            from app.domains.rebuild.repository import get_contractor_repository
            result = get_contractor_repository(session).create(data)
            session.commit()
            return result
        except Exception as e:
            session.rollback()
            raise
        finally:
            session.close()

    def update_contractor(self, cid: str, data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        session = self._s()
        try:
            from app.domains.rebuild.repository import get_contractor_repository
            result = get_contractor_repository(session).update(cid, data)
            session.commit()
            return result
        except Exception as e:
            session.rollback()
            raise
        finally:
            session.close()

    def get_contractor(self, cid: str) -> Optional[Dict[str, Any]]:
        session = self._rs()
        try:
            from app.domains.rebuild.repository import get_contractor_repository
            return get_contractor_repository(session).get_by_id(cid)
        finally:
            session.close()

    def get_contractors(self) -> List[Dict[str, Any]]:
        session = self._rs()
        try:
            from app.domains.rebuild.repository import get_contractor_repository
            return get_contractor_repository(session).get_active()
        finally:
            session.close()

    def delete_contractor(self, cid: str) -> bool:
        session = self._s()
        try:
            from app.domains.rebuild.repository import get_contractor_repository
            result = get_contractor_repository(session).update(cid, {"is_active": False})
            session.commit()
            return result is not None
        except Exception as e:
            session.rollback()
            raise
        finally:
            session.close()

    # ============================================================
    # Projects
    # ============================================================

    def create_project(self, data: Dict[str, Any]) -> Dict[str, Any]:
        session = self._s()
        try:
            from app.domains.rebuild.repository import get_project_repository
            # Auto-fill property_address from claim if not provided
            if not data.get('property_address') and data.get('claim_id'):
                data['property_address'] = self._get_claim_address(session, str(data['claim_id']))

            # Set status to assigned if contractor is provided
            if data.get('contractor_id') and data.get('status', 'pending') == 'pending':
                data['status'] = 'assigned'

            result = get_project_repository(session).create(data)
            session.commit()
            return result
        except Exception as e:
            session.rollback()
            raise
        finally:
            session.close()

    def update_project(self, pid: str, data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        session = self._s()
        try:
            from app.domains.rebuild.repository import get_project_repository
            result = get_project_repository(session).update(pid, data)
            session.commit()
            return result
        except Exception as e:
            session.rollback()
            raise
        finally:
            session.close()

    def get_project(self, pid: str) -> Optional[Dict[str, Any]]:
        session = self._rs()
        try:
            from app.domains.rebuild.repository import get_project_repository, get_completion_doc_repository
            repo = get_project_repository(session)
            result = repo.get_by_id(pid)
            if result:
                self._enrich_project(session, result)
                doc_repo = get_completion_doc_repository(session)
                result['completion_docs'] = doc_repo.get_by_project(pid)
                result['completion_doc_count'] = len(result['completion_docs'])
            return result
        finally:
            session.close()

    def get_projects(self, params: Dict[str, Any]) -> Tuple[List[Dict[str, Any]], int]:
        session = self._rs()
        try:
            from app.domains.rebuild.repository import get_project_repository
            items, total = get_project_repository(session).get_with_filters(**params)
            for item in items:
                self._enrich_project(session, item)
            return items, total
        finally:
            session.close()

    def get_projects_by_claim(self, claim_id: str) -> List[Dict[str, Any]]:
        session = self._rs()
        try:
            from app.domains.rebuild.repository import get_project_repository
            items = get_project_repository(session).get_by_claim(claim_id)
            for item in items:
                self._enrich_project(session, item)
            return items
        finally:
            session.close()

    def delete_project(self, pid: str) -> bool:
        session = self._s()
        try:
            from app.domains.rebuild.repository import get_project_repository
            result = get_project_repository(session).delete(pid)
            session.commit()
            return result
        except Exception as e:
            session.rollback()
            raise
        finally:
            session.close()

    def get_dashboard_stats(self) -> Dict[str, Any]:
        session = self._rs()
        try:
            from app.domains.rebuild.repository import get_project_repository
            return get_project_repository(session).get_dashboard_stats()
        finally:
            session.close()

    # ============================================================
    # Completion Docs
    # ============================================================

    def create_completion_doc(self, data: Dict[str, Any]) -> Dict[str, Any]:
        session = self._s()
        try:
            from app.domains.rebuild.repository import get_completion_doc_repository
            result = get_completion_doc_repository(session).create(data)
            session.commit()
            return result
        except Exception as e:
            session.rollback()
            raise
        finally:
            session.close()

    def update_completion_doc(self, doc_id: str, data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        session = self._s()
        try:
            from app.domains.rebuild.repository import get_completion_doc_repository
            result = get_completion_doc_repository(session).update(doc_id, data)
            session.commit()
            return result
        except Exception as e:
            session.rollback()
            raise
        finally:
            session.close()

    def delete_completion_doc(self, doc_id: str) -> bool:
        session = self._s()
        try:
            from app.domains.rebuild.repository import get_completion_doc_repository
            result = get_completion_doc_repository(session).delete(doc_id)
            session.commit()
            return result
        except Exception as e:
            session.rollback()
            raise
        finally:
            session.close()

    def get_completion_docs(self, project_id: str) -> List[Dict[str, Any]]:
        session = self._rs()
        try:
            from app.domains.rebuild.repository import get_completion_doc_repository
            return get_completion_doc_repository(session).get_by_project(project_id)
        finally:
            session.close()

    # ============================================================
    # Helpers
    # ============================================================

    def _enrich_project(self, session, item: Dict[str, Any]):
        try:
            from app.domains.client.models import Claim, Client
            from app.domains.rebuild.models import RebuildContractor
            claim = session.query(Claim).filter(Claim.id == item.get('claim_id')).first()
            if claim:
                item['claim_number'] = claim.claim_number
                item['insurance_company'] = claim.insurance_company
            if item.get('contractor_id'):
                contractor = session.query(RebuildContractor).filter(
                    RebuildContractor.id == item['contractor_id']
                ).first()
                if contractor:
                    item['contractor_name'] = contractor.company_name

            # Enrich with assigned reconstruction company from ClaimCompany
            try:
                from app.domains.contract.models import ClaimCompany
                from app.domains.company.models import Company
                cc = (
                    session.query(ClaimCompany, Company)
                    .join(Company, ClaimCompany.company_id == Company.id)
                    .filter(
                        ClaimCompany.claim_id == item.get('claim_id'),
                        ClaimCompany.role == 'reconstruction',
                    )
                    .first()
                )
                if cc:
                    item['rebuild_company_id'] = str(cc[1].id)
                    item['rebuild_company_name'] = cc[1].name
            except Exception:
                pass
        except Exception:
            pass

    def _get_claim_address(self, session, claim_id: str) -> Optional[str]:
        try:
            from app.domains.client.models import Claim, Client
            claim = session.query(Claim).filter(Claim.id == claim_id).first()
            if claim:
                client = session.query(Client).filter(Client.id == claim.client_id).first()
                if client:
                    return client.address
        except Exception:
            pass
        return None

    # ============================================================
    # Document Generation
    # ============================================================

    # The WM document picker keeps the rebuild certificate out, so the rebuild
    # picker keeps the WM-only templates (EWA, WM COS) out.
    WM_TEMPLATE_TYPES = ('authorization', 'certificate_of_satisfaction')

    # Contract template document_type -> completion doc_type
    TEMPLATE_DOC_TYPES = {
        'certificate_of_completion': 'coc',
        'lien_waiver': 'lien_waiver',
    }

    def _template_company_id(self, session, project) -> Optional[str]:
        """The company whose templates and details the completion docs use.

        The assigned contractor's company wins. Most projects never get a
        contractor, so fall back to the claim's reconstruction company.
        """
        from app.domains.rebuild.models import RebuildContractor
        from app.domains.contract.models import ClaimCompany

        if project.contractor_id:
            contractor = session.query(RebuildContractor).filter(
                RebuildContractor.id == project.contractor_id
            ).first()
            if contractor and contractor.company_id:
                return str(contractor.company_id)

        claim_company = session.query(ClaimCompany).filter(
            ClaimCompany.claim_id == project.claim_id,
            ClaimCompany.role == 'reconstruction',
        ).first()
        return str(claim_company.company_id) if claim_company else None

    @staticmethod
    def _parse_mappings(raw) -> list:
        if not raw:
            return []
        if isinstance(raw, list):
            return raw
        try:
            return json.loads(raw)
        except (TypeError, ValueError):
            logger.warning("Template field_mappings is not valid JSON; ignoring it")
            return []

    def get_available_templates(self, project_id: str) -> List[Dict[str, Any]]:
        """Contract templates of the company doing the rebuild, certificates first."""
        session = self._rs()
        try:
            from app.domains.rebuild.models import RebuildProject
            from app.domains.contract.models import ContractTemplate

            project = session.query(RebuildProject).filter(RebuildProject.id == project_id).first()
            if not project:
                return []

            company_id = self._template_company_id(session, project)
            if not company_id:
                return []

            templates = [
                t for t in session.query(ContractTemplate).filter(
                    ContractTemplate.company_id == company_id,
                    ContractTemplate.is_active == True,
                ).all()
                if t.document_type not in self.WM_TEMPLATE_TYPES
            ]
            templates.sort(key=lambda t: (t.document_type != 'certificate_of_completion', t.name or ''))
            return [{
                'id': str(t.id),
                'name': t.name,
                'document_type': t.document_type,
                'doc_type': self.TEMPLATE_DOC_TYPES.get(t.document_type, 'other'),
                'requires_signature': t.requires_signature,
                'file_url': t.file_url,
                'field_mappings': self._parse_mappings(t.field_mappings),
            } for t in templates]
        finally:
            session.close()

    def get_prefill_data(self, project_id: str) -> Dict[str, Any]:
        """Build prefill data from the project's claim/client/company info."""
        session = self._rs()
        try:
            from app.domains.rebuild.models import RebuildProject

            project = session.query(RebuildProject).filter(RebuildProject.id == project_id).first()
            if not project:
                return {}
            return self._build_prefill_with_session(session, project)
        finally:
            session.close()

    def generate_document(self, project_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
        """Generate a filled PDF from contract template with optional signature.

        data = {
            template_id: str,
            doc_type: str,  # coc, invoice, etc.
            title: str,
            overrides: dict,  # field overrides {fieldKey: value}
            additional_text: str,  # extra text to add
            signature_image: str,  # base64 PNG
            signature_name: str,
            signature_field_key: str,  # e.g. signature.homeowner; defaults to the template's first
        }
        """
        session = self._s()
        try:
            from app.domains.rebuild.models import RebuildProject
            from app.domains.rebuild.repository import get_completion_doc_repository
            from app.domains.contract.models import ContractTemplate

            project = session.query(RebuildProject).filter(RebuildProject.id == project_id).first()
            if not project:
                raise ValueError("Project not found")

            if not data.get('template_id'):
                raise ValueError("Select a template")
            template = session.query(ContractTemplate).filter(
                ContractTemplate.id == data['template_id']
            ).first()
            if not template:
                raise ValueError("Template not found")

            # Build prefill (reuse session)
            prefill = self._build_prefill_with_session(session, project)

            # Apply overrides
            overrides = data.get('overrides') or {}
            for key, value in overrides.items():
                parts = key.split('.', 1)
                if len(parts) == 2:
                    cat, field = parts
                    if cat not in prefill:
                        prefill[cat] = {}
                    prefill[cat][field] = value

            filled_pdf_url = self._generate_filled_pdf(
                project_id, template, self._parse_mappings(template.field_mappings), prefill,
                signature_image=data.get('signature_image'),
                signature_name=data.get('signature_name'),
                signature_field_key=data.get('signature_field_key'),
                additional_text=data.get('additional_text'),
            )

            # Build file name
            address_short = (project.property_address or 'project').split(',')[0].strip().replace(' ', '_')[:30]
            doc_type = data.get('doc_type') or self.TEMPLATE_DOC_TYPES.get(template.document_type, 'other')
            file_name = f"{doc_type.upper()}_{address_short}_{datetime.utcnow().strftime('%Y%m%d')}.pdf"

            # Create completion doc
            doc_data = {
                'project_id': project_id,
                'doc_type': doc_type,
                'title': data.get('title', template.name),
                'description': data.get('additional_text', ''),
                'file_url': filled_pdf_url,
                'file_name': file_name,
                'mime_type': 'application/pdf',
                'status': 'final',
            }
            result = get_completion_doc_repository(session).create(doc_data)
            session.commit()
            return result
        except Exception as e:
            session.rollback()
            logger.error(f"Error generating document: {e}")
            raise
        finally:
            session.close()

    def photos_to_pdf(self, project_id: str, photos: list, rotations: Dict[int, int],
                      doc_type: str, title: str) -> Dict[str, Any]:
        """Convert uploaded photos to a multi-page PDF.

        photos: list of (filename, bytes) tuples
        rotations: {index: degrees} e.g. {0: 90, 2: 180}
        doc_type: completion doc type
        title: document title
        """
        session = self._s()
        try:
            from app.domains.rebuild.models import RebuildProject
            from app.domains.rebuild.repository import get_completion_doc_repository
            from PIL import Image
            from reportlab.pdfgen import canvas as rl_canvas
            from reportlab.lib.pagesizes import letter

            project = session.query(RebuildProject).filter(RebuildProject.id == project_id).first()
            if not project:
                raise ValueError("Project not found")

            if not photos:
                raise ValueError("No photos provided")

            # Generate PDF from photos
            pdf_buffer = BytesIO()
            c = rl_canvas.Canvas(pdf_buffer, pagesize=letter)
            page_w, page_h = letter
            margin = 36  # 0.5 inch

            for idx, (filename, photo_bytes) in enumerate(photos):
                img = Image.open(BytesIO(photo_bytes))

                # Apply rotation
                rotation = rotations.get(idx, 0)
                if rotation:
                    img = img.rotate(-rotation, expand=True)  # PIL rotates counter-clockwise

                # Convert RGBA to RGB for PDF
                if img.mode in ('RGBA', 'P'):
                    img = img.convert('RGB')

                # Calculate fit within page (maintaining aspect ratio)
                max_w = page_w - 2 * margin
                max_h = page_h - 2 * margin
                img_w, img_h = img.size
                ratio = min(max_w / img_w, max_h / img_h)
                draw_w = img_w * ratio
                draw_h = img_h * ratio

                # Center on page
                x = (page_w - draw_w) / 2
                y = (page_h - draw_h) / 2

                # Save image to temp buffer
                img_buffer = BytesIO()
                img.save(img_buffer, format='JPEG', quality=90)
                img_buffer.seek(0)

                from reportlab.lib.utils import ImageReader
                c.drawImage(ImageReader(img_buffer), x, y, width=draw_w, height=draw_h)

                if idx < len(photos) - 1:
                    c.showPage()

            c.save()
            pdf_bytes = pdf_buffer.getvalue()

            # Upload to cloud storage
            from app.common.utils.storage_helpers import upload_bytes_to_storage

            address_short = (project.property_address or 'project').split(',')[0].strip().replace(' ', '_')[:30]
            file_name = f"{doc_type.upper()}_{address_short}_{datetime.utcnow().strftime('%Y%m%d')}.pdf"
            file_id = str(uuid.uuid4())

            storage_info = upload_bytes_to_storage(
                file_bytes=pdf_bytes,
                filename=file_name,
                context="rebuild",
                context_id=str(project_id),
                category="docs",
            )

            # Create completion doc
            doc_data = {
                'project_id': project_id,
                'doc_type': doc_type,
                'title': title,
                'file_id': file_id,
                'file_url': storage_info["file_url"],
                'file_name': file_name,
                'mime_type': 'application/pdf',
                'status': 'final',
            }
            result = get_completion_doc_repository(session).create(doc_data)
            session.commit()
            return result
        except Exception as e:
            session.rollback()
            logger.error(f"Error creating photo PDF: {e}")
            raise
        finally:
            session.close()

    # ============================================================
    # Document Generation Helpers
    # ============================================================

    # Mapped fields drawn from a signature, never printed as prefill text
    SIGNATURE_KEY_PREFIXES = ('signature.', 'initial.', 'date_signed.')

    def _build_prefill_with_session(self, session, project) -> Dict[str, Any]:
        """Prefill values for a template, the same ones a contract would print.

        Built by the contract service so a template prints identically from
        Contracts and from Rebuild, plus the project's own facts.
        """
        from app.domains.client.models import Claim
        from app.domains.contract.service import ContractInstanceService
        from app.domains.water_mitigation.models import WaterMitigationJob

        claim = session.query(Claim).filter(Claim.id == project.claim_id).first()
        wm_job = None
        if claim:
            wm_job = session.query(WaterMitigationJob.id).filter(
                WaterMitigationJob.claim_id == claim.id
            ).first()

        today = datetime.utcnow().strftime('%m/%d/%Y')
        prefill = ContractInstanceService(self.database)._build_prefill(session, {
            'client_id': str(claim.client_id) if claim and claim.client_id else None,
            'claim_id': str(project.claim_id),
            'company_id': self._template_company_id(session, project),
            'wm_job_id': str(wm_job.id) if wm_job else None,
        })
        prefill['meta'] = {'current_date': today}

        # Certificates are often mapped with WM job fields (wm_job.claim_number);
        # without a WM job on the claim, answer them from the claim and client.
        if 'wm_job' not in prefill:
            client = prefill.get('client') or {}
            claim_info = prefill.get('claim') or {}
            prefill['wm_job'] = {
                'property_address': project.property_address or client.get('full_address'),
                'property_street': client.get('address'),
                'property_city': client.get('city'),
                'property_state': client.get('state'),
                'property_zipcode': client.get('zipcode'),
                'homeowner_name': client.get('display_name'),
                'homeowner_phone': client.get('phone'),
                'homeowner_email': client.get('email'),
                'claim_number': claim_info.get('claim_number'),
                'insurance_company': claim_info.get('insurance_company'),
                'insurance_policy_number': claim_info.get('insurance_policy_number'),
                'date_of_loss': claim_info.get('date_of_loss'),
                'adjuster_name': claim_info.get('adjuster_name'),
                'adjuster_phone': claim_info.get('adjuster_phone'),
                'adjuster_email': claim_info.get('adjuster_email'),
                'today': today,
            }

        def _money(v):
            return f"${float(v):,.2f}" if v else None

        prefill['project'] = {
            'title': project.title,
            'property_address': project.property_address,
            'scope_of_work': project.scope_of_work,
            'contract_amount': _money(project.contract_amount),
            'insurance_estimate_amount': _money(project.insurance_estimate_amount),
        }
        return prefill

    def _resolve_field_value(self, prefill: Dict[str, Any], field_key: str) -> str:
        """Resolve a field key like 'client.display_name' from prefill data."""
        parts = field_key.split('.', 1)
        if len(parts) != 2:
            return ''
        category, key = parts
        value = (prefill.get(category) or {}).get(key)
        return str(value) if value is not None else ''

    def _load_template_pdf(self, file_url: str, storage_provider: Optional[str]) -> bytes:
        """Template PDF bytes, resolved the same way the template View PDF proxy does."""
        from app.domains.contract.api import _resolve_contract_pdf

        if not file_url:
            raise ValueError("This template has no PDF. Upload one in Contract Templates.")
        pdf_bytes = _resolve_contract_pdf(file_url, storage_provider)
        if not pdf_bytes:
            raise ValueError("The template's PDF file could not be found. Re-upload it in Contract Templates.")
        return pdf_bytes

    def _generate_filled_pdf(self, project_id: str, template, mappings: list,
                             prefill: dict, signature_image: str = None, signature_name: str = None,
                             signature_field_key: str = None, additional_text: str = None) -> str:
        """Overlay field values and an optional signature on the template PDF.

        The signature goes into the template's mapped signature box (the one
        named by signature_field_key, else the first) and that signer's
        date_signed box gets today's date. Templates without a signature box
        get it at the bottom right of the last page.

        Returns the stored file_url.
        """
        from pypdf import PdfReader, PdfWriter
        from reportlab.pdfgen import canvas as rl_canvas

        from app.common.utils.storage_helpers import upload_bytes_to_storage
        from app.domains.contract.service import _draw_text_wrapped

        reader = PdfReader(BytesIO(self._load_template_pdf(template.file_url, template.storage_provider)))
        writer = PdfWriter()
        today = datetime.utcnow().strftime('%m/%d/%Y')

        text_fields = [
            m for m in mappings
            if not m.get('fieldKey', '').startswith(self.SIGNATURE_KEY_PREFIXES)
        ]
        sig_boxes: list = []
        date_boxes: list = []
        if signature_image:
            sig_keys = [m.get('fieldKey') for m in mappings if m.get('fieldKey', '').startswith('signature.')]
            target_key = signature_field_key if signature_field_key in sig_keys else (sig_keys[0] if sig_keys else None)
            if target_key:
                role = target_key.split('.', 1)[1]
                sig_boxes = [m for m in mappings if m.get('fieldKey') == target_key]
                date_boxes = [m for m in mappings if m.get('fieldKey') == f'date_signed.{role}']
        sig_bytes = base64.b64decode(signature_image.split(',', 1)[-1]) if signature_image else None

        def _box(m, pw, ph, default_w=0.25, default_h=0.03):
            fw = m.get('width', default_w) * pw
            fh = m.get('height', default_h) * ph
            fx = m.get('x', 0) * pw
            fy = ph - (m.get('y', 0) * ph) - fh  # PDF origin is bottom-left
            return fx, fy, fw, fh

        def _fill_color(c, hex_color):
            try:
                c.setFillColorRGB(int(hex_color[1:3], 16) / 255, int(hex_color[3:5], 16) / 255,
                                  int(hex_color[5:7], 16) / 255)
            except (TypeError, ValueError, IndexError):
                c.setFillColorRGB(0, 0, 0)

        total_pages = len(reader.pages)
        for page_num in range(total_pages):
            page = reader.pages[page_num]
            pw = float(page.mediabox.width)
            ph = float(page.mediabox.height)
            is_last_page = page_num == total_pages - 1

            page_texts = [m for m in text_fields if m.get('pageIndex', 0) == page_num]
            page_sigs = [m for m in sig_boxes if m.get('pageIndex', 0) == page_num]
            page_dates = [m for m in date_boxes if m.get('pageIndex', 0) == page_num]
            loose_signature = is_last_page and sig_bytes and not sig_boxes
            loose_text = is_last_page and additional_text
            if not (page_texts or page_sigs or page_dates or loose_signature or loose_text):
                writer.add_page(page)
                continue

            overlay_buffer = BytesIO()
            c = rl_canvas.Canvas(overlay_buffer, pagesize=(pw, ph))

            for m in page_texts:
                value = self._resolve_field_value(prefill, m.get('fieldKey', ''))
                if not value:
                    continue
                fx, fy, fw, fh = _box(m, pw, ph)
                _fill_color(c, m.get('fontColor', '#000000'))
                _draw_text_wrapped(c, value, fx, fy, fw, fh, m.get('fontSize', 12))

            for m in page_sigs:
                fx, fy, fw, fh = _box(m, pw, ph, 0.2, 0.06)
                c.drawImage(ImageReader(BytesIO(sig_bytes)), fx, fy, fw, fh,
                            mask='auto', preserveAspectRatio=True, anchor='c')

            for m in page_dates:
                fx, fy, fw, fh = _box(m, pw, ph)
                c.setFillColorRGB(0, 0, 0)
                _draw_text_wrapped(c, today, fx, fy, fw, fh, m.get('fontSize', 12))

            if loose_signature:
                sig_w, sig_h = 150, 50
                sig_x = pw - sig_w - 72  # 1 inch from right
                sig_y = 100
                c.drawImage(ImageReader(BytesIO(sig_bytes)), sig_x, sig_y, width=sig_w, height=sig_h,
                            preserveAspectRatio=True, mask='auto')
                c.setFont("Helvetica", 9)
                c.setFillColorRGB(0, 0, 0)
                if signature_name:
                    c.drawString(sig_x, sig_y - 12, signature_name)
                c.drawString(sig_x, sig_y - 22, today)

            if loose_text:
                c.setFont("Helvetica", 10)
                c.setFillColorRGB(0, 0, 0)
                text_y = 160
                for line in additional_text.split('\n')[:5]:
                    c.drawString(72, text_y, line[:100])
                    text_y -= 14

            c.save()
            overlay_buffer.seek(0)
            overlay_reader = PdfReader(overlay_buffer)
            if overlay_reader.pages:
                page.merge_page(overlay_reader.pages[0])
            writer.add_page(page)

        pdf_buffer = BytesIO()
        writer.write(pdf_buffer)
        storage_info = upload_bytes_to_storage(
            file_bytes=pdf_buffer.getvalue(),
            filename=f"filled_{uuid.uuid4()}.pdf",
            context="rebuild",
            context_id=str(project_id),
            category="docs",
        )
        return storage_info["file_url"]
