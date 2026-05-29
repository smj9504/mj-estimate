"""
Contract domain service layer.
"""

import json
import logging
import uuid
from datetime import datetime
from io import BytesIO
from pathlib import Path
from typing import Any, Dict, List, Optional

from app.common.base_service import BaseService
from app.core.interfaces import DatabaseProvider

logger = logging.getLogger(__name__)

# Available fields for template field mapping
AVAILABLE_FIELDS = [
    # Client fields
    {"key": "client.display_name", "label": "Client Name (Primary Owner)", "category": "Client"},
    {"key": "client.address", "label": "Address", "category": "Client"},
    {"key": "client.city", "label": "City", "category": "Client"},
    {"key": "client.state", "label": "State", "category": "Client"},
    {"key": "client.zipcode", "label": "Zip Code", "category": "Client"},
    {"key": "client.phone", "label": "Phone", "category": "Client"},
    {"key": "client.email", "label": "Email", "category": "Client"},
    {"key": "client.full_address", "label": "Full Address (Street, City, State ZIP)", "category": "Client"},
    # Claim fields
    {"key": "claim.claim_number", "label": "Claim Number", "category": "Claim"},
    {"key": "claim.insurance_company", "label": "Insurance Company", "category": "Claim"},
    {"key": "claim.insurance_policy_number", "label": "Policy Number", "category": "Claim"},
    {"key": "claim.date_of_loss", "label": "Date of Loss", "category": "Claim"},
    {"key": "claim.loss_description", "label": "Loss Description", "category": "Claim"},
    {"key": "claim.adjuster_name", "label": "Adjuster Name", "category": "Claim"},
    {"key": "claim.adjuster_phone", "label": "Adjuster Phone", "category": "Claim"},
    {"key": "claim.adjuster_email", "label": "Adjuster Email", "category": "Claim"},
    {"key": "claim.deductible", "label": "Deductible", "category": "Claim"},
    # Company fields
    {"key": "company.name", "label": "Company Name", "category": "Company"},
    {"key": "company.address", "label": "Company Address", "category": "Company"},
    {"key": "company.phone", "label": "Company Phone", "category": "Company"},
    {"key": "company.email", "label": "Company Email", "category": "Company"},
    {"key": "company.license_number", "label": "License Number", "category": "Company"},
    # Meta fields
    {"key": "meta.current_date", "label": "Current Date", "category": "Meta"},
    {"key": "meta.contract_number", "label": "Contract Number", "category": "Meta"},
]


class ContractTemplateService(BaseService[Dict[str, Any], str]):
    def __init__(self, database: DatabaseProvider = None):
        super().__init__(database)

    def get_repository(self):
        from app.domains.contract.repository import get_template_repository
        return get_template_repository(self.database.get_session())

    def _get_repository_instance(self, session):
        from app.domains.contract.repository import get_template_repository
        return get_template_repository(session)

    def get_by_company(self, company_id: str) -> List[Dict[str, Any]]:
        try:
            session = self.database.get_readonly_session()
            try:
                repo = self._get_repository_instance(session)
                return repo.get_by_company(company_id)
            finally:
                session.close()
        except Exception as e:
            logger.error(f"Error getting templates by company: {e}")
            raise

    def get_all_with_company(self, **kwargs) -> List[Dict[str, Any]]:
        try:
            session = self.database.get_readonly_session()
            try:
                repo = self._get_repository_instance(session)
                return repo.get_all_with_company(**kwargs)
            finally:
                session.close()
        except Exception as e:
            logger.error(f"Error getting templates: {e}")
            raise

    def get_field_mappings(self, template_id: str) -> Dict[str, Any]:
        """Get field mappings for a template along with available fields"""
        try:
            session = self.database.get_readonly_session()
            try:
                from app.domains.contract.models import ContractTemplate
                tmpl = session.query(ContractTemplate).filter(
                    ContractTemplate.id == template_id
                ).first()
                if not tmpl:
                    raise ValueError("Template not found")

                mappings = []
                if tmpl.field_mappings:
                    mappings = json.loads(tmpl.field_mappings)

                return {
                    "field_mappings": mappings,
                    "available_fields": AVAILABLE_FIELDS,
                }
            finally:
                session.close()
        except Exception as e:
            logger.error(f"Error getting field mappings: {e}")
            raise

    def update_field_mappings(self, template_id: str, field_mappings: list) -> Dict[str, Any]:
        """Update field mappings on a template"""
        try:
            mappings_json = json.dumps(field_mappings)
            return self.update(template_id, {"field_mappings": mappings_json})
        except Exception as e:
            logger.error(f"Error updating field mappings: {e}")
            raise


