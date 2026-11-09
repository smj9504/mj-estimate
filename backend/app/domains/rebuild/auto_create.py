"""Give a claim its Rebuild project once the rebuild has a price.

A claim gets one, if it has none yet, when:
- a follow-up is resolved as "Insurance estimate received",
- the carrier's estimate is uploaded on the Supplement page (a water
  mitigation-only estimate is not a rebuild, so it doesn't count),
- a contractor bid PDF is uploaded on a supplement's bid item.

Making the project never fails the save that triggered it.
"""
import logging
from typing import Any, Optional

logger = logging.getLogger(__name__)


def claim_property_address(session, claim) -> str:
    """The claim's client address as one line"""
    from app.domains.client.models import Client
    from app.domains.water_mitigation.same_customer import full_address

    client = session.query(Client).filter(Client.id == claim.client_id).first()
    if not client:
        return ''
    return full_address(client.address, client.city, client.state, client.zipcode)


def ensure_rebuild_project(
    session,
    claim,
    *,
    reason: str,
    property_address: Optional[str] = None,
    insurance_estimate_amount: Optional[float] = None,
) -> Optional[Any]:
    """Create the claim's Rebuild project unless it has one; returns the new one.

    reason finishes "Auto-created rebuild project after ..." in the claim's
    activity log. Runs in a savepoint, so a failure here leaves the caller's
    own changes intact.
    """
    if claim is None:
        return None
    from app.domains.client.models import ClaimActivity
    from app.domains.rebuild.models import RebuildProject

    try:
        with session.begin_nested():
            if session.query(RebuildProject.id).filter(
                RebuildProject.claim_id == claim.id
            ).first():
                return None

            address = (property_address or '').strip() or claim_property_address(session, claim)
            amount = insurance_estimate_amount
            if not amount:
                amount = float(claim.current_rcv or 0)
            project = RebuildProject(
                claim_id=claim.id,
                title=f"Rebuild - {address or claim.claim_number or ''}".strip(),
                property_address=address,
                status='pending',
                insurance_estimate_amount=amount,
                priority='normal',
            )
            session.add(project)
            session.flush()
            session.add(ClaimActivity(
                claim_id=claim.id,
                activity_type='rebuild_created',
                title='Rebuild project created',
                description=f'Auto-created rebuild project after {reason}.',
                related_entity_type='rebuild_project',
                related_entity_id=project.id,
            ))
            session.flush()
        logger.info(f"Auto-created rebuild project for claim {claim.id} ({reason})")
        return project
    except Exception as e:
        logger.error(f"Error auto-creating rebuild project for claim {claim.id}: {e}")
        return None


def ensure_rebuild_project_for_supplement(session, supplement_id: str, *, reason: str) -> Optional[Any]:
    """Same, for the claim a supplement belongs to"""
    from app.domains.client.models import Claim
    from app.domains.supplement.models import SupplementRequest

    try:
        supplement = session.query(SupplementRequest).filter(
            SupplementRequest.id == supplement_id
        ).first()
        claim = supplement and session.query(Claim).filter(Claim.id == supplement.claim_id).first()
    except Exception as e:
        logger.error(f"Error finding the claim of supplement {supplement_id}: {e}")
        return None
    return ensure_rebuild_project(session, claim, reason=reason)
