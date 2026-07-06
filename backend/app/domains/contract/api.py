"""
Contract admin API endpoints (requires authentication)
"""

import logging
import os
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, Form
from pathlib import Path

from app.core.database_factory import get_db_session as get_db
from app.domains.contract.schemas import (
    ContractTemplateCreate,
    ContractTemplateUpdate,
    ContractTemplateResponse,
    ContractInstanceCreate,
    ContractInstanceUpdate,
    ContractInstanceResponse,
    ClaimCompanyCreate,
    ClaimCompanyResponse,
    FieldMappingUpdate,
)
from app.domains.contract.service import (
    ContractTemplateService,
    ContractInstanceService,
    ClaimCompanyService,
)

logger = logging.getLogger(__name__)
router = APIRouter()


def _get_template_service():
    from app.core.database_factory import get_database
    return ContractTemplateService(get_database())


def _get_instance_service():
    from app.core.database_factory import get_database
    return ContractInstanceService(get_database())


def _get_claim_company_service():
    from app.core.database_factory import get_database
    return ClaimCompanyService(get_database())


# ============================================================
# Contract Templates
# ============================================================

@router.get("/templates")
async def list_templates(
    company_id: Optional[str] = None,
    service: ContractTemplateService = Depends(_get_template_service),
):
    """List all contract templates, optionally filtered by company"""
    try:
        if company_id:
            templates = service.get_by_company(company_id)
        else:
            templates = service.get_all_with_company()
        return {"templates": templates, "total": len(templates)}
    except Exception as e:
        logger.error(f"Error listing templates: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/templates")