class ContractInstanceService(BaseService[Dict[str, Any], str]):
    def __init__(self, database: DatabaseProvider = None):
        super().__init__(database)

    def get_repository(self):
        from app.domains.contract.repository import get_instance_repository
        return get_instance_repository(self.database.get_session())

    def _get_repository_instance(self, session):
        from app.domains.contract.repository import get_instance_repository
        return get_instance_repository(session)

    def get_by_claim(self, claim_id: str) -> List[Dict[str, Any]]:
        try:
            session = self.database.get_readonly_session()
            try:
                repo = self._get_repository_instance(session)
                return repo.get_by_claim(claim_id)
            finally:
                session.close()
        except Exception as e:
            logger.error(f"Error getting contracts by claim: {e}")
            raise

    def create_contract(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Create a contract instance with signing token and optional PDF filling"""
        try:
            expires_days = data.pop('token_expires_days', 30)
            prefill_overrides = data.pop('prefill_overrides', None)

            session = self.database.get_session()
            try:
                # Build prefill snapshot (wm_job_id used here, then removed)
                prefill = self._build_prefill(session, data)
                data.pop('wm_job_id', None)

                # Merge user overrides
                if prefill_overrides:
                    for category, fields in prefill_overrides.items():
                        if category in prefill and isinstance(fields, dict):
                            prefill[category].update(fields)
                        else:
                            prefill[category] = fields

                data['prefill_data'] = json.dumps(prefill)

                # Get template
                from app.domains.contract.models import ContractTemplate
                tmpl = session.query(ContractTemplate).filter(
                    ContractTemplate.id == data['template_id']
                ).first()

                # Set title from template if not provided
                if not data.get('title') and tmpl:
                    data['title'] = tmpl.name

                # Create contract instance first to get contract_number
                repo = self._get_repository_instance(session)
                result = repo.create_with_token(data, expires_days)

                # Generate filled PDF if template has field mappings
                if tmpl and tmpl.field_mappings:
                    try:
                        mappings = json.loads(tmpl.field_mappings)
                        if mappings:
                            # Add meta fields to prefill
                            prefill['meta'] = {
                                'current_date': datetime.utcnow().strftime('%m/%d/%Y'),
                                'contract_number': result.get('contract_number', ''),
                            }
                            filled_url = self._generate_filled_pdf(
                                tmpl.file_url, mappings, prefill
                            )
                            if filled_url:
                                repo.update(str(result['id']), {'filled_pdf_url': filled_url})
                                session.commit()
                                result['filled_pdf_url'] = filled_url
                    except Exception as e:
                        logger.warning(f"Failed to generate filled PDF: {e}")

                return result
            finally:
                session.close()
        except Exception as e:
            logger.error(f"Error creating contract: {e}")
            raise

    def _build_prefill(self, session, data: Dict[str, Any]) -> Dict[str, Any]:
        """Capture client/claim/company info at time of contract generation"""
        prefill = {}
        try:
            from app.domains.client.models import Client, Claim
            from app.domains.company.models import Company

            client = session.query(Client).filter(Client.id == data.get('client_id')).first()
            if client:
                prefill['client'] = {
                    'display_name': client.display_name,
                    'address': client.address,
                    'city': client.city,
                    'state': client.state,
                    'zipcode': client.zipcode,
                    'phone': client.phone,
                    'email': client.email,
                    'full_address': f"{client.address or ''}, {client.city or ''}, {client.state or ''} {client.zipcode or ''}".strip(', '),
                }

            claim = session.query(Claim).filter(Claim.id == data.get('claim_id')).first()
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

            company = session.query(Company).filter(Company.id == data.get('company_id')).first()
            if company:
                prefill['company'] = {
                    'name': company.name,
                    'address': company.address,
                    'phone': company.phone,
                    'email': company.email,
                    'license_number': company.license_number,
                }

            # WM Job data
            wm_job_id = data.get('wm_job_id')
            if wm_job_id:
                self._add_wm_prefill(session, prefill, wm_job_id)
        except Exception as e:
            logger.warning(f"Error building prefill: {e}")
        return prefill

    def _add_wm_prefill(self, session, prefill: Dict[str, Any], wm_job_id: str):
        """Add Water Mitigation job fields to prefill data"""
        try:
            from app.domains.water_mitigation.models import WaterMitigationJob
            job = session.query(WaterMitigationJob).filter(
                WaterMitigationJob.id == wm_job_id
            ).first()
            if not job:
                return

            def fmt_date(dt, fmt='%m/%d/%Y'):
                if not dt:
                    return None
                if hasattr(dt, 'strftime'):
                    return dt.strftime(fmt)
                return str(dt)

            today = datetime.utcnow()
            dol = job.date_of_loss
            dol_plus1 = None
            if dol and hasattr(dol, 'date'):
                from datetime import timedelta
                dol_plus1 = (dol + timedelta(days=1)).strftime('%m/%d/%Y')

            prefill['wm_job'] = {
                'property_address': job.property_address,
                'property_street': job.property_street,
                'property_city': job.property_city,
                'property_state': job.property_state,
                'property_zipcode': job.property_zipcode,
                'property_full_address': job.property_address or '',
                'homeowner_name': job.homeowner_name,
                'homeowner_phone': job.homeowner_phone,
                'homeowner_email': job.homeowner_email,
                'insurance_company': job.insurance_company,
                'insurance_policy_number': job.insurance_policy_number,
                'claim_number': job.claim_number,
                'date_of_loss': fmt_date(dol),
                'date_of_loss_plus_1': dol_plus1,
                'mitigation_start_date': fmt_date(job.mitigation_start_date),
                'mitigation_end_date': fmt_date(job.mitigation_end_date),
                'mitigation_period': job.mitigation_period,
                'adjuster_name': job.adjuster_name,
                'adjuster_phone': job.adjuster_phone,
                'adjuster_email': job.adjuster_email,
                'today': today.strftime('%m/%d/%Y'),
            }
        except Exception as e:
            logger.warning(f"Error adding WM prefill: {e}")

    def _resolve_field_value(self, prefill: Dict[str, Any], field_key: str) -> str:
        """Resolve a field key like 'client.display_name' from prefill data"""
        try:
            parts = field_key.split('.', 1)
            if len(parts) != 2:
                return ''
            category, key = parts
            category_data = prefill.get(category, {})
            value = category_data.get(key)
            return str(value) if value is not None else ''
        except Exception:
            return ''

    def _generate_filled_pdf(self, template_file_url: str, mappings: list, prefill: dict) -> Optional[str]:
        """Generate a filled PDF by overlaying text on the template PDF using reportlab"""
        try:
            from PyPDF2 import PdfReader, PdfWriter
            from reportlab.pdfgen import canvas as rl_canvas

            # Resolve template file path
            backend_dir = Path(__file__).resolve().parents[2]
            if template_file_url.startswith('/uploads/'):
                template_path = backend_dir / template_file_url.lstrip('/')
            else:
                template_path = Path(template_file_url)

            if not template_path.exists():
                logger.warning(f"Template PDF not found: {template_path}")
                return None

            # Read template PDF
            reader = PdfReader(str(template_path))
            writer = PdfWriter()

            # Group mappings by page
            page_mappings: Dict[int, list] = {}
            for mapping in mappings:
                page_idx = mapping.get('pageIndex', 0)
                if page_idx not in page_mappings:
                    page_mappings[page_idx] = []
                page_mappings[page_idx].append(mapping)

            # Process each page
            for page_num in range(len(reader.pages)):
                page = reader.pages[page_num]
                page_box = page.mediabox
                page_width = float(page_box.width)
                page_height = float(page_box.height)

                fields_on_page = page_mappings.get(page_num, [])

                if fields_on_page:
                    # Create overlay with reportlab
                    overlay_buffer = BytesIO()
                    c = rl_canvas.Canvas(overlay_buffer, pagesize=(page_width, page_height))

                    for field in fields_on_page:
                        value = self._resolve_field_value(prefill, field.get('fieldKey', ''))
                        if not value:
                            continue

                        # Convert ratio (0-1) to PDF points
                        x = field.get('x', 0) * page_width
                        # PDF coordinate system: origin at bottom-left
                        y = page_height - (field.get('y', 0) * page_height) - (field.get('height', 0.03) * page_height)
                        font_size = field.get('fontSize', 12)

                        # Set font color
                        font_color = field.get('fontColor', '#000000')
                        try:
                            r = int(font_color[1:3], 16) / 255
                            g = int(font_color[3:5], 16) / 255
                            b = int(font_color[5:7], 16) / 255
                            c.setFillColorRGB(r, g, b)
                        except (ValueError, IndexError):
                            c.setFillColorRGB(0, 0, 0)

                        c.setFont("Helvetica", font_size)
                        c.drawString(x, y, value)

                    c.save()
                    overlay_buffer.seek(0)

                    # Merge overlay onto page
                    overlay_reader = PdfReader(overlay_buffer)
                    if overlay_reader.pages:
                        page.merge_page(overlay_reader.pages[0])

                writer.add_page(page)

            # Save filled PDF
            upload_dir = backend_dir / "uploads" / "contracts" / "filled"
            upload_dir.mkdir(parents=True, exist_ok=True)

            filled_name = f"filled_{uuid.uuid4()}.pdf"
            filled_path = upload_dir / filled_name
            with open(filled_path, "wb") as f:
                writer.write(f)

            return f"/uploads/contracts/filled/{filled_name}"

        except Exception as e:
            logger.error(f"Error generating filled PDF: {e}")
            return None

    def get_prefill_preview(
        self, claim_id: str, template_id: str, client_id: str, company_id: str,
        wm_job_id: str = None,
    ) -> Dict[str, Any]:
        """Preview prefill data without creating a contract"""
        try:
            session = self.database.get_readonly_session()
            try:
                data = {
                    'claim_id': claim_id,
                    'client_id': client_id,
                    'company_id': company_id,
                }
                if wm_job_id:
                    data['wm_job_id'] = wm_job_id
                prefill = self._build_prefill(session, data)
                prefill['meta'] = {
                    'current_date': datetime.utcnow().strftime('%m/%d/%Y'),
                    'contract_number': '(auto-generated)',
                }

                # Get field mappings from template
                field_mappings = []
                from app.domains.contract.models import ContractTemplate
                tmpl = session.query(ContractTemplate).filter(
                    ContractTemplate.id == template_id
                ).first()
                if tmpl and tmpl.field_mappings:
                    field_mappings = json.loads(tmpl.field_mappings)

                return {
                    **prefill,
                    'field_mappings': field_mappings,
                }
            finally:
                session.close()
        except Exception as e:
            logger.error(f"Error getting prefill preview: {e}")
            raise

    def get_dashboard(self, claim_id: str) -> Dict[str, Any]:
        """Get all contracts for a claim grouped by company"""
        try:
            session = self.database.get_readonly_session()
            try:
                repo = self._get_repository_instance(session)
                contracts = repo.get_by_claim(claim_id)

                # Get assigned companies
                from app.domains.contract.repository import get_claim_company_repository
                cc_repo = get_claim_company_repository(session)
                assigned_companies = cc_repo.get_by_claim(claim_id)

                # Build company map
                company_map: Dict[str, Dict[str, Any]] = {}
                for cc in assigned_companies:
                    cid = str(cc.get('company_id', ''))
                    if cid not in company_map:
                        company_map[cid] = {
                            'company_id': cid,
                            'company_name': cc.get('company_name', ''),
                            'role': cc.get('role'),
                            'is_primary': cc.get('is_primary', False),
                            'contracts': [],
                            'summary': {'total': 0, 'draft': 0, 'sent': 0, 'viewed': 0, 'signed': 0, 'voided': 0},
                        }

                # Group contracts by company
                for contract in contracts:
                    cid = str(contract.get('company_id', ''))
                    if cid not in company_map:
                        company_map[cid] = {
                            'company_id': cid,
                            'company_name': contract.get('company_name', ''),
                            'role': None,
                            'is_primary': False,
                            'contracts': [],
                            'summary': {'total': 0, 'draft': 0, 'sent': 0, 'viewed': 0, 'signed': 0, 'voided': 0},
                        }
                    company_map[cid]['contracts'].append(contract)
                    status = contract.get('status', 'draft')
                    company_map[cid]['summary']['total'] += 1
                    if status in company_map[cid]['summary']:
                        company_map[cid]['summary'][status] += 1

                return {
                    'claim_id': claim_id,
                    'companies': list(company_map.values()),
                    'total_contracts': len(contracts),
                }
            finally:
                session.close()
        except Exception as e:
            logger.error(f"Error getting dashboard: {e}")
            raise

    def get_by_token(self, token: str) -> Optional[Dict[str, Any]]:
        """Get contract by signing token (public, no auth)"""
        try:
            session = self.database.get_readonly_session()
            try:
                repo = self._get_repository_instance(session)
                return repo.get_by_token(token)
            finally:
                session.close()
        except Exception as e:
            logger.error(f"Error getting contract by token: {e}")
            raise

    def send_for_signing(self, instance_id: str) -> Optional[Dict[str, Any]]:
        """Mark contract as sent and return signing URL info"""
        try:
            session = self.database.get_session()
            try:
                repo = self._get_repository_instance(session)
                repo.update(instance_id, {
                    'status': 'sent',
                    'sent_at': datetime.utcnow(),
                })
                session.commit()
                return repo.get_by_id_enriched(instance_id)
            finally:
                session.close()
        except Exception as e:
            logger.error(f"Error sending contract: {e}")
            raise

    def sign_contract(self, token: str, sig_data: Dict[str, Any]) -> Dict[str, Any]:
        """Add signature to contract via public token"""
        try:
            session = self.database.get_session()
            try:
                repo = self._get_repository_instance(session)
                contract = repo.get_by_token(token)
                if not contract:
                    raise ValueError("Contract not found")
                if contract['status'] == 'voided':
                    raise ValueError("Contract has been voided")

                # Check token expiry
                expires = contract.get('token_expires_at')
                if expires:
                    if isinstance(expires, str):
                        expires = datetime.fromisoformat(expires)
                    if datetime.utcnow() > expires:
                        raise ValueError("Signing link has expired")

                instance_id = str(contract['id'])
                return repo.add_signature(instance_id, sig_data)
            finally:
                session.close()
        except Exception as e:
            logger.error(f"Error signing contract: {e}")
            raise

    def void_contract(self, instance_id: str) -> Optional[Dict[str, Any]]:
        try:
            return self.update(instance_id, {
                'status': 'voided',
                'voided_at': datetime.utcnow(),
            })
        except Exception as e:
            logger.error(f"Error voiding contract: {e}")
            raise


class ClaimCompanyService(BaseService[Dict[str, Any], str]):
    def __init__(self, database: DatabaseProvider = None):
        super().__init__(database)

    def get_repository(self):
        from app.domains.contract.repository import get_claim_company_repository
        return get_claim_company_repository(self.database.get_session())

    def _get_repository_instance(self, session):
        from app.domains.contract.repository import get_claim_company_repository
        return get_claim_company_repository(session)

    def get_by_claim(self, claim_id: str) -> List[Dict[str, Any]]:
        try:
            session = self.database.get_readonly_session()
            try:
                repo = self._get_repository_instance(session)
                return repo.get_by_claim(claim_id)
            finally:
                session.close()
        except Exception as e:
            logger.error(f"Error getting claim companies: {e}")
            raise
