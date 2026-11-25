"""
Rebuild domain service.
"""

import base64
import json
import logging
import uuid
from datetime import datetime, timezone
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
                result['wm_jobs'] = self._claim_wm_jobs(session, result.get('claim_id'))
                result['wm_companies'] = self._claim_wm_companies(session, result.get('claim_id'))
            return result
        finally:
            session.close()

    @staticmethod
    def _claim_wm_companies(session, claim_id) -> List[Dict[str, Any]]:
        """The companies that did the claim's water mitigation (its WM jobs'
        companies and any company on the claim in the WM role), by name"""
        from app.domains.client.claim_paths import company_names, wm_company_ids

        if not claim_id:
            return []
        # Shown for reference only: a failed lookup leaves the row out rather
        # than the whole project page
        try:
            names = company_names(session, wm_company_ids(session, str(claim_id)))
        except Exception:
            logger.exception("Rebuild project: WM companies lookup failed for claim %s", claim_id)
            session.rollback()
            return []
        return sorted(
            ({'id': cid, 'name': name} for cid, name in names.items() if name),
            key=lambda c: c['name'].lower(),
        )

    @staticmethod
    def _claim_wm_jobs(session, claim_id) -> List[Dict[str, Any]]:
        """The claim's water mitigation jobs, oldest first, as the client page
        lists them: each is one of the claim's photo sets"""
        from app.domains.company.models import Company
        from app.domains.water_mitigation.models import WaterMitigationJob

        if not claim_id:
            return []
        rows = session.query(WaterMitigationJob, Company.name).outerjoin(
            Company, WaterMitigationJob.company_id == Company.id
        ).filter(
            WaterMitigationJob.claim_id == str(claim_id)
        ).order_by(WaterMitigationJob.created_at).all()
        return [{
            'id': str(job.id),
            'property_address': job.property_address,
            'company_name': company_name,
            'companycam_project_id': job.companycam_project_id,
        } for job, company_name in rows]

    def get_projects(self, params: Dict[str, Any], scope: Any = None) -> Tuple[List[Dict[str, Any]], int]:
        """scope: company condition from auth.company_scope (None = all)"""
        session = self._rs()
        try:
            from app.domains.rebuild.repository import get_project_repository
            items, total = get_project_repository(session).get_with_filters(**params, scope=scope)
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

    def get_dashboard_stats(self, scope: Any = None) -> Dict[str, Any]:
        session = self._rs()
        try:
            from app.domains.rebuild.repository import get_project_repository
            return get_project_repository(session).get_dashboard_stats(scope)
        finally:
            session.close()

    # ============================================================
    # Scope of work from the insurance estimate
    # ============================================================

    @staticmethod
    def _estimate_label(neg) -> str:
        def words(v):
            return (v or '').replace('_', ' ').strip().capitalize()
        parts = [f"Rev #{neg.revision_number}", words(neg.revision_type or 'initial')]
        if neg.estimate_category:
            parts.append(words(neg.estimate_category))
        return ' · '.join(p for p in parts if p)

    @staticmethod
    def _estimate_file(session, neg, claim_id: str):
        """The revision's PDF: its own file, else the claim's newest uploaded
        estimate (the same fallback the estimate list shows it with)"""
        from app.domains.file.models import File

        if neg.document_url:
            rec = session.query(File).filter(
                File.id == str(neg.document_url), File.is_active == True  # noqa: E712
            ).first()
            if rec:
                return rec
        return (
            session.query(File)
            .filter(
                File.context == 'negotiation',
                File.context_id == str(claim_id),
                File.category == 'insurance_estimate',
                File.is_active == True,  # noqa: E712
            )
            .order_by(File.created_at.desc())
            .first()
        )

    def draft_scope_from_estimate(self, project_id: str, negotiation_id: Optional[str] = None) -> Dict[str, Any]:
        """A rough scope of work read from one of the claim's insurance
        estimate PDFs: the one named, else the newest rebuild estimate (the
        one the project page opens on). Nothing is saved; the office edits
        the draft and saves it on the project with its source.

        Raises LookupError when there is no estimate to read, ValueError
        when its PDF has no lines that could be read."""
        from app.domains.client.models import ClaimNegotiation
        from app.domains.insurance_extraction.parsers.xactimate_reference_parser import (
            count_line_items,
            parse_estimate,
            parse_estimate_pages,
        )
        from app.domains.insurance_extraction.service import InsuranceExtractionService
        from app.domains.rebuild.models import RebuildProject
        from app.domains.rebuild.scope_summary import summarize_estimate

        session = self._rs()
        try:
            project = session.query(RebuildProject).filter(RebuildProject.id == str(project_id)).first()
            if not project:
                raise LookupError("Project not found")
            claim_id = str(project.claim_id)
            negotiations = session.query(ClaimNegotiation).filter(
                ClaimNegotiation.claim_id == claim_id
            ).all()

            if negotiation_id:
                neg = next((n for n in negotiations if str(n.id) == str(negotiation_id)), None)
                if not neg:
                    raise LookupError("That estimate is not on this project's claim")
                file_rec = self._estimate_file(session, neg, claim_id)
            else:
                def received(n):
                    when = n.date_received or n.created_at
                    return when.timestamp() if when else 0
                # Newest first; a rebuild (non-WM) estimate before a WM-only one
                ordered = sorted(negotiations, key=received, reverse=True)
                ordered = (
                    [n for n in ordered if n.estimate_category != 'water_mitigation']
                    + [n for n in ordered if n.estimate_category == 'water_mitigation']
                )
                neg, file_rec = None, None
                for n in ordered:
                    file_rec = self._estimate_file(session, n, claim_id)
                    if file_rec:
                        neg = n
                        break
                if not neg:
                    raise LookupError("No insurance estimate PDF on this claim yet")
            if not file_rec:
                raise LookupError("This estimate has no PDF attached")

            pdf_path, tmp_path = InsuranceExtractionService(session)._resolve_pdf_path(
                file_rec.url, file_rec.storage_provider
            )
            try:
                parsed = parse_estimate(pdf_path)
                if not count_line_items(parsed):
                    # Some estimates print in a font pdfplumber reads as symbols
                    # (each character at 288 minus its code); the revised
                    # estimate reader gets their text back
                    from app.domains.client.negotiation_pdf_service import _extract_all_text

                    pages, legible = _extract_all_text(pdf_path)
                    if legible:
                        parsed = parse_estimate_pages(pages)
            finally:
                if tmp_path:
                    try:
                        Path(tmp_path).unlink()
                    except OSError:
                        pass

            summary = summarize_estimate(parsed)
            if not summary['areas']:
                label = self._estimate_label(neg)
                logger.warning(
                    f"Scope draft for project {project_id}: {summary['line_count']} lines read from "
                    f"{label} (negotiation {neg.id}), {summary['skipped_count']} left out"
                )
                if summary['line_count']:
                    raise ValueError(
                        f"No rebuild work in {label}: every line is water mitigation or what every job has "
                        "(contents, protection, debris, cleaning, supervision, permits). "
                        "Pick the reconstruction estimate above."
                    )
                raise ValueError(
                    f"No line items could be read from {label}'s PDF (a scanned PDF, or a layout the "
                    "reader doesn't know). Write the scope by hand from the PDF on the right."
                )
            summary['source'] = {
                'negotiation_id': str(neg.id),
                'label': self._estimate_label(neg),
                'document_name': neg.document_name or file_rec.original_name,
                'drafted_at': datetime.now(timezone.utc).isoformat(),
            }
            return summary
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
                item['client_id'] = str(claim.client_id) if claim.client_id else None
                item['client_name'] = session.query(Client.display_name).filter(
                    Client.id == claim.client_id
                ).scalar()
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

    def generate_document(self, project_id: str, data: Dict[str, Any], staff_id: Any = None) -> Dict[str, Any]:
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
            # Or the client's signature on file, applied by the office:
            signature_on_file: bool,
            authorized: bool,  # the person confirmed the client allowed it
            authorization_text: str,
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

            mappings = self._parse_mappings(template.field_mappings)
            signing = {
                'signature_image': data.get('signature_image'),
                'signature_name': data.get('signature_name'),
                'signature_field_key': data.get('signature_field_key'),
            }
            on_file = None
            if data.get('signature_on_file'):
                on_file = self._signature_on_file(session, project, mappings, data)
                signing = on_file['signing']

            filled_pdf_url = self._generate_filled_pdf(
                project_id, template, mappings, prefill,
                additional_text=data.get('additional_text'),
                **signing,
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
            if staff_id:
                doc_data['created_by_id'] = staff_id
            result = get_completion_doc_repository(session).create(doc_data)
            if on_file:
                self._log_signed_on_file(session, project, on_file, doc_data['title'], result, staff_id)
            session.commit()
            return result
        except Exception as e:
            session.rollback()
            logger.error(f"Error generating document: {e}")
            raise
        finally:
            session.close()

    def _signature_on_file(self, session, project, mappings: list, data: Dict[str, Any]) -> Dict[str, Any]:
        """The client's signature (and initials) on file, for the client's own
        boxes, put on by the office with the client not there (the user's
        choice, as on contracts). The stored images are used, never one sent
        from the browser. ValueError says why it can't be done."""
        from app.domains.client import client_signatures
        from app.domains.client.models import Claim
        from app.domains.contract.signature_on_file import CUSTOMER_ROLE

        if not data.get('authorized'):
            raise ValueError("Confirm the client allowed us to use their signature on file")
        claim = session.query(Claim).filter(Claim.id == project.claim_id).first()
        if not claim or not claim.client_id:
            raise ValueError("This project's claim has no client")
        kept = client_signatures.on_file(session, claim.client_id)
        signature = kept.get('signature')
        if not signature:
            raise ValueError("This client has no signature on file")

        # A template with signature boxes takes it in the client's; one with
        # none takes it at the bottom of the last page, as a drawn one does
        sig_keys = {m.get('fieldKey') for m in mappings if (m.get('fieldKey') or '').startswith('signature.')}
        target = f'signature.{CUSTOMER_ROLE}'
        if sig_keys and target not in sig_keys:
            raise ValueError("This template has no line for the client's signature")
        initial = kept.get('initial')
        signer = signature.signer_name or 'The client'
        return {
            'signing': {
                'signature_image': signature.image,
                'signature_name': signature.signer_name,
                'signature_field_key': target if sig_keys else None,
                'initial_image': initial.image if initial else None,
            },
            'signer': signer,
            'authorization_text': (data.get('authorization_text') or '').strip()
            or f"{signer} allowed us to sign this document with their signature on file.",
        }

    @staticmethod
    def _log_signed_on_file(session, project, on_file: Dict[str, Any], title: str,
                            doc: Dict[str, Any], staff_id: Any) -> None:
        """The claim's activity log says who put the client's signature on file
        on which document, with what they confirmed"""
        from app.domains.client import client_signatures
        from app.domains.client.models import ClaimActivity

        applied_by = (client_signatures.staff_name(session, staff_id) if staff_id else None) or 'Staff'
        session.add(ClaimActivity(
            claim_id=project.claim_id,
            activity_type='signed_on_file',
            title=f"{title} signed with {on_file['signer']}'s signature on file"[:500],
            description=f"{applied_by} applied it. {on_file['authorization_text']}",
            related_entity_type='rebuild_project',
            related_entity_id=project.id,
            created_by_id=staff_id,
        ))
        logger.info(f"Rebuild doc {doc.get('id')} on project {project.id} signed with the signature on file by {staff_id}")

    # A photo page: the photo's long side and JPEG quality. 1600px fills a
    # letter page at about 170 dpi and keeps a 100-page PDF to some 40MB, on a
    # server with 512MB in all.
    PDF_PHOTO_PX = 1600
    PDF_PHOTO_QUALITY = 85
    MAX_PDF_PHOTOS = 100
    # Completion photos go two to a page, one above the other. A photo of a
    # paper document (COC, invoice...) keeps a page to itself so it stays readable.
    PHOTOS_PER_PAGE = {'completion_photo': 2}

    @staticmethod
    def _photo_pdf_address(session, project) -> str:
        """The property's address as one line: the project's, else its claim's client's"""
        address = (project.property_address or '').strip()
        if address:
            return address
        from app.domains.client.models import Claim
        from app.domains.rebuild.auto_create import claim_property_address

        claim = session.query(Claim).filter(Claim.id == project.claim_id).first()
        return (claim_property_address(session, claim) if claim else '').strip()

    @staticmethod
    def _photo_pdf_file_name(address: str, title: str) -> str:
        """"123 Main St, Springfield, IL 62701 - Completion Photos.pdf": the name
        it downloads and attaches as. What a file name can't hold is dropped."""
        import re

        def clean(text: str) -> str:
            text = re.sub(r'[\\/:*?"<>|\x00-\x1f]', ' ', text or '')
            return re.sub(r'\s+', ' ', text).strip(' .')

        stem = ' - '.join(p for p in (clean(address), clean(title)) if p) or 'Photos'
        return f"{stem[:150].rstrip(' .')}.pdf"

    @staticmethod
    def _photo_page_frame(c, address: str, title: str, page_no: int, page_count: int) -> None:
        """A photo page's header (the address, the document's title on the right)
        and footer (page n of N)"""
        from reportlab.lib.colors import HexColor
        from reportlab.lib.pagesizes import letter
        from reportlab.pdfbase.pdfmetrics import stringWidth

        page_w, page_h = letter
        left, right = 36, page_w - 36

        def fit(text: str, font: str, size: float, width: float) -> str:
            if stringWidth(text, font, size) <= width:
                return text
            while text and stringWidth(text + '…', font, size) > width:
                text = text[:-1]
            return text.rstrip() + '…'

        # No address: the title takes its place on the left
        lead, side = (address, title) if address else (title, '')
        side = fit(side, 'Helvetica', 9, (right - left) * 0.4) if side else ''
        side_w = stringWidth(side, 'Helvetica', 9) + 18 if side else 0
        baseline = page_h - 46
        c.setFillColor(HexColor('#1f2937'))
        c.setFont('Helvetica-Bold', 11)
        c.drawString(left, baseline, fit(lead, 'Helvetica-Bold', 11, right - left - side_w))
        if side:
            c.setFillColor(HexColor('#6b7280'))
            c.setFont('Helvetica', 9)
            c.drawRightString(right, baseline, side)
        c.setStrokeColor(HexColor('#d1d5db'))
        c.setLineWidth(0.5)
        c.line(left, page_h - 54, right, page_h - 54)

        c.setFillColor(HexColor('#6b7280'))
        c.setFont('Helvetica', 8)
        c.drawCentredString(page_w / 2, 28, f"Page {page_no} of {page_count}")

    @classmethod
    def _photo_page_jpeg(cls, photo_bytes: bytes, rotation: int):
        """One photo as the JPEG its page draws, upright as the browser showed
        it (EXIF orientation), then turned by the person's rotation"""
        from PIL import Image, ImageOps

        try:
            # iPhone HEIC uploads
            from pillow_heif import register_heif_opener
            register_heif_opener()
        except ImportError:  # pragma: no cover
            pass

        with Image.open(BytesIO(photo_bytes)) as opened:
            opened.draft('RGB', (cls.PDF_PHOTO_PX, cls.PDF_PHOTO_PX))  # JPEG: decode at a smaller scale
            img = ImageOps.exif_transpose(opened)
            if rotation:
                img = img.rotate(-rotation, expand=True)  # PIL turns counter-clockwise
            if img.mode != 'RGB':
                img = img.convert('RGB')
            img.thumbnail((cls.PDF_PHOTO_PX, cls.PDF_PHOTO_PX))
            out = BytesIO()
            img.save(out, format='JPEG', quality=cls.PDF_PHOTO_QUALITY, optimize=True)
            size = img.size
        out.seek(0)
        return out, size

    @staticmethod
    def photo_pdf_layout(rooms: List[str], per_page: int) -> List[Dict[str, Any]]:
        """Which photos go on which page: [{room, continued, photos: [index]}].

        rooms: each photo's room, in page order ('' for none). Once any photo
        has a room, a room starts on a page of its own (its photos are sent
        together, in the room order picked); without rooms the photos just
        fill the pages in order, per_page to a page.
        """
        grouped = any(rooms)
        layout: List[Dict[str, Any]] = []
        for idx, room in enumerate(rooms):
            last = layout[-1] if layout else None
            if last and len(last['photos']) < per_page and (not grouped or last['room'] == room):
                last['photos'].append(idx)
                continue
            continued = bool(grouped and last and last['room'] == room)
            layout.append({'room': room if grouped else '', 'continued': continued, 'photos': [idx]})
        return layout

    @staticmethod
    def photo_labels(rooms: List[str], captions: List[str]) -> List[str]:
        """The line under each photo: "Kitchen · 2 of 4 - new vanity installed".
        Empty for a photo with neither a room nor a caption."""
        totals: Dict[str, int] = {}
        for room in rooms:
            if room:
                totals[room] = totals.get(room, 0) + 1
        seen: Dict[str, int] = {}
        labels = []
        for room, caption in zip(rooms, captions):
            parts = []
            if room:
                seen[room] = seen.get(room, 0) + 1
                parts.append(f"{room} · {seen[room]} of {totals[room]}")
            if caption:
                parts.append(caption)
            labels.append(' - '.join(parts))
        return labels

    def photos_to_pdf(self, project_id: str, pages: list, rotations: Dict[int, int],
                      doc_type: str, title: str) -> Dict[str, Any]:
        """Photos as a letter-size PDF, saved as a completion doc: completion
        photos two to a page, any other kind one. Each page carries the
        property's address at the top, and the file is named by it.

        pages: (name, load) or (name, load, room, caption) per photo in order;
            load() returns the photo's bytes. Each is loaded when it is drawn,
            so one photo is in memory at a time. Photos with a room are laid
            out room by room (photo_pdf_layout): each room starts a page under
            its name, and every photo is labelled under it (photo_labels).
        rotations: {photo index: degrees clockwise} e.g. {0: 90, 2: 180}
        """
        session = self._s()
        try:
            from reportlab.lib.colors import HexColor
            from reportlab.lib.pagesizes import letter
            from reportlab.pdfbase.pdfmetrics import stringWidth
            from reportlab.pdfgen import canvas as rl_canvas

            from app.domains.rebuild.models import RebuildProject
            from app.domains.rebuild.repository import get_completion_doc_repository

            project = session.query(RebuildProject).filter(RebuildProject.id == project_id).first()
            if not project:
                raise ValueError("Project not found")

            if not pages:
                raise ValueError("No photos provided")
            if len(pages) > self.MAX_PDF_PHOTOS:
                raise ValueError(f"A PDF takes up to {self.MAX_PDF_PHOTOS} photos; split them into two documents")

            def text_of(entry, i):
                return ' '.join(str(entry[i] or '').split()) if len(entry) > i else ''

            rooms = [text_of(p, 2) for p in pages]
            captions = [text_of(p, 3) for p in pages]
            labels = self.photo_labels(rooms, captions)
            grouped = any(rooms)
            labelled = any(labels)

            address = self._photo_pdf_address(session, project)
            per_page = self.PHOTOS_PER_PAGE.get(doc_type, 1)
            layout = self.photo_pdf_layout(rooms, per_page)

            pdf_buffer = BytesIO()
            c = rl_canvas.Canvas(pdf_buffer, pagesize=letter)
            c.setTitle(' - '.join(p for p in (address, title) if p))
            page_w, page_h = letter
            margin = 36  # 0.5 inch
            top = page_h - 66  # under the header's rule
            bottom = 44  # over the page number
            gap = 14
            heading_h = 26 if grouped else 0  # the room's name over its photos
            label_h = 16 if labelled else 0  # the line under each photo
            slot_w = page_w - 2 * margin
            photos_top = top - heading_h
            slot_h = (photos_top - bottom - gap * (per_page - 1)) / per_page

            def fit(text: str, font: str, size: float, width: float) -> str:
                if stringWidth(text, font, size) <= width:
                    return text
                while text and stringWidth(text + '…', font, size) > width:
                    text = text[:-1]
                return text.rstrip() + '…'

            for page_no, page in enumerate(layout, start=1):
                if page_no > 1:
                    c.showPage()
                self._photo_page_frame(c, address, title, page_no, len(layout))
                if grouped and page['room']:
                    heading = page['room'] + (' (continued)' if page['continued'] else '')
                    c.setFillColor(HexColor('#1f2937'))
                    c.setFont('Helvetica-Bold', 13)
                    c.drawString(margin, top - 14, fit(heading, 'Helvetica-Bold', 13, slot_w))

                for slot, idx in enumerate(page['photos']):
                    name = pages[idx][0]
                    load = pages[idx][1]
                    try:
                        jpeg, (img_w, img_h) = self._photo_page_jpeg(load(), rotations.get(idx, 0))
                    except Exception as e:
                        logger.warning(f"Photo {idx + 1} ({name}) for project {project_id} could not be read: {e}")
                        raise ValueError(f"Photo {idx + 1} ({name}) could not be read")

                    # Fit its slot (less the line under it), centred, keeping its
                    # shape. A last photo alone on its page takes the top slot,
                    # the size of the others.
                    image_h = slot_h - label_h
                    ratio = min(slot_w / img_w, image_h / img_h)
                    draw_w = img_w * ratio
                    draw_h = img_h * ratio
                    slot_bottom = photos_top - (slot + 1) * slot_h - slot * gap
                    img_y = slot_bottom + label_h + (image_h - draw_h) / 2
                    c.drawImage(ImageReader(jpeg), (page_w - draw_w) / 2, img_y, width=draw_w, height=draw_h)
                    if labels[idx]:
                        c.setFillColor(HexColor('#374151'))
                        c.setFont('Helvetica', 9)
                        c.drawCentredString(page_w / 2, img_y - 12, fit(labels[idx], 'Helvetica', 9, slot_w))

            c.save()
            pdf_bytes = pdf_buffer.getvalue()
            del pdf_buffer

            # Upload to cloud storage
            from app.common.utils.storage_helpers import upload_bytes_to_storage

            file_name = self._photo_pdf_file_name(address, title)
            # Cloud metadata takes ASCII only; the doc keeps the name as typed
            storage_name = self._photo_pdf_file_name(
                *(t.encode('ascii', 'ignore').decode('ascii') for t in (address, title)))
            file_id = str(uuid.uuid4())

            storage_info = upload_bytes_to_storage(
                file_bytes=pdf_bytes,
                filename=storage_name,
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
                             signature_field_key: str = None, additional_text: str = None,
                             initial_image: str = None) -> str:
        """Overlay field values and an optional signature on the template PDF.

        The signature goes into the template's mapped signature box (the one
        named by signature_field_key, else the first) and that signer's
        date_signed box gets today's date. Templates without a signature box
        get it at the bottom right of the last page. initial_image, when
        given, goes in that signer's initials boxes.

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
        initial_boxes: list = []
        if signature_image:
            sig_keys = [m.get('fieldKey') for m in mappings if m.get('fieldKey', '').startswith('signature.')]
            target_key = signature_field_key if signature_field_key in sig_keys else (sig_keys[0] if sig_keys else None)
            if target_key:
                role = target_key.split('.', 1)[1]
                sig_boxes = [m for m in mappings if m.get('fieldKey') == target_key]
                date_boxes = [m for m in mappings if m.get('fieldKey') == f'date_signed.{role}']
                if initial_image:
                    initial_boxes = [m for m in mappings if m.get('fieldKey') == f'initial.{role}']
        sig_bytes = base64.b64decode(signature_image.split(',', 1)[-1]) if signature_image else None
        initial_bytes = base64.b64decode(initial_image.split(',', 1)[-1]) if initial_boxes else None

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
            page_initials = [m for m in initial_boxes if m.get('pageIndex', 0) == page_num]
            loose_signature = is_last_page and sig_bytes and not sig_boxes
            loose_text = is_last_page and additional_text
            if not (page_texts or page_sigs or page_dates or page_initials or loose_signature or loose_text):
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
                _draw_text_wrapped(c, value, fx, fy, fw, fh, m.get('fontSize', 12),
                                   multiline=bool(m.get('multiline')))

            for m in page_sigs:
                fx, fy, fw, fh = _box(m, pw, ph, 0.2, 0.06)
                c.drawImage(ImageReader(BytesIO(sig_bytes)), fx, fy, fw, fh,
                            mask='auto', preserveAspectRatio=True, anchor='c')

            for m in page_initials:
                fx, fy, fw, fh = _box(m, pw, ph, 0.08, 0.04)
                c.drawImage(ImageReader(BytesIO(initial_bytes)), fx, fy, fw, fh,
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
