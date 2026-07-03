"""
Public signing API - NO authentication required.
Accessed via signing token URL.
"""

import logging
from datetime import datetime

from fastapi import APIRouter, HTTPException, Request

from app.domains.contract.schemas import SigningRequest, SigningResponse, ContractViewResponse
from app.domains.contract.service import ContractInstanceService

logger = logging.getLogger(__name__)

router = APIRouter()


def _get_service():
    from app.core.database_factory import get_database
    return ContractInstanceService(get_database())


@router.get("/{token}")
async def get_contract_for_signing(token: str):
    """
    Public endpoint: Get contract details for the signing page.
    No authentication required - token is the auth.
    """
    try:
        service = _get_service()
        contract = service.get_by_token(token)

        if not contract:
            raise HTTPException(status_code=404, detail="Contract not found or link is invalid")

        # Check token expiry
        expires = contract.get('token_expires_at')
        if expires:
            if isinstance(expires, str):
                expires = datetime.fromisoformat(expires)
            if datetime.utcnow() > expires:
                raise HTTPException(status_code=410, detail="This signing link has expired")

        if contract.get('status') == 'voided':
            raise HTTPException(status_code=410, detail="This contract has been voided")

        # Mark as viewed if first time
        if contract.get('status') == 'sent':
            service.update(str(contract['id']), {
                'status': 'viewed',
                'viewed_at': datetime.utcnow(),
            })

        # Use proxy URL for PDF serving (works with cloud storage)
        proxy_pdf_url = f"/api/contracts/contracts/{contract['id']}/pdf"

        return ContractViewResponse(
            contract_id=contract['id'],
            title=contract.get('title'),
            company_name=contract.get('company_name'),
            client_name=contract.get('client_name'),
            template_name=contract.get('template_name'),
            document_type=contract.get('document_type'),
            file_url=proxy_pdf_url,
            filled_pdf_url=proxy_pdf_url if contract.get('filled_pdf_url') else None,
            status=contract.get('status', 'draft'),
            requires_signature=contract.get('requires_signature', True),
            signature_roles=contract.get('signature_roles'),
            existing_signatures=[
                {
                    'signer_name': s.get('signer_name'),
                    'signer_role': s.get('signer_role'),
                    'signed_at': s.get('signed_at'),
                }
                for s in contract.get('signatures', [])
            ],
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting contract for signing: {e}")
        raise HTTPException(status_code=500, detail="Failed to load contract")


@router.post("/{token}")
async def sign_contract(token: str, data: SigningRequest, request: Request):
    """
    Public endpoint: Submit a signature for a contract.
    Captures signer info + IP + user agent for legal validity.
    """
    try:
        service = _get_service()

        sig_data = {
            'signer_name': data.signer_name,
            'signer_role': data.signer_role,
            'signature_image': data.signature_image,
            'signature_type': data.signature_type,
            'typed_name': data.typed_name,
            'signed_at': datetime.utcnow(),
            'ip_address': (
                request.client.host if request.client else None
            ),
            'user_agent': request.headers.get(
                'user-agent', ''
            ),
        }

        result = service.sign_contract(token, sig_data)

        return SigningResponse(
            contract_id=result.get('contract_instance_id', ''),
            signer_name=data.signer_name,
            signed_at=result.get('signed_at', datetime.utcnow()),
            message="Contract signed successfully",
        )

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error signing contract: {e}")
        raise HTTPException(status_code=500, detail="Failed to sign contract")
