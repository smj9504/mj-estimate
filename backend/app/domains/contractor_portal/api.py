"""Contractor Portal API endpoints.

Public endpoints: token-based auth (no login required).
Admin endpoints: require authentication.
"""

import logging

from fastapi import APIRouter, File, HTTPException, Query, UploadFile

from app.domains.contractor_portal.schemas import (
    ContractorPaymentCreate,
    TokenCreateRequest,
)

logger = logging.getLogger(__name__)

# ── Public Router (no auth) ──
public_router = APIRouter()


def _get_service():
    from app.domains.contractor_portal.service import ContractorPortalService
    return ContractorPortalService()


@public_router.get("/{token}/validate")
async def validate_token(token: str):
    """Validate a contractor portal token."""
    service = _get_service()
    result = service.validate_token(token)
    if not result:
        return {"valid": False}
    return {
        "valid": True,
        "contact_name": result["contact_name"],
        "contact_id": result["contact_id"],
    }


@public_router.get("/{token}/claims")
async def list_claims(token: str):
    """List all claims across all companies for this contractor."""
    service = _get_service()
    info = service.validate_token(token)
    if not info:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    return service.get_all_claims_for_contact(token)


@public_router.get("/{token}/claims/{claim_id}/payments")
async def get_payments(token: str, claim_id: str):
    """Get payments for a specific claim with summary."""
    service = _get_service()
    info = service.validate_token(token)
    if not info:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    return service.get_payments(token, claim_id)


@public_router.post("/{token}/claims/{claim_id}/payments")
async def create_payment(token: str, claim_id: str, data: ContractorPaymentCreate):
    """Create a new payment entry from the contractor portal."""
    service = _get_service()
    info = service.validate_token(token)
    if not info:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    result = service.create_payment(token, claim_id, data.dict())
    if not result:
        raise HTTPException(status_code=500, detail="Failed to create payment")
    return result


@public_router.post("/{token}/upload-check-photo")
async def upload_check_photo(token: str, file: UploadFile = File(...)):
    """Upload a check photo from the contractor portal."""
    service = _get_service()
    info = service.validate_token(token)
    if not info:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    if not file.filename:
        raise HTTPException(status_code=400, detail="No file provided")

    # Accept images and PDFs
    allowed_types = {"image/jpeg", "image/png", "image/heic", "image/heif", "application/pdf"}
    if file.content_type and file.content_type not in allowed_types:
        raise HTTPException(status_code=400, detail="Only image or PDF files are allowed")

    try:
        from app.core.database_factory import get_database
        from app.domains.file.models import File as FileModel

        file_content = await file.read()
        database = get_database()
        with database.get_session() as session:
            # Store file using the file service
            from app.domains.storage.service import get_storage_service
            storage = get_storage_service()

            file_ext = file.filename.rsplit(".", 1)[-1] if "." in file.filename else "jpg"
            storage_result = storage.upload_file(
                file_content=file_content,
                filename=file.filename,
                context="contractor_portal",
                context_id="check_photo",
                category="check_photo",
            )

            file_record = FileModel(
                filename=file.filename,
                original_filename=file.filename,
                content_type=file.content_type or "image/jpeg",
                size=len(file_content),
                url=storage_result.get("url", ""),
                storage_provider=storage_result.get("provider", "local"),
                storage_file_id=storage_result.get("file_id", ""),
                context="contractor_portal",
                context_id="check_photo",
                category="check_photo",
            )
            session.add(file_record)
            session.commit()
            session.refresh(file_record)

            return {"file_id": str(file_record.id), "filename": file.filename}
    except Exception as e:
        logger.error(f"Error uploading check photo: {e}")
        raise HTTPException(status_code=500, detail="Failed to upload file")


# ── Auth-based Contractor Router (requires login) ──
# For contractors who log in with staff credentials

@public_router.get("/auth/claims")
async def list_claims_by_company(company_id: str = Query(None)):
    """List claims for a company, or all claims if no company_id."""
    service = _get_service()
    return service.get_claims_for_company(company_id)


@public_router.get("/auth/claims/{claim_id}/payments")
async def get_payments_by_company(
    claim_id: str, company_id: str = Query(...)
):
    """Get payments for a claim (used by logged-in contractors)."""
    service = _get_service()
    return service.get_payments_by_claim(claim_id)


@public_router.post("/auth/claims/{claim_id}/payments")
async def create_payment_by_company(
    claim_id: str, data: ContractorPaymentCreate
):
    """Create payment (used by logged-in contractors)."""
    service = _get_service()
    result = service.create_payment_direct(claim_id, data.dict())
    if not result:
        raise HTTPException(status_code=500, detail="Failed to create payment")
    return result


@public_router.post("/auth/upload-check-photo")
async def upload_check_photo_auth(file: UploadFile = File(...)):
    """Upload check photo (used by logged-in contractors)."""
    # Reuse same logic as token-based upload
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file provided")

    allowed_types = {
        "image/jpeg", "image/png", "image/heic",
        "image/heif", "application/pdf",
    }
    if file.content_type and file.content_type not in allowed_types:
        raise HTTPException(
            status_code=400, detail="Only image or PDF files"
        )

    try:
        from app.core.database_factory import get_database
        from app.domains.file.models import File as FileModel

        file_content = await file.read()
        database = get_database()
        with database.get_session() as session:
            from app.domains.storage.service import get_storage_service
            storage = get_storage_service()
            storage_result = storage.upload_file(
                file_content=file_content,
                filename=file.filename,
                context="contractor_portal",
                context_id="check_photo",
                category="check_photo",
            )
            file_record = FileModel(
                filename=file.filename,
                original_filename=file.filename,
                content_type=file.content_type or "image/jpeg",
                size=len(file_content),
                url=storage_result.get("url", ""),
                storage_provider=storage_result.get("provider", "local"),
                storage_file_id=storage_result.get("file_id", ""),
                context="contractor_portal",
                context_id="check_photo",
                category="check_photo",
            )
            session.add(file_record)
            session.commit()
            session.refresh(file_record)
            return {
                "file_id": str(file_record.id),
                "filename": file.filename,
            }
    except Exception as e:
        logger.error(f"Error uploading check photo: {e}")
        raise HTTPException(status_code=500, detail="Failed to upload file")


# ── Admin Router (requires auth) ──
admin_router = APIRouter()


@admin_router.post("/tokens")
async def create_token(data: TokenCreateRequest):
    """Generate a portal token for a company contact."""
    service = _get_service()
    result = service.create_token(data.company_contact_id)
    if not result:
        raise HTTPException(status_code=404, detail="Contact not found")
    return result


@admin_router.get("/tokens")
async def list_tokens(company_id: str = Query(None)):
    """List all active portal tokens."""
    service = _get_service()
    return service.list_tokens(company_id)


@admin_router.delete("/tokens/{token_id}")
async def deactivate_token(token_id: str):
    """Deactivate a portal token."""
    service = _get_service()
    if not service.deactivate_token(token_id):
        raise HTTPException(status_code=404, detail="Token not found")
    return {"success": True}
