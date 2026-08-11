"""
AccuLynx lead-creation service.

Separate from service.py (file sync) to keep "create a new lead" and
"send files to a linked lead" concerns independent - both are still part
of the same removable acculynx module.
"""

import logging
from datetime import datetime
from typing import Optional

from sqlalchemy.orm import Session

from app.domains.client.models import Claim

from .client import AccuLynxClient
from .models import AccuLynxContactLink, AccuLynxJobLink
from .schemas import AccuLynxContactLinkResponse, AccuLynxCreateLeadRequest, AccuLynxLinkResponse

logger = logging.getLogger(__name__)

# AccuLynx "Customer" contact type - fetched once and cached for the process lifetime
# (contact types are a fixed, rarely-changing company setting).
_CUSTOMER_CONTACT_TYPE_ID: Optional[str] = None


class AccuLynxLeadCreationError(Exception):
    pass


async def _get_customer_contact_type_id(client: AccuLynxClient) -> str:
    global _CUSTOMER_CONTACT_TYPE_ID
    if _CUSTOMER_CONTACT_TYPE_ID:
        return _CUSTOMER_CONTACT_TYPE_ID

    types = await client.get_contact_types()
    customer = next((t for t in types if t.get("name") == "Customer"), None)
    if not customer:
        # Fall back to whatever AccuLynx marks as the default contact type
        customer = next((t for t in types if t.get("isDefault")), None)
    if not customer:
        raise AccuLynxLeadCreationError("Could not find a 'Customer' contact type in AccuLynx")

    _CUSTOMER_CONTACT_TYPE_ID = customer["id"]
    return _CUSTOMER_CONTACT_TYPE_ID


def _address_to_api_dict(address) -> Optional[dict]:
    if not address:
        return None
    return {
        "street1": address.street1,
        "street2": address.street2 or "",
        "city": address.city,
        "state": address.state,
        "zipCode": address.zip_code,
        "country": address.country,
    }


class AccuLynxLeadService:
    def __init__(self, db: Session):
        self.db = db

    def get_contact_link(self, client_id: str) -> Optional[AccuLynxContactLink]:
        return self.db.query(AccuLynxContactLink).filter(
            AccuLynxContactLink.client_id == client_id
        ).first()

    async def get_contact_link_display(self, client_id: str) -> Optional[AccuLynxContactLinkResponse]:
        """Look up the client's linked AccuLynx contact, with display fields fetched live."""
        link = self.get_contact_link(client_id)
        if not link:
            return None

        contact = {}
        try:
            contact = await AccuLynxClient().get_contact(link.acculynx_contact_id)
        except Exception as e:
            logger.warning(f"Failed to fetch AccuLynx contact {link.acculynx_contact_id} details: {e}")

        return AccuLynxContactLinkResponse(
            client_id=str(client_id),
            acculynx_contact_id=link.acculynx_contact_id,
            first_name=contact.get("firstName"),
            last_name=contact.get("lastName"),
            company_name=contact.get("companyName"),
        )

    def _upsert_contact_link(self, client_id: str, acculynx_contact_id: str) -> None:
        link = self.get_contact_link(client_id)
        if link:
            link.acculynx_contact_id = acculynx_contact_id
            link.linked_at = datetime.utcnow()
        else:
            self.db.add(AccuLynxContactLink(client_id=client_id, acculynx_contact_id=acculynx_contact_id))
        self.db.commit()

    async def create_lead(self, claim_id: str, request: AccuLynxCreateLeadRequest) -> AccuLynxLinkResponse:
        if not request.contact_id and not request.new_contact:
            raise AccuLynxLeadCreationError("Either contact_id or new_contact must be provided")

        claim = self.db.query(Claim).filter(Claim.id == claim_id).first()
        if not claim:
            raise AccuLynxLeadCreationError(f"Claim {claim_id} not found")

        client = AccuLynxClient()

        contact_id = request.contact_id
        if not contact_id:
            nc = request.new_contact
            contact_type_id = await _get_customer_contact_type_id(client)
            created = await client.create_contact(
                contact_type_id=contact_type_id,
                first_name=nc.first_name,
                last_name=nc.last_name,
                email=nc.email,
                phone=nc.phone,
                address=_address_to_api_dict(nc.address)
            )
            contact_id = created["id"]
            logger.info(f"Created AccuLynx contact {contact_id} for claim {claim_id}")

        # Remember this client -> contact mapping so future leads for the
        # same client's other claims reuse this contact instead of
        # creating a duplicate one (mirrors AccuLynx's own "one contact,
        # many jobs" model).
        self._upsert_contact_link(claim.client_id, contact_id)

        job = await client.create_job(
            contact_id=contact_id,
            address=_address_to_api_dict(request.address),
            notes=request.notes
        )
        acculynx_job_id = job["id"]
        logger.info(f"Created AccuLynx job {acculynx_job_id} for claim {claim_id}")

        if request.representative_user_id:
            await client.assign_company_representative(acculynx_job_id, request.representative_user_id)
            logger.info(f"Assigned representative {request.representative_user_id} to AccuLynx job {acculynx_job_id}")

        # Best-effort: fetch the job number for display; don't fail the whole
        # operation if this particular call errors.
        job_number = None
        try:
            job_detail = await client.get_job(acculynx_job_id)
            job_number = job_detail.get("jobNumber")
        except Exception as e:
            logger.warning(f"Created AccuLynx job {acculynx_job_id} but failed to fetch job number: {e}")

        existing = self.db.query(AccuLynxJobLink).filter(AccuLynxJobLink.claim_id == claim_id).first()
        if existing:
            existing.acculynx_job_id = acculynx_job_id
            existing.acculynx_job_number = job_number
            existing.linked_at = datetime.utcnow()
        else:
            existing = AccuLynxJobLink(
                claim_id=claim_id,
                acculynx_job_id=acculynx_job_id,
                acculynx_job_number=job_number
            )
            self.db.add(existing)

        self.db.commit()
        self.db.refresh(existing)
        return existing
