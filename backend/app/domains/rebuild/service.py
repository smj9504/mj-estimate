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

    def get_available_templates(self, project_id: str) -> List[Dict[str, Any]]:
        """Get contract templates available for the project's contractor's company."""
        session = self._rs()
        try:
            from app.domains.rebuild.models import RebuildProject, RebuildContractor
            from app.domains.contract.models import ContractTemplate

            project = session.query(RebuildProject).filter(RebuildProject.id == project_id).first()
            if not project:
                return []

            # Get contractor's company_id
            company_id = None
            if project.contractor_id:
                contractor = session.query(RebuildContractor).filter(
                    RebuildContractor.id == project.contractor_id
                ).first()
                if contractor and contractor.company_id:
                    company_id = str(contractor.company_id)

            if not company_id:
                return []

            templates = (
                session.query(ContractTemplate)
                .filter(
                    ContractTemplate.company_id == company_id,
                    ContractTemplate.is_active == True,
                )
                .all()
            )
            results = []
            for t in templates:
                results.append({
                    'id': str(t.id),
                    'name': t.name,
                    'document_type': t.document_type,
                    'requires_signature': t.requires_signature,
                    'file_url': t.file_url,
                    'field_mappings': json.loads(t.field_mappings) if t.field_mappings else [],
                })
            return results
        finally:
            session.close()

    def get_prefill_data(self, project_id: str) -> Dict[str, Any]:
        """Build prefill data from the project's claim/client/company info."""
        session = self._rs()
        try:
            from app.domains.rebuild.models import RebuildProject, RebuildContractor
            from app.domains.client.models import Claim, Client
            from app.domains.company.models import Company

            project = session.query(RebuildProject).filter(RebuildProject.id == project_id).first()
            if not project:
                return {}

            prefill: Dict[str, Any] = {'meta': {'current_date': datetime.utcnow().strftime('%m/%d/%Y')}}

            # Claim & Client
            claim = session.query(Claim).filter(Claim.id == project.claim_id).first()
            if claim:
                prefill['claim'] = {
                    'claim_number': claim.claim_number,
                    'insurance_company': claim.insurance_company,
                    'insurance_policy_number': claim.insurance_policy_number,
                    'date_of_loss': str(claim.date_of_loss) if claim.date_of_loss else None,
                    'loss_description': claim.loss_description,
                    'adjuster_name': claim.adjuster_name,
                    'adjuster_phone': getattr(claim, 'adjuster_phone', None),
                    'adjuster_email': getattr(claim, 'adjuster_email', None),
                    'deductible': str(claim.deductible) if claim.deductible else None,
                }
                client = session.query(Client).filter(Client.id == claim.client_id).first()
                if client:
                    full_addr_parts = [p for p in [client.address, client.city, client.state, client.zipcode] if p]
                    prefill['client'] = {
                        'display_name': client.display_name,
                        'address': client.address,
                        'city': client.city,
                        'state': client.state,
                        'zipcode': client.zipcode,
                        'full_address': ', '.join(full_addr_parts),
                        'phone': client.phone,
                        'email': client.email,
                    }

            # Company (from contractor)
            if project.contractor_id:
                contractor = session.query(RebuildContractor).filter(
                    RebuildContractor.id == project.contractor_id
                ).first()
                if contractor and contractor.company_id:
                    company = session.query(Company).filter(Company.id == contractor.company_id).first()
                    if company:
                        prefill['company'] = {
                            'name': company.name,
                            'address': company.address,
                            'phone': company.phone,
                            'email': company.email,
                            'license_number': company.license_number,
                        }

            # Project info
            prefill['project'] = {
                'title': project.title,
                'property_address': project.property_address,
                'scope_of_work': project.scope_of_work,
                'contract_amount': str(project.contract_amount) if project.contract_amount else None,
                'insurance_estimate_amount': str(project.insurance_estimate_amount) if project.insurance_estimate_amount else None,
            }

            return prefill
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
        }
        """
        session = self._s()
        try:
            from app.domains.rebuild.models import RebuildProject, RebuildContractor
            from app.domains.rebuild.repository import get_completion_doc_repository
            from app.domains.contract.models import ContractTemplate

            project = session.query(RebuildProject).filter(RebuildProject.id == project_id).first()
            if not project:
                raise ValueError("Project not found")

            template = session.query(ContractTemplate).filter(
                ContractTemplate.id == data['template_id']
            ).first()
            if not template:
                raise ValueError("Template not found")

            # Build prefill (reuse session)
            prefill = self._build_prefill_with_session(session, project)

            # Apply overrides
            overrides = data.get('overrides', {})
            for key, value in overrides.items():
                parts = key.split('.', 1)
                if len(parts) == 2:
                    cat, field = parts
                    if cat not in prefill:
                        prefill[cat] = {}
                    prefill[cat][field] = value

            # Parse field mappings
            mappings = json.loads(template.field_mappings) if template.field_mappings else []

            # Generate filled PDF
            filled_pdf_url = self._generate_filled_pdf(
                template.file_url, mappings, prefill,
                signature_image=data.get('signature_image'),
                signature_name=data.get('signature_name'),
                additional_text=data.get('additional_text'),
            )
            if not filled_pdf_url:
                raise ValueError("Failed to generate PDF")

            # Build file name
            address_short = (project.property_address or 'project').split(',')[0].strip().replace(' ', '_')[:30]
            doc_type = data.get('doc_type', 'other')
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

            # Save PDF file
            backend_dir = Path(__file__).resolve().parents[3]
            upload_dir = backend_dir / "uploads" / "rebuild" / "docs"
            upload_dir.mkdir(parents=True, exist_ok=True)

            address_short = (project.property_address or 'project').split(',')[0].strip().replace(' ', '_')[:30]
            file_name = f"{doc_type.upper()}_{address_short}_{datetime.utcnow().strftime('%Y%m%d')}.pdf"
            file_id = str(uuid.uuid4())
            saved_name = f"{file_id}.pdf"
            file_path = upload_dir / saved_name

            with open(file_path, 'wb') as f:
                f.write(pdf_bytes)

            file_url = f"/uploads/rebuild/docs/{saved_name}"

            # Create completion doc
            doc_data = {
                'project_id': project_id,
                'doc_type': doc_type,
                'title': title,
                'file_id': file_id,
                'file_url': file_url,
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

    def _build_prefill_with_session(self, session, project) -> Dict[str, Any]:
        """Build prefill data using an existing session."""
        from app.domains.client.models import Claim, Client
        from app.domains.company.models import Company
        from app.domains.rebuild.models import RebuildContractor

        prefill: Dict[str, Any] = {'meta': {'current_date': datetime.utcnow().strftime('%m/%d/%Y')}}

        claim = session.query(Claim).filter(Claim.id == project.claim_id).first()
        if claim:
            prefill['claim'] = {
                'claim_number': claim.claim_number,
                'insurance_company': claim.insurance_company,
                'insurance_policy_number': claim.insurance_policy_number,
                'date_of_loss': str(claim.date_of_loss) if claim.date_of_loss else None,
                'loss_description': claim.loss_description,
                'adjuster_name': claim.adjuster_name,
                'adjuster_phone': getattr(claim, 'adjuster_phone', None),
                'adjuster_email': getattr(claim, 'adjuster_email', None),
                'deductible': str(claim.deductible) if claim.deductible else None,
            }
            client = session.query(Client).filter(Client.id == claim.client_id).first()
            if client:
                full_addr_parts = [p for p in [client.address, client.city, client.state, client.zipcode] if p]
                prefill['client'] = {
                    'display_name': client.display_name,
                    'address': client.address,
                    'city': client.city,
                    'state': client.state,
                    'zipcode': client.zipcode,
                    'full_address': ', '.join(full_addr_parts),
                    'phone': client.phone,
                    'email': client.email,
                }

        if project.contractor_id:
            contractor = session.query(RebuildContractor).filter(
                RebuildContractor.id == project.contractor_id
            ).first()
            if contractor and contractor.company_id:
                company = session.query(Company).filter(Company.id == contractor.company_id).first()
                if company:
                    prefill['company'] = {
                        'name': company.name,
                        'address': company.address,
                        'phone': company.phone,
                        'email': company.email,
                        'license_number': company.license_number,
                    }

        prefill['project'] = {
            'title': project.title,
            'property_address': project.property_address,
            'scope_of_work': project.scope_of_work,
            'contract_amount': str(project.contract_amount) if project.contract_amount else None,
            'insurance_estimate_amount': str(project.insurance_estimate_amount) if project.insurance_estimate_amount else None,
        }

        return prefill

    def _resolve_field_value(self, prefill: Dict[str, Any], field_key: str) -> str:
        """Resolve a field key like 'client.display_name' from prefill data."""
        try:
            parts = field_key.split('.', 1)
            if len(parts) != 2:
                return ''
            category, key = parts
            value = prefill.get(category, {}).get(key)
            return str(value) if value is not None else ''
        except Exception:
            return ''

    def _generate_filled_pdf(self, template_file_url: str, mappings: list, prefill: dict,
                             signature_image: str = None, signature_name: str = None,
                             additional_text: str = None) -> Optional[str]:
        """Generate a filled PDF by overlaying text + signature on the template PDF."""
        try:
            from PyPDF2 import PdfReader, PdfWriter
            from reportlab.pdfgen import canvas as rl_canvas
            from reportlab.pdfbase.pdfmetrics import stringWidth

            backend_dir = Path(__file__).resolve().parents[3]
            if template_file_url.startswith('/uploads/'):
                template_path = backend_dir / template_file_url.lstrip('/')
            else:
                template_path = Path(template_file_url)

            if not template_path.exists():
                logger.warning(f"Template PDF not found: {template_path}")
                return None

            reader = PdfReader(str(template_path))
            writer = PdfWriter()

            # Group mappings by page
            page_mappings: Dict[int, list] = {}
            for mapping in mappings:
                page_idx = mapping.get('pageIndex', 0)
                if page_idx not in page_mappings:
                    page_mappings[page_idx] = []
                page_mappings[page_idx].append(mapping)

            total_pages = len(reader.pages)

            for page_num in range(total_pages):
                page = reader.pages[page_num]
                page_box = page.mediabox
                page_width = float(page_box.width)
                page_height = float(page_box.height)

                fields_on_page = page_mappings.get(page_num, [])
                is_last_page = (page_num == total_pages - 1)
                needs_overlay = fields_on_page or (is_last_page and (signature_image or additional_text))

                if needs_overlay:
                    overlay_buffer = BytesIO()
                    c = rl_canvas.Canvas(overlay_buffer, pagesize=(page_width, page_height))

                    # Draw field values
                    for field in fields_on_page:
                        value = self._resolve_field_value(prefill, field.get('fieldKey', ''))
                        if not value:
                            continue

                        fx = field.get('x', 0) * page_width
                        fw = field.get('width', 0.25) * page_width
                        fh = field.get('height', 0.03) * page_height
                        fy = page_height - (field.get('y', 0) * page_height) - fh
                        font_size = field.get('fontSize', 12)

                        font_color = field.get('fontColor', '#000000')
                        try:
                            r = int(font_color[1:3], 16) / 255
                            g = int(font_color[3:5], 16) / 255
                            b = int(font_color[5:7], 16) / 255
                            c.setFillColorRGB(r, g, b)
                        except (ValueError, IndexError):
                            c.setFillColorRGB(0, 0, 0)

                        usable_w = fw - 4
                        actual_size = font_size
                        while actual_size > 5:
                            tw = stringWidth(value, "Helvetica", actual_size)
                            if tw <= usable_w:
                                break
                            actual_size -= 0.5

                        c.setFont("Helvetica", actual_size)
                        text_y = fy + (fh - actual_size) / 2
                        c.drawString(fx + 2, text_y, value)

                    # Add signature on last page
                    if is_last_page and signature_image:
                        try:
                            import base64
                            sig_bytes = base64.b64decode(signature_image.split(',')[-1])
                            sig_reader = ImageReader(BytesIO(sig_bytes))
                            # Draw signature at bottom-right area
                            sig_w, sig_h = 150, 50
                            sig_x = page_width - sig_w - 72  # 1 inch from right
                            sig_y = 100  # near bottom
                            c.drawImage(sig_reader, sig_x, sig_y, width=sig_w, height=sig_h,
                                        preserveAspectRatio=True, mask='auto')
                            if signature_name:
                                c.setFont("Helvetica", 9)
                                c.setFillColorRGB(0, 0, 0)
                                c.drawString(sig_x, sig_y - 12, signature_name)
                                c.drawString(sig_x, sig_y - 22,
                                             datetime.utcnow().strftime('%m/%d/%Y'))
                        except Exception as e:
                            logger.warning(f"Error adding signature: {e}")

                    # Add additional text on last page
                    if is_last_page and additional_text:
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

            # Save
            upload_dir = backend_dir / "uploads" / "rebuild" / "docs"
            upload_dir.mkdir(parents=True, exist_ok=True)
            filled_name = f"filled_{uuid.uuid4()}.pdf"
            filled_path = upload_dir / filled_name

            with open(filled_path, "wb") as f:
                writer.write(f)

            return f"/uploads/rebuild/docs/{filled_name}"

        except Exception as e:
            logger.error(f"Error generating filled PDF: {e}")
            return None
