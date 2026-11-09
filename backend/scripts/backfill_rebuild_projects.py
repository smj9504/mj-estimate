"""Create the Rebuild projects that were never made.

A claim should have one once its rebuild is priced: a carrier estimate that
isn't water mitigation only, or a contractor bid PDF on one of its
supplements (see app/domains/rebuild/auto_create.py). This lists every claim
that has either but no Rebuild project, and with --commit creates them.

Left out: claims whose Rebuild project was made and later deleted (the
claim's log has "Rebuild project created"), since someone removed it.

Dry run by default. --commit needs migration rb20261109cm01 applied first.

    python scripts/backfill_rebuild_projects.py --database-url <url>
    python scripts/backfill_rebuild_projects.py --database-url <url> --commit
"""
import argparse
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import sqlalchemy as sa  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402


def missing_rebuilds(session):
    """[(claim, client, why, carrier rcv)] for claims that should have a Rebuild project"""
    from app.domains.client.models import Claim, ClaimActivity, ClaimNegotiation, Client
    from app.domains.rebuild.models import RebuildProject
    from app.domains.supplement.models import BidItemEstimate, SupplementRequest

    carrier = (
        sa.select(ClaimNegotiation.id)
        .where(ClaimNegotiation.claim_id == Claim.id)
        .where(sa.or_(
            ClaimNegotiation.estimate_category.is_(None),
            ClaimNegotiation.estimate_category != 'water_mitigation',
        ))
    )
    bid_pdf = (
        sa.select(BidItemEstimate.id)
        .join(SupplementRequest, SupplementRequest.id == BidItemEstimate.supplement_id)
        .where(SupplementRequest.claim_id == Claim.id)
        .where(BidItemEstimate.custom_document_file_id.isnot(None))
        .where(BidItemEstimate.custom_document_file_id != '')
    )
    has_project = sa.select(RebuildProject.id).where(RebuildProject.claim_id == Claim.id)
    was_deleted = (
        sa.select(ClaimActivity.id)
        .where(ClaimActivity.claim_id == Claim.id)
        .where(ClaimActivity.activity_type == 'rebuild_created')
    )
    claims = (
        session.query(Claim, Client)
        .join(Client, Client.id == Claim.client_id)
        .filter(sa.or_(carrier.exists(), bid_pdf.exists()))
        .filter(~has_project.exists())
        .filter(~was_deleted.exists())
        .order_by(Claim.created_at)
        .all()
    )

    rows = []
    for claim, client in claims:
        latest = (
            session.query(ClaimNegotiation)
            .filter(ClaimNegotiation.claim_id == claim.id)
            .filter(sa.or_(
                ClaimNegotiation.estimate_category.is_(None),
                ClaimNegotiation.estimate_category != 'water_mitigation',
            ))
            .order_by(ClaimNegotiation.revision_number.desc())
            .first()
        )
        why = 'the carrier estimate on file' if latest else 'the contractor bid on file'
        rcv = float(latest.rcv_amount or 0) if latest else 0.0
        rows.append((claim, client, why, rcv))
    return rows


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--database-url", default=os.environ.get("DATABASE_URL"))
    ap.add_argument("--commit", action="store_true", help="create them (default: list only)")
    args = ap.parse_args()
    if not args.database_url:
        sys.exit("no database url (--database-url or DATABASE_URL)")

    import app.main  # noqa: F401  registers every model
    from app.domains.rebuild.auto_create import ensure_rebuild_project

    engine = sa.create_engine(args.database_url)
    session = sessionmaker(bind=engine)()
    try:
        rows = missing_rebuilds(session)
        print(f"{len(rows)} claim(s) should have a Rebuild project and don't:\n")
        for claim, client, why, rcv in rows:
            made = claim.created_at.strftime('%Y-%m-%d') if claim.created_at else '?'
            print(f"  {claim.claim_number or '(no claim #)':<22} {client.display_name[:28]:<28} "
                  f"claim {claim.status or '-':<11} since {made}  RCV ${rcv:>11,.2f}  ({why})")

        if not args.commit:
            print("\ndry run - nothing written (add --commit)")
            return
        columns = {c['name'] for c in sa.inspect(engine).get_columns('rebuild_projects')}
        if 'customer_managed' not in columns:
            sys.exit("\nrebuild_projects has no customer_managed column yet: deploy migration rb20261109cm01 first")

        made = 0
        for claim, client, why, rcv in rows:
            if ensure_rebuild_project(session, claim, reason=f'backfill ({why})',
                                      insurance_estimate_amount=rcv or None):
                made += 1
        session.commit()
        print(f"\ncreated {made} Rebuild project(s)")
    finally:
        session.close()


if __name__ == "__main__":
    main()