async def create_template(
    company_id: str = Form(...),
    name: str = Form(...),
    document_type: str = Form("authorization"),
    description: str = Form(None),
    requires_signature: bool = Form(True),
    signature_roles: str = Form('["homeowner"]'),
    file: UploadFile = File(...),
    service: ContractTemplateService = Depends(_get_template_service),
):
    """Create a contract template with PDF upload"""
    try:
        # Validate file type
        if not file.filename.lower().endswith('.pdf'):
            raise HTTPException(status_code=400, detail="Only PDF files are allowed")

        # Upload file to cloud storage
        content = await file.read()

        from app.common.utils.storage_helpers import upload_bytes_to_storage
        storage_info = upload_bytes_to_storage(
            file_bytes=content,
            filename=file.filename,
            context="contracts",
            context_id=str(uuid.uuid4()),
            category="templates",
            content_type="application/pdf",
        )

        # Create template record
        template_data = {
            'company_id': company_id,
            'name': name,
            'document_type': document_type,
            'description': description,
            'requires_signature': requires_signature,
            'signature_roles': signature_roles,
            'file_url': storage_info["file_path"],
            'file_name': file.filename,
            'file_size': storage_info["file_size"],
            'storage_provider': storage_info["storage_provider"],
            'storage_file_id': storage_info["storage_file_id"],
        }

        result = service.create(template_data)
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error creating template: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/templates/{template_id}")
async def get_template(
    template_id: str,
    service: ContractTemplateService = Depends(_get_template_service),
):
    try:
        template = service.get_by_id(template_id)
        if not template:
            raise HTTPException(status_code=404, detail="Template not found")
        return template
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/templates/{template_id}")
async def update_template(
    template_id: str,
    data: ContractTemplateUpdate,
    service: ContractTemplateService = Depends(_get_template_service),
):
    try:
        result = service.update(template_id, data.dict(exclude_unset=True))
        if not result:
            raise HTTPException(status_code=404, detail="Template not found")
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/templates/{template_id}/upload")
async def replace_template_pdf(
    template_id: str,
    file: UploadFile = File(...),
    service: ContractTemplateService = Depends(_get_template_service),
):
    """Replace the PDF file of an existing template"""
    try:
        if not file.filename.lower().endswith('.pdf'):
            raise HTTPException(status_code=400, detail="Only PDF files are allowed")

        content = await file.read()

        from app.common.utils.storage_helpers import upload_bytes_to_storage
        storage_info = upload_bytes_to_storage(
            file_bytes=content,
            filename=file.filename,
            context="contracts",
            context_id=template_id,
            category="templates",
            content_type="application/pdf",
        )

        result = service.update(template_id, {
            'file_url': storage_info["file_path"],
            'file_name': file.filename,
            'file_size': storage_info["file_size"],
            'storage_provider': storage_info["storage_provider"],
            'storage_file_id': storage_info["storage_file_id"],
        })
        if not result:
            raise HTTPException(status_code=404, detail="Template not found")
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/templates/{template_id}")
async def delete_template(
    template_id: str,
    service: ContractTemplateService = Depends(_get_template_service),
):
    try:
        success = service.delete(template_id)
        if not success:
            raise HTTPException(status_code=404, detail="Template not found")
        return {"message": "Template deleted successfully"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================
# Contract Instances (under claim)
# ============================================================

@router.get("/claims/{claim_id}/contracts")
async def list_contracts(
    claim_id: str,
    service: ContractInstanceService = Depends(_get_instance_service),
):
    try:
        contracts = service.get_by_claim(claim_id)
        return {"contracts": contracts, "total": len(contracts)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/claims/{claim_id}/contracts")
async def create_contract(
    claim_id: str,
    data: ContractInstanceCreate,
    service: ContractInstanceService = Depends(_get_instance_service),
):
    """Generate a contract from a template for this claim"""
    try:
        contract_data = data.dict()
        contract_data['claim_id'] = claim_id
        result = service.create_contract(contract_data)
        return result
    except Exception as e:
        logger.error(f"Error creating contract: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/claims/{claim_id}/contracts/{contract_id}")
async def get_contract(
    claim_id: str,
    contract_id: str,
    service: ContractInstanceService = Depends(_get_instance_service),
):
    try:
        contract = service.get_by_id(contract_id)
        if not contract:
            raise HTTPException(status_code=404, detail="Contract not found")
        return contract
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/claims/{claim_id}/contracts/{contract_id}/send")
async def send_contract(
    claim_id: str,
    contract_id: str,
    service: ContractInstanceService = Depends(_get_instance_service),
):
    """Mark contract as sent and return signing info"""
    try:
        result = service.send_for_signing(contract_id)
        if not result:
            raise HTTPException(status_code=404, detail="Contract not found")
        return {
            "contract": result,
            "signing_url": f"/sign/{result.get('signing_token')}",
            "signing_token": result.get('signing_token'),
            "expires_at": result.get('token_expires_at'),
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/claims/{claim_id}/contracts/{contract_id}/void")
async def void_contract(
    claim_id: str,
    contract_id: str,
    service: ContractInstanceService = Depends(_get_instance_service),
):
    try:
        result = service.void_contract(contract_id)
        if not result:
            raise HTTPException(status_code=404, detail="Contract not found")
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================
# Claim Companies
# ============================================================

@router.get("/claims/{claim_id}/companies")
async def list_claim_companies(
    claim_id: str,
    service: ClaimCompanyService = Depends(_get_claim_company_service),
):
    try:
        companies = service.get_by_claim(claim_id)
        return {"companies": companies, "total": len(companies)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/claims/{claim_id}/companies")
async def assign_company(
    claim_id: str,
    data: ClaimCompanyCreate,
    service: ClaimCompanyService = Depends(_get_claim_company_service),
):
    try:
        company_data = data.dict()
        company_data['claim_id'] = claim_id
        result = service.create(company_data)
        return result
    except Exception as e:
        logger.error(f"Error assigning company: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/claims/{claim_id}/companies/{assignment_id}")
async def remove_company(
    claim_id: str,
    assignment_id: str,
    service: ClaimCompanyService = Depends(_get_claim_company_service),
):
    try:
        success = service.delete(assignment_id)
        if not success:
            raise HTTPException(status_code=404, detail="Assignment not found")
        return {"message": "Company removed from claim"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================
# Claim - Plumber Report link
# ============================================================

# ============================================================
# Field Mappings
# ============================================================

@router.get("/templates/{template_id}/field-mappings")
async def get_field_mappings(
    template_id: str,
    service: ContractTemplateService = Depends(_get_template_service),
):
    """Get field mappings and available fields for a template"""
    try:
        return service.get_field_mappings(template_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.put("/templates/{template_id}/field-mappings")
async def update_field_mappings(
    template_id: str,
    data: FieldMappingUpdate,
    service: ContractTemplateService = Depends(_get_template_service),
):
    """Save field mappings for a template"""
    try:
        mappings = [m.dict() for m in data.field_mappings]
        result = service.update_field_mappings(
            template_id, mappings
        )
        if not result:
            raise HTTPException(
                status_code=404, detail="Template not found"
            )
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================
# Prefill Preview & Dashboard
# ============================================================

@router.get("/claims/{claim_id}/prefill-preview")
async def get_prefill_preview(
    claim_id: str,
    template_id: str,
    client_id: str,
    company_id: str,
    service: ContractInstanceService = Depends(
        _get_instance_service
    ),
):
    """Preview prefill data before generating a contract"""
    try:
        return service.get_prefill_preview(
            claim_id, template_id, client_id, company_id
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/claims/{claim_id}/dashboard")
async def get_claim_dashboard(
    claim_id: str,
    service: ContractInstanceService = Depends(
        _get_instance_service
    ),
):
    """Get contracts grouped by company for a claim"""
    try:
        return service.get_dashboard(claim_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================
# Claim - Plumber Report link
# ============================================================

@router.put("/claims/{claim_id}/plumber-report")
async def link_plumber_report(
    claim_id: str,
    plumber_report_id: Optional[str] = None,
    db=Depends(get_db),
):
    """Link or unlink a plumber report to/from a claim"""
    try:
        from app.domains.client.models import Claim
        claim = db.query(Claim).filter(Claim.id == claim_id).first()
        if not claim:
            raise HTTPException(status_code=404, detail="Claim not found")

        claim.plumber_report_id = plumber_report_id
        db.commit()
        return {"message": "Plumber report linked" if plumber_report_id else "Plumber report unlinked"}
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================
# WM Job Contract Integration
# ============================================================

@router.get("/wm-jobs/{job_id}/contracts")
async def list_wm_job_contracts(
    job_id: str,
    db=Depends(get_db),
    service: ContractInstanceService = Depends(_get_instance_service),
):
    """List contracts for a WM job (via its claim_id)"""
    try:
        from app.domains.water_mitigation.models import WaterMitigationJob
        job = db.query(WaterMitigationJob).filter(
            WaterMitigationJob.id == job_id
        ).first()
        if not job:
            raise HTTPException(status_code=404, detail="WM Job not found")
        if not job.claim_id:
            return {"contracts": [], "total": 0}
        contracts = service.get_by_claim(str(job.claim_id))
        return {"contracts": contracts, "total": len(contracts)}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error listing WM job contracts: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/wm-jobs/{job_id}/contracts")
async def create_wm_job_contract(
    job_id: str,
    data: ContractInstanceCreate,
    db=Depends(get_db),
    service: ContractInstanceService = Depends(_get_instance_service),
):
    """Generate a contract for a WM job using its claim/client/company info"""
    try:
        from app.domains.water_mitigation.models import WaterMitigationJob
        job = db.query(WaterMitigationJob).filter(
            WaterMitigationJob.id == job_id
        ).first()
        if not job:
            raise HTTPException(status_code=404, detail="WM Job not found")
        if not job.claim_id:
            raise HTTPException(
                status_code=400,
                detail="WM Job has no linked claim. Please link a claim first."
            )

        contract_data = data.dict()
        contract_data['claim_id'] = str(job.claim_id)
        contract_data['wm_job_id'] = job_id
        # Use job's company_id if not specified
        if not contract_data.get('company_id') and job.company_id:
            contract_data['company_id'] = str(job.company_id)
        # Use job's client_id if not specified
        if not contract_data.get('client_id') and job.client_id:
            contract_data['client_id'] = str(job.client_id)

        result = service.create_contract(contract_data)
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error creating WM job contract: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/wm-jobs/{job_id}/prefill-preview")
async def get_wm_job_prefill_preview(
    job_id: str,
    template_id: str,
    db=Depends(get_db),
    service: ContractInstanceService = Depends(_get_instance_service),
):
    """Preview prefill data for a WM job contract, including WM-specific fields"""
    try:
        from app.domains.water_mitigation.models import WaterMitigationJob
        job = db.query(WaterMitigationJob).filter(
            WaterMitigationJob.id == job_id
        ).first()
        if not job:
            raise HTTPException(status_code=404, detail="WM Job not found")
        if not job.claim_id:
            raise HTTPException(status_code=400, detail="WM Job has no linked claim.")

        result = service.get_prefill_preview(
            claim_id=str(job.claim_id),
            template_id=template_id,
            client_id=str(job.client_id) if job.client_id else '',
            company_id=str(job.company_id) if job.company_id else '',
            wm_job_id=job_id,
        )
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting WM prefill preview: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/wm-jobs/{job_id}/available-templates")
async def get_wm_job_available_templates(
    job_id: str,
    db=Depends(get_db),
    service: ContractTemplateService = Depends(_get_template_service),
):
    """Get available contract templates for a WM job's company"""
    try:
        from app.domains.water_mitigation.models import WaterMitigationJob
        job = db.query(WaterMitigationJob).filter(
            WaterMitigationJob.id == job_id
        ).first()
        if not job:
            raise HTTPException(status_code=404, detail="WM Job not found")
        if not job.company_id:
            return {"templates": [], "total": 0}
        templates = service.get_by_company(str(job.company_id))
        # Only return active templates
        active = [t for t in templates if t.get('is_active', True)]
        return {"templates": active, "total": len(active)}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting available templates: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================
# PDF Serve Endpoints (cloud storage support)
# ============================================================

@router.get("/templates/{template_id}/pdf")
async def serve_template_pdf(
    template_id: str,
    service: ContractTemplateService = Depends(_get_template_service),
):
    """Serve template PDF from cloud or local storage."""
    from starlette.responses import Response

    try:
        template = service.get_by_id(template_id)
        if not template:
            raise HTTPException(status_code=404, detail="Template not found")

        file_url = template.get('file_url') if isinstance(template, dict) else getattr(template, 'file_url', '')
        storage_prov = template.get('storage_provider', 'local') if isinstance(template, dict) else getattr(template, 'storage_provider', 'local')
        file_name = template.get('file_name', 'template.pdf') if isinstance(template, dict) else getattr(template, 'file_name', 'template.pdf')

        pdf_bytes = _resolve_contract_pdf(file_url, storage_prov)
        if not pdf_bytes:
            raise HTTPException(status_code=404, detail="Template PDF not found")

        return Response(
            content=pdf_bytes,
            media_type="application/pdf",
            headers={"Content-Disposition": f'inline; filename="{file_name}"'}
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error serving template PDF: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/contracts/{contract_id}/pdf")
async def serve_contract_pdf(
    contract_id: str,
    service: ContractInstanceService = Depends(_get_instance_service),
):
    """Serve filled contract PDF from cloud or local storage."""
    from starlette.responses import Response

    try:
        contract = service.get_by_id(contract_id)
        if not contract:
            raise HTTPException(status_code=404, detail="Contract not found")

        filled_url = contract.get('filled_pdf_url') if isinstance(contract, dict) else getattr(contract, 'filled_pdf_url', '')
        file_url = contract.get('file_url', '') if isinstance(contract, dict) else getattr(contract, 'file_url', '')
        pdf_url = filled_url or file_url

        if not pdf_url:
            raise HTTPException(status_code=404, detail="No PDF available")

        pdf_bytes = _resolve_contract_pdf(pdf_url)
        if not pdf_bytes:
            raise HTTPException(status_code=404, detail="Contract PDF not found")

        return Response(
            content=pdf_bytes,
            media_type="application/pdf",
            headers={"Content-Disposition": f'inline; filename="contract.pdf"'}
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error serving contract PDF: {e}")
        raise HTTPException(status_code=500, detail=str(e))


def _resolve_contract_pdf(
    file_url: str, storage_provider: str = None
) -> bytes:
    """Download contract PDF from cloud storage or read from local."""
    if not file_url:
        return None

    # Try cloud storage first
    if storage_provider and storage_provider not in ('local', ''):
        try:
            from app.domains.storage.factory import StorageFactory
            storage = StorageFactory.get_instance(storage_provider)
            return storage.download(file_url)
        except Exception as e:
            logger.warning(f"Cloud download failed for {file_url}: {e}")

    # Try local filesystem
    backend_dir = Path(__file__).resolve().parents[3]
    if file_url.startswith('/uploads/'):
        local_path = backend_dir / file_url.lstrip('/')
    else:
        local_path = Path(file_url)
    if local_path.exists():
        return local_path.read_bytes()

    # Fallback: try configured storage provider
    # (handles case where files were uploaded as 'local' but only exist
    #  on cloud storage, e.g. deployed environment without /uploads/)
    from app.core.config import settings
    configured = settings.STORAGE_PROVIDER.lower()
    if configured not in ('local', ''):
        try:
            from app.domains.storage.factory import StorageFactory
            storage = StorageFactory.get_instance(configured)
            # Try with file_url as-is (blob path)
            return storage.download(file_url)
        except Exception:
            # Try stripping /uploads/ prefix
            if file_url.startswith('/uploads/'):
                try:
                    return storage.download(file_url.lstrip('/'))
                except Exception as e:
                    logger.warning(f"Fallback download from {configured} failed: {e}")

    return None
