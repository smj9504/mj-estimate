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
    # WM Job fields
    {"key": "wm_job.property_address", "label": "Property Address (Full)", "category": "WM Job"},
    {"key": "wm_job.property_street", "label": "Property Street", "category": "WM Job"},
    {"key": "wm_job.property_city", "label": "Property City", "category": "WM Job"},
    {"key": "wm_job.property_state", "label": "Property State", "category": "WM Job"},
    {"key": "wm_job.property_zipcode", "label": "Property Zip Code", "category": "WM Job"},
    {"key": "wm_job.homeowner_name", "label": "Homeowner Name", "category": "WM Job"},
    {"key": "wm_job.homeowner_phone", "label": "Homeowner Phone", "category": "WM Job"},
    {"key": "wm_job.homeowner_email", "label": "Homeowner Email", "category": "WM Job"},
    {"key": "wm_job.insurance_company", "label": "Insurance Company (WM)", "category": "WM Job"},
    {"key": "wm_job.insurance_policy_number", "label": "Policy Number (WM)", "category": "WM Job"},
    {"key": "wm_job.claim_number", "label": "Claim Number (WM)", "category": "WM Job"},
    {"key": "wm_job.date_of_loss", "label": "Date of Loss", "category": "WM Job"},
    {"key": "wm_job.date_of_loss_plus_1", "label": "Date of Loss + 1 Day", "category": "WM Job"},
    {"key": "wm_job.mitigation_start_date", "label": "Mitigation Start Date", "category": "WM Job"},
    {"key": "wm_job.mitigation_end_date", "label": "Mitigation End Date", "category": "WM Job"},
    {"key": "wm_job.mitigation_period", "label": "Mitigation Period", "category": "WM Job"},
    {"key": "wm_job.adjuster_name", "label": "Adjuster Name (WM)", "category": "WM Job"},
    {"key": "wm_job.adjuster_phone", "label": "Adjuster Phone (WM)", "category": "WM Job"},
    {"key": "wm_job.adjuster_email", "label": "Adjuster Email (WM)", "category": "WM Job"},
    {"key": "wm_job.today", "label": "Today (Contract Date)", "category": "WM Job"},
    # Meta fields
    {"key": "meta.current_date", "label": "Current Date", "category": "Meta"},
    {"key": "meta.contract_number", "label": "Contract Number", "category": "Meta"},
    # Custom fields (user-defined input fields)
    {"key": "custom.field_1", "label": "Custom Field 1", "category": "Custom"},
    {"key": "custom.field_2", "label": "Custom Field 2", "category": "Custom"},
    {"key": "custom.field_3", "label": "Custom Field 3", "category": "Custom"},
    {"key": "custom.field_4", "label": "Custom Field 4", "category": "Custom"},
    {"key": "custom.field_5", "label": "Custom Field 5", "category": "Custom"},
    {"key": "custom.field_6", "label": "Custom Field 6", "category": "Custom"},
    {"key": "custom.field_7", "label": "Custom Field 7", "category": "Custom"},
    {"key": "custom.field_8", "label": "Custom Field 8", "category": "Custom"},
    {"key": "custom.field_9", "label": "Custom Field 9", "category": "Custom"},
    {"key": "custom.field_10", "label": "Custom Field 10", "category": "Custom"},
    # Signature fields
    {"key": "signature.homeowner", "label": "Homeowner Signature", "category": "Signature"},
    {"key": "signature.company_rep", "label": "Company Rep Signature", "category": "Signature"},
    {"key": "signature.witness", "label": "Witness Signature", "category": "Signature"},
    {"key": "initial.homeowner", "label": "Homeowner Initials", "category": "Signature"},
    {"key": "initial.company_rep", "label": "Company Rep Initials", "category": "Signature"},
    {"key": "initial.witness", "label": "Witness Initials", "category": "Signature"},
    {"key": "date_signed.homeowner", "label": "Date Signed (Homeowner)", "category": "Signature"},
    {"key": "date_signed.company_rep", "label": "Date Signed (Company)", "category": "Signature"},
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

    def _annotate_file_availability(
        self, templates: List[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        """Add file_available flag to each template (local storage only)."""
        from app.core.config import settings
        storage = getattr(settings, "STORAGE_PROVIDER", "local")
        for t in templates:
            file_url = t.get("file_url") or ""
            if storage != "local":
                t["file_available"] = True
            elif file_url.startswith("/uploads/"):
                file_path = (
                    Path(__file__).resolve().parents[3]
                    / file_url.lstrip("/")
                )
                available = file_path.exists()
                if not available:
                    logger.warning(
                        f"Template '{t.get('name')}' ({t.get('id')}) "
                        f"references missing file: {file_path}"
                    )
                t["file_available"] = available
            else:
                t["file_available"] = bool(file_url)
        return templates

    def get_by_company(self, company_id: str) -> List[Dict[str, Any]]:
        try:
            session = self.database.get_readonly_session()
            try:
                repo = self._get_repository_instance(session)
                templates = repo.get_by_company(company_id)
                return self._annotate_file_availability(templates)
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
                templates = repo.get_all_with_company(**kwargs)
                return self._annotate_file_availability(templates)
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
        """Update field mappings on a template.

        Uses direct SQLAlchemy to avoid _prepare_sqlalchemy_data parsing
        the JSON string back into a Python object (breaks Text columns).
        """
        try:
            session = self.database.get_session()
            try:
                from app.domains.contract.models import ContractTemplate
                tmpl = session.query(ContractTemplate).filter(
                    ContractTemplate.id == template_id
                ).first()
                if not tmpl:
                    return None
                tmpl.field_mappings = json.dumps(field_mappings)
                session.flush()
                session.commit()
                repo = self._get_repository_instance(session)
                return repo._convert_to_dict(tmpl)
            finally:
                session.close()
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

    def append_audit_log(
        self,
        contract_id: str,
        action: str,
        ip: str = None,
        user_agent: str = None,
        detail: dict = None,
        actor_email: str = None,
        actor_name: str = None,
    ):
        """Append an event to the contract's audit_log JSON array.
        Actions: created, emailed, reminder_sent, viewed, email_viewed,
                 signer_name_entered, signed, agreement_completed, voided,
                 sent_copy
        """
        try:
            session = self.database.get_session()
            try:
                repo = self._get_repository_instance(session)
                contract = repo.get_by_id_enriched(contract_id)
                if not contract:
                    return

                raw = contract.get('audit_log')
                log = []
                if raw:
                    if isinstance(raw, str):
                        log = json.loads(raw)
                    elif isinstance(raw, list):
                        log = raw

                entry = {
                    'action': action,
                    'timestamp': datetime.utcnow().isoformat(),
                    'ip': ip,
                    'user_agent': (user_agent or '')[:200] if user_agent else None,
                    'detail': detail,
                }
                if actor_email:
                    entry['actor_email'] = actor_email
                if actor_name:
                    entry['actor_name'] = actor_name

                log.append(entry)

                repo.update(contract_id, {
                    'audit_log': json.dumps(log),
                })
                session.commit()
            finally:
                session.close()
        except Exception as e:
            logger.warning(f"Failed to append audit log: {e}")

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

                # Add meta fields early (current_date, contract_number updated after creation)
                prefill['meta'] = prefill.get('meta', {})
                prefill['meta']['current_date'] = datetime.utcnow().strftime('%m/%d/%Y')

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

                # Update meta with contract_number and persist
                prefill['meta']['contract_number'] = result.get('contract_number', '')
                repo.update(str(result['id']), {'prefill_data': json.dumps(prefill)})
                session.commit()

                # Generate filled PDF if template has field mappings
                if tmpl and tmpl.field_mappings:
                    try:
                        mappings = json.loads(tmpl.field_mappings)
                        if mappings:
                            filled_url = self._generate_filled_pdf(
                                tmpl.file_url, mappings, prefill
                            )
                            if filled_url:
                                repo.update(str(result['id']), {'filled_pdf_url': filled_url})
                                session.commit()
                                result['filled_pdf_url'] = filled_url
                    except Exception as e:
                        logger.warning(f"Failed to generate filled PDF: {e}")

                # Audit: document created
                try:
                    company_name = result.get('company_name', '')
                    company_email = result.get('company_email', '')
                    self.append_audit_log(
                        str(result['id']),
                        action='created',
                        actor_email=company_email,
                        actor_name=company_name,
                        detail={
                            'title': result.get('title', ''),
                            'template_name': result.get('template_name', ''),
                        },
                    )
                except Exception as e:
                    logger.warning(f"Failed to log contract creation: {e}")

                return result
            finally:
                session.close()
        except Exception as e:
            logger.error(f"Error creating contract: {e}")
            raise

    def _build_prefill(self, session, data: Dict[str, Any]) -> Dict[str, Any]:
        """Capture client/claim/company info at time of contract generation"""
        prefill = {}
        from app.domains.client.models import Client, Claim
        from app.domains.company.models import Company

        def _safe(obj, attr):
            return getattr(obj, attr, None)

        def _safe_str(obj, attr):
            v = getattr(obj, attr, None)
            return str(v) if v is not None else None

        # Client
        try:
            client_id = data.get('client_id')
            if client_id:
                client = session.query(Client).filter(
                    Client.id == client_id
                ).first()
                if client:
                    addr = _safe(client, 'address') or ''
                    city = _safe(client, 'city') or ''
                    state = _safe(client, 'state') or ''
                    zipcode = _safe(client, 'zipcode') or ''
                    prefill['client'] = {
                        'display_name': _safe(client, 'display_name'),
                        'address': addr,
                        'city': city,
                        'state': state,
                        'zipcode': zipcode,
                        'phone': _safe(client, 'phone'),
                        'email': _safe(client, 'email'),
                        'full_address': f"{addr}, {city}, {state} {zipcode}".strip(', '),
                    }
        except Exception as e:
            logger.warning(f"Error building client prefill: {e}")

        # Claim
        try:
            claim_id = data.get('claim_id')
            if claim_id:
                claim = session.query(Claim).filter(
                    Claim.id == claim_id
                ).first()
                if claim:
                    dol = _safe(claim, 'date_of_loss')
                    ded = (
                        _safe(claim, 'insurance_deductible')
                        or _safe(claim, 'deductible')
                    )
                    def _fmt(dt):
                        if not dt:
                            return None
                        if hasattr(dt, 'strftime'):
                            return dt.strftime('%m/%d/%Y')
                        return str(dt).split(' ')[0].split('T')[0]

                    prefill['claim'] = {
                        'claim_number': _safe(claim, 'claim_number'),
                        'insurance_company': _safe(claim, 'insurance_company'),
                        'insurance_policy_number': _safe(claim, 'insurance_policy_number'),
                        'date_of_loss': _fmt(dol),
                        'loss_description': _safe(claim, 'loss_description'),
                        'adjuster_name': _safe(claim, 'adjuster_name'),
                        'adjuster_phone': _safe(claim, 'adjuster_phone'),
                        'adjuster_email': _safe(claim, 'adjuster_email'),
                        'deductible': str(ded) if ded else None,
                    }
        except Exception as e:
            logger.warning(f"Error building claim prefill: {e}")

        # Company
        try:
            company_id = data.get('company_id')
            if company_id:
                company = session.query(Company).filter(
                    Company.id == company_id
                ).first()
                if company:
                    prefill['company'] = {
                        'name': _safe(company, 'name'),
                        'address': _safe(company, 'address'),
                        'phone': _safe(company, 'phone'),
                        'email': _safe(company, 'email'),
                        'license_number': _safe(company, 'license_number'),
                    }
        except Exception as e:
            logger.warning(f"Error building company prefill: {e}")

        # WM Job data
        try:
            wm_job_id = data.get('wm_job_id')
            if wm_job_id:
                self._add_wm_prefill(session, prefill, wm_job_id)
        except Exception as e:
            logger.warning(f"Error building WM job prefill: {e}")

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

            # Fallback: populate client from WM job if not already set
            if 'client' not in prefill:
                addr = job.property_address or ''
                city = getattr(job, 'property_city', '') or ''
                state = getattr(job, 'property_state', '') or ''
                zipcode = getattr(job, 'property_zipcode', '') or ''
                prefill['client'] = {
                    'display_name': job.homeowner_name,
                    'address': addr,
                    'city': city,
                    'state': state,
                    'zipcode': zipcode,
                    'phone': job.homeowner_phone,
                    'email': job.homeowner_email,
                    'full_address': f"{addr}, {city}, {state} {zipcode}".strip(', '),
                }

            # Fallback: populate claim from WM job if not already set
            if 'claim' not in prefill:
                prefill['claim'] = {
                    'claim_number': job.claim_number,
                    'insurance_company': job.insurance_company,
                    'insurance_policy_number': job.insurance_policy_number,
                    'date_of_loss': fmt_date(dol),
                    'adjuster_name': job.adjuster_name,
                    'adjuster_phone': job.adjuster_phone,
                    'adjuster_email': job.adjuster_email,
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
            from pypdf import PdfReader, PdfWriter
            from reportlab.pdfgen import canvas as rl_canvas

            # Resolve template file — try cloud storage first, then local
            import tempfile
            temp_template_path = None
            template_path = None

            # Try cloud storage download
            if not template_file_url.startswith('/uploads/'):
                try:
                    from app.domains.storage.factory import StorageFactory
                    storage = StorageFactory.get_instance()
                    file_bytes = storage.download(template_file_url)
                    with tempfile.NamedTemporaryFile(
                        suffix='.pdf', delete=False
                    ) as tmp:
                        tmp.write(file_bytes)
                        temp_template_path = tmp.name
                    template_path = temp_template_path
                except Exception as dl_err:
                    logger.debug(
                        f"Cloud download failed for template, "
                        f"trying local: {dl_err}"
                    )

            # Fallback to local file
            if not template_path:
                backend_dir = Path(__file__).resolve().parents[3]
                if template_file_url.startswith('/uploads/'):
                    local_path = backend_dir / template_file_url.lstrip('/')
                else:
                    local_path = Path(template_file_url)
                if local_path.exists():
                    template_path = str(local_path)

            if not template_path:
                logger.warning(
                    f"Template PDF not found: {template_file_url}"
                )
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
                        # Skip signer-editable fields — they remain blank for signer to fill
                        if field.get('inputMode') == 'signer':
                            continue
                        value = self._resolve_field_value(prefill, field.get('fieldKey', ''))
                        if not value:
                            continue

                        # Convert ratio (0-1) to PDF points
                        fx = field.get('x', 0) * page_width
                        fw = field.get('width', 0.25) * page_width
                        fh = field.get('height', 0.03) * page_height
                        # PDF coordinate system: origin at bottom-left
                        fy = page_height - (field.get('y', 0) * page_height) - fh
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

                        # Auto-shrink font to fit within field width
                        from reportlab.pdfbase.pdfmetrics import stringWidth
                        usable_w = fw - 4  # 2pt padding each side
                        actual_size = font_size
                        while actual_size > 5:
                            tw = stringWidth(value, "Helvetica", actual_size)
                            if tw <= usable_w:
                                break
                            actual_size -= 0.5

                        c.setFont("Helvetica", actual_size)
                        # Vertically center text within field
                        text_y = fy + (fh - actual_size) / 2
                        c.drawString(fx + 2, text_y, value)

                    c.save()
                    overlay_buffer.seek(0)

                    # Merge overlay onto page
                    overlay_reader = PdfReader(overlay_buffer)
                    if overlay_reader.pages:
                        page.merge_page(overlay_reader.pages[0])

                writer.add_page(page)

            # Write to buffer and upload to cloud storage
            from io import BytesIO
            pdf_buffer = BytesIO()
            writer.write(pdf_buffer)
            pdf_bytes = pdf_buffer.getvalue()

            from app.common.utils.storage_helpers import upload_bytes_to_storage
            filled_name = f"filled_{uuid.uuid4()}.pdf"
            storage_info = upload_bytes_to_storage(
                file_bytes=pdf_bytes,
                filename=filled_name,
                context="contracts",
                context_id=str(uuid.uuid4()),
                category="filled",
            )

            # Clean up temp template file
            if temp_template_path:
                try:
                    Path(temp_template_path).unlink(missing_ok=True)
                except Exception:
                    pass

            return storage_info["file_path"]

        except Exception as e:
            logger.error(f"Error generating filled PDF: {e}")
            # Clean up temp template file on error
            if temp_template_path:
                try:
                    Path(temp_template_path).unlink(missing_ok=True)
                except Exception:
                    pass
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

    def get_contracts_by_company_for_field(self, company_id: str) -> List[Dict[str, Any]]:
        """Get contract instances for field signing by company"""
        try:
            session = self.database.get_readonly_session()
            try:
                repo = self._get_repository_instance(session)
                return repo.get_contracts_by_company_for_field(company_id)
            finally:
                session.close()
        except Exception as e:
            logger.error(f"Error getting contracts for field: {e}")
            raise

    def create_field_contract(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Create a contract instance for field signing (no claim/client required)."""
        try:
            expires_days = data.pop('token_expires_days', 30)

            session = self.database.get_session()
            try:
                # Build company prefill only
                prefill = {}
                from app.domains.company.models import Company
                company_id = data.get('company_id')
                if company_id:
                    company = session.query(Company).filter(Company.id == company_id).first()
                    if company:
                        prefill['company'] = {
                            'name': getattr(company, 'name', None),
                            'address': getattr(company, 'address', None),
                            'phone': getattr(company, 'phone', None),
                            'email': getattr(company, 'email', None),
                            'license_number': getattr(company, 'license_number', None),
                        }

                prefill['meta'] = {
                    'current_date': datetime.utcnow().strftime('%m/%d/%Y'),
                    'contract_number': '(auto)',
                }

                data['prefill_data'] = json.dumps(prefill)

                # Set title from template if not provided
                from app.domains.contract.models import ContractTemplate
                tmpl = session.query(ContractTemplate).filter(
                    ContractTemplate.id == data.get('template_id')
                ).first()
                if not tmpl:
                    raise ValueError("Template not found")
                if not data.get('title'):
                    data['title'] = tmpl.name

                repo = self._get_repository_instance(session)
                result = repo.create_with_token(data, expires_days)

                # Update contract_number in prefill meta
                prefill['meta']['contract_number'] = result.get('contract_number', '')
                repo.update(str(result['id']), {'prefill_data': json.dumps(prefill)})
                session.commit()

                # Audit: field contract created
                try:
                    company_name = result.get('company_name', '')
                    company_email = result.get('company_email', '')
                    self.append_audit_log(
                        str(result['id']),
                        action='created',
                        actor_email=company_email,
                        actor_name=company_name,
                        detail={
                            'title': result.get('title', ''),
                            'source': 'field_signing',
                        },
                    )
                except Exception as e:
                    logger.warning(
                        f"Failed to log field contract creation: {e}"
                    )

                return result
            finally:
                session.close()
        except Exception as e:
            logger.error(f"Error creating field contract: {e}")
            raise

    def update_prefill_and_regenerate(self, token: str, new_prefill_data: Dict[str, Any]) -> Dict[str, Any]:
        """Update prefill data on a contract and regenerate the filled PDF."""
        try:
            session = self.database.get_session()
            try:
                repo = self._get_repository_instance(session)
                contract = repo.get_by_token(token)
                if not contract:
                    raise ValueError("Contract not found")
                if contract.get('status') in ('signed', 'voided'):
                    raise ValueError("Cannot update a signed or voided contract")

                instance_id = str(contract['id'])

                # Parse existing prefill
                existing_raw = contract.get('prefill_data')
                existing = {}
                if existing_raw:
                    if isinstance(existing_raw, str):
                        existing = json.loads(existing_raw)
                    elif isinstance(existing_raw, dict):
                        existing = existing_raw

                # Deep merge: new values override existing per category
                for category, fields in new_prefill_data.items():
                    if isinstance(fields, dict):
                        if category in existing and isinstance(existing[category], dict):
                            existing[category].update(fields)
                        else:
                            existing[category] = fields

                # Ensure meta fields
                existing.setdefault('meta', {})
                existing['meta']['current_date'] = datetime.utcnow().strftime('%m/%d/%Y')
                existing['meta']['contract_number'] = contract.get('contract_number', '')

                # Save updated prefill
                repo.update(instance_id, {
                    'prefill_data': json.dumps(existing),
                })
                session.commit()

                # Regenerate filled PDF
                template_file_url = contract.get('file_url')
                raw_mappings = contract.get('field_mappings')
                if template_file_url and raw_mappings:
                    mappings = raw_mappings
                    if isinstance(raw_mappings, str):
                        mappings = json.loads(raw_mappings)
                    if mappings:
                        filled_url = self._generate_filled_pdf(
                            template_file_url, mappings, existing
                        )
                        if filled_url:
                            repo.update(instance_id, {'filled_pdf_url': filled_url})
                            session.commit()

                return repo.get_by_id_enriched(instance_id)
            finally:
                session.close()
        except Exception as e:
            logger.error(f"Error updating prefill: {e}")
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

    def sign_contract(
        self, token: str, sig_data: Dict[str, Any],
        signature_fields: Optional[Dict[str, str]] = None,
    ) -> Dict[str, Any]:
        """Add signature to contract via public token.
        If signature_fields is provided, generate a signed PDF
        with signatures overlaid at mapped positions.
        """
        try:
            session = self.database.get_session()
            try:
                repo = self._get_repository_instance(session)
                contract = repo.get_by_token(token)
                if not contract:
                    raise ValueError("Contract not found")
                if contract['status'] == 'voided':
                    raise ValueError("Contract has been voided")

                # Check token expiry (timezone-safe)
                expires = contract.get('token_expires_at')
                if expires:
                    if isinstance(expires, str):
                        expires = datetime.fromisoformat(expires)
                    if hasattr(expires, 'tzinfo') and expires.tzinfo:
                        expires = expires.replace(tzinfo=None)
                    if datetime.utcnow() > expires:
                        raise ValueError("Signing link has expired")

                instance_id = str(contract['id'])
                result = repo.add_signature(instance_id, sig_data)

                # Generate signed PDF with overlaid signatures
                if signature_fields:
                    try:
                        signed_url = self._generate_signed_pdf(
                            session, contract, signature_fields
                        )
                        if signed_url:
                            # Compute document hash
                            doc_hash = self._compute_pdf_hash(
                                signed_url
                            )
                            repo.update(instance_id, {
                                'signed_pdf_url': signed_url,
                                'filled_pdf_url': signed_url,
                            })
                            # Store hash on the signature
                            if doc_hash:
                                sig_id = result.get('id')
                                if sig_id:
                                    from app.domains.contract.models import (
                                        ContractSignature,
                                    )
                                    sig = session.query(
                                        ContractSignature
                                    ).filter(
                                        ContractSignature.id == sig_id
                                    ).first()
                                    if sig:
                                        sig.document_hash = doc_hash
                            session.commit()
                    except Exception as e:
                        logger.warning(
                            f"Failed to generate signed PDF: {e}"
                        )

                return result
            finally:
                session.close()
        except Exception as e:
            logger.error(f"Error signing contract: {e}")
            raise

    def _generate_signed_pdf(
        self, session, contract: Dict[str, Any],
        signature_fields: Dict[str, str],
    ) -> Optional[str]:
        """Overlay signature images onto the PDF at mapped
        field positions and upload the result."""
        import base64
        from io import BytesIO
        from pathlib import Path

        from pypdf import PdfReader, PdfWriter
        from reportlab.lib.utils import ImageReader
        from reportlab.pdfgen import canvas as rl_canvas

        # Get field mappings from template
        raw_mappings = contract.get('field_mappings')
        if not raw_mappings:
            return None
        mappings = raw_mappings
        if isinstance(raw_mappings, str):
            mappings = json.loads(raw_mappings)

        # Build lookup: field_id -> mapping
        field_map = {m.get('id'): m for m in mappings}

        # Resolve source PDF (prefer filled, fallback to template)
        has_filled = bool(contract.get('filled_pdf_url'))
        pdf_url = (
            contract.get('filled_pdf_url')
            or contract.get('file_url')
        )
        if not pdf_url:
            return None

        # Download the PDF
        try:
            from app.domains.storage.factory import StorageFactory
            storage = StorageFactory.get_instance()
            pdf_bytes = storage.download(pdf_url)
        except Exception:
            # Fallback to local
            backend_dir = Path(__file__).resolve().parents[3]
            if pdf_url.startswith('/uploads/'):
                local = backend_dir / pdf_url.lstrip('/')
            else:
                local = Path(pdf_url)
            if not local.exists():
                return None
            pdf_bytes = local.read_bytes()

        # If no filled PDF, also overlay text fields from prefill_data
        prefill = {}
        if not has_filled:
            raw_prefill = contract.get('prefill_data')
            if raw_prefill:
                if isinstance(raw_prefill, str):
                    try:
                        prefill = json.loads(raw_prefill)
                    except Exception:
                        pass
                elif isinstance(raw_prefill, dict):
                    prefill = raw_prefill

        # Group text fields by page (only when no filled PDF)
        page_texts: Dict[int, list] = {}
        if not has_filled and prefill:
            sig_prefixes = ('signature.', 'initial.', 'date_signed.')
            for m in mappings:
                fk = m.get('fieldKey', '')
                if any(fk.startswith(p) for p in sig_prefixes):
                    continue
                value = self._resolve_field_value(prefill, fk)
                if not value:
                    continue
                pg = m.get('pageIndex', 0)
                page_texts.setdefault(pg, []).append((m, value))

        reader = PdfReader(BytesIO(pdf_bytes))
        writer = PdfWriter()

        # Group signature fields by page
        page_sigs: Dict[int, list] = {}
        for field_id, img_data in signature_fields.items():
            mapping = field_map.get(field_id)
            if not mapping:
                continue
            pg = mapping.get('pageIndex', 0)
            if pg not in page_sigs:
                page_sigs[pg] = []
            page_sigs[pg].append((mapping, img_data))

        for page_num in range(len(reader.pages)):
            page = reader.pages[page_num]
            page_box = page.mediabox
            pw = float(page_box.width)
            ph = float(page_box.height)

            texts_on_page = page_texts.get(page_num, [])
            sigs_on_page = page_sigs.get(page_num, [])
            if texts_on_page or sigs_on_page:
                overlay_buf = BytesIO()
                c = rl_canvas.Canvas(overlay_buf, pagesize=(pw, ph))

                # Overlay text fields first
                from reportlab.pdfbase.pdfmetrics import stringWidth
                for m, value in texts_on_page:
                    fx = m.get('x', 0) * pw
                    fw = m.get('width', 0.25) * pw
                    fh = m.get('height', 0.03) * ph
                    fy = ph - (m.get('y', 0) * ph) - fh
                    fs = m.get('fontSize', 12)
                    fc = m.get('fontColor', '#000000')
                    try:
                        r = int(fc[1:3], 16) / 255
                        g = int(fc[3:5], 16) / 255
                        b = int(fc[5:7], 16) / 255
                        c.setFillColorRGB(r, g, b)
                    except Exception:
                        c.setFillColorRGB(0, 0, 0)
                    usable = fw - 4
                    sz = fs
                    while sz > 5:
                        if stringWidth(value, "Helvetica", sz) <= usable:
                            break
                        sz -= 0.5
                    c.setFont("Helvetica", sz)
                    ty = fy + (fh - sz) / 2
                    c.drawString(fx + 2, ty, value)

                for mapping, img_data in sigs_on_page:
                    fx = mapping.get('x', 0) * pw
                    fy_top = mapping.get('y', 0) * ph
                    fw = mapping.get('width', 0.2) * pw
                    fh = mapping.get('height', 0.06) * ph
                    # PDF coords: origin bottom-left
                    fy = ph - fy_top - fh

                    fk = mapping.get('fieldKey', '')
                    is_date = fk.startswith('date_signed.')

                    if is_date:
                        # Render date text
                        font_size = min(fh * 0.7, 14)
                        c.setFont("Helvetica", font_size)
                        c.setFillColorRGB(0, 0, 0)
                        text_y = fy + (fh - font_size) / 2
                        c.drawString(fx + 2, text_y, img_data)
                    else:
                        # Render signature/initial image
                        try:
                            if img_data.startswith('data:'):
                                img_data = img_data.split(',', 1)[1]
                            img_bytes = base64.b64decode(img_data)
                            img_reader = ImageReader(
                                BytesIO(img_bytes)
                            )
                            c.drawImage(
                                img_reader, fx, fy, fw, fh,
                                mask='auto',
                                preserveAspectRatio=True,
                                anchor='c',
                            )
                        except Exception as e:
                            logger.warning(
                                f"Failed to overlay signature "
                                f"image: {e}"
                            )

                c.save()
                overlay_buf.seek(0)
                overlay_reader = PdfReader(overlay_buf)
                if overlay_reader.pages:
                    page.merge_page(overlay_reader.pages[0])

            writer.add_page(page)

        # Write and upload
        out_buf = BytesIO()
        writer.write(out_buf)
        signed_bytes = out_buf.getvalue()

        from app.common.utils.storage_helpers import (
            upload_bytes_to_storage,
        )
        storage_info = upload_bytes_to_storage(
            file_bytes=signed_bytes,
            filename=f"signed_{uuid.uuid4()}.pdf",
            context="contracts",
            context_id=str(contract.get('id', uuid.uuid4())),
            category="signed",
        )
        return storage_info["file_path"]

    def _compute_pdf_hash(self, pdf_url: str) -> Optional[str]:
        """Compute SHA-256 hash of a PDF for integrity."""
        import hashlib
        try:
            from app.domains.storage.factory import (
                StorageFactory,
            )
            storage = StorageFactory.get_instance()
            pdf_bytes = storage.download(pdf_url)
            return hashlib.sha256(pdf_bytes).hexdigest()
        except Exception as e:
            logger.warning(
                f"Failed to compute PDF hash: {e}"
            )
            return None

    def void_contract(self, instance_id: str) -> Optional[Dict[str, Any]]:
        try:
            result = self.update(instance_id, {
                'status': 'voided',
                'voided_at': datetime.utcnow(),
            })
            # Audit: contract voided
            try:
                self.append_audit_log(
                    instance_id,
                    action='voided',
                    detail={'reason': 'Voided by admin'},
                )
            except Exception:
                pass
            return result
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
