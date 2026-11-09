"""A claim gets its Rebuild project once its rebuild is priced; the customer's
own builds stay off the list and out of the figures. In-memory SQLite."""
import sys
import uuid
from pathlib import Path
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app.main  # noqa: F401  registers every model
from app.core.database_factory import Base
from app.domains.client.models import Claim, ClaimActivity, ClaimNegotiation, Client
from app.domains.rebuild.auto_create import ensure_rebuild_project
from app.domains.rebuild.models import RebuildProject
from app.domains.rebuild.repository import RebuildProjectRepository
from app.domains.supplement.models import BidItemEstimate, SupplementRequest


@compiles(JSONB, 'sqlite')
def _jsonb_on_sqlite(type_, compiler, **kw):
    return 'JSON'


class FakeDatabase:
    """Every service session shares the one in-memory connection"""

    def __init__(self, factory):
        self.factory = factory

    def get_session(self):
        return self.factory()

    get_readonly_session = get_session


@pytest.fixture
def db(monkeypatch):
    engine = create_engine('sqlite://', poolclass=StaticPool, connect_args={'check_same_thread': False})
    for table in Base.metadata.sorted_tables:
        try:
            table.create(engine)
        except Exception:
            pass  # tables these flows never touch may not build on SQLite
    database = FakeDatabase(sessionmaker(bind=engine, expire_on_commit=False))
    import app.common.base_service as base_service
    import app.core.database_factory as factory
    import app.domains.supplement.api as supplement_api
    for module in (base_service, factory, supplement_api):
        monkeypatch.setattr(module, 'get_database', lambda: database)
    monkeypatch.setattr(supplement_api, 'require_claim', lambda *a, **k: None)
    return database


def make_claim(s, name='Pat Homeowner', number='070748-GR', rcv=0):
    client = Client(id=uuid.uuid4(), display_name=name, owners=[],
                    address='12 Oak St', city='Fort Lee', state='NJ', zipcode='07024')
    claim = Claim(id=uuid.uuid4(), client_id=client.id, claim_number=number, current_rcv=rcv)
    s.add_all([client, claim])
    s.commit()
    return claim


def projects(s, claim):
    return s.query(RebuildProject).filter(RebuildProject.claim_id == claim.id).all()


def test_made_once_with_the_client_address_and_logged(db):
    s = db.get_session()
    claim = make_claim(s, rcv=41000)
    first = ensure_rebuild_project(s, claim, reason='a test')
    again = ensure_rebuild_project(s, claim, reason='a test')
    s.commit()
    assert first is not None and again is None
    [project] = projects(s, claim)
    assert project.property_address == '12 Oak St, Fort Lee, NJ 07024'
    assert project.title == 'Rebuild - 12 Oak St, Fort Lee, NJ 07024'
    assert float(project.insurance_estimate_amount) == 41000
    assert project.status == 'pending' and project.customer_managed is False
    log = s.query(ClaimActivity).filter(ClaimActivity.claim_id == claim.id).one()
    assert log.activity_type == 'rebuild_created'
    assert log.description == 'Auto-created rebuild project after a test.'


def upload(claim, **data):
    from app.domains.supplement.api import upload_insurance_estimate
    payload = {'revision_type': 'initial', 'rcv_amount': 52000, 'acv_amount': 48000, **data}
    return upload_insurance_estimate(str(claim.id), payload, db=None, current_staff=None)


def test_carrier_estimate_upload_on_supplement_makes_it(db):
    s = db.get_session()
    claim = make_claim(s)
    upload(claim)
    s.expire_all()
    [project] = projects(s, claim)
    assert float(project.insurance_estimate_amount) == 52000
    # A second revision doesn't make another
    upload(claim, revision_type='supplement', rcv_amount=60000)
    s.expire_all()
    assert len(projects(s, claim)) == 1


def test_water_mitigation_only_estimate_makes_none(db):
    s = db.get_session()
    claim = make_claim(s)
    upload(claim, estimate_category='water_mitigation')
    s.expire_all()
    assert projects(s, claim) == []


def test_contractor_bid_pdf_makes_it_and_other_edits_dont(db):
    from app.domains.supplement.service import SupplementService
    s = db.get_session()
    claim = make_claim(s)
    sup = SupplementRequest(id=uuid.uuid4(), claim_id=claim.id, title='Supplement')
    s.add(sup)
    s.commit()
    service = SupplementService(database=db)

    # A bid item without a PDF prices nothing yet
    item = service.create_bid_item({'supplement_id': sup.id, 'estimate_type': 'other', 'title': 'Floors'})
    service.update_bid_item(item['id'], {'custom_amount': 900})
    s.expire_all()
    assert projects(s, claim) == []

    service.update_bid_item(item['id'], {'custom_document_file_id': 'f1', 'custom_document_file_name': 'bid.pdf'})
    s.expire_all()
    [project] = projects(s, claim)

    # Deleted on purpose: editing the amount later doesn't bring it back
    s.delete(project)
    s.commit()
    service.update_bid_item(item['id'], {'custom_amount': 1200})
    s.expire_all()
    assert projects(s, claim) == []


def test_bid_item_added_with_its_pdf_makes_it(db):
    from app.domains.supplement.service import SupplementService
    s = db.get_session()
    claim = make_claim(s)
    sup = SupplementRequest(id=uuid.uuid4(), claim_id=claim.id, title='Supplement')
    s.add(sup)
    s.commit()
    SupplementService(database=db).create_bid_item({
        'supplement_id': sup.id, 'estimate_type': 'bathroom', 'title': 'Bath',
        'custom_document_file_id': 'f2', 'custom_document_file_name': 'bath.pdf',
    })
    s.expire_all()
    assert len(projects(s, claim)) == 1


def test_follow_up_estimate_received_still_makes_it(db):
    from app.domains.claim_followup.service import ClaimFollowUpService
    s = db.get_session()
    claim = make_claim(s, rcv=30000)
    ClaimFollowUpService(database=db)._auto_create_rebuild_project(s, claim, '9 Elm St, Leonia, NJ')
    s.commit()
    [project] = projects(s, claim)
    assert project.property_address == '9 Elm St, Leonia, NJ'


def test_customer_builds_stay_off_the_list_and_out_of_the_figures(db):
    s = db.get_session()
    ours = make_claim(s, 'Ours', 'A-1')
    theirs = make_claim(s, 'Theirs', 'B-2')
    s.add_all([
        RebuildProject(claim_id=ours.id, title='Ours', property_address='1 A St', status='in_progress',
                       contract_amount=10000),
        RebuildProject(claim_id=theirs.id, title='Theirs', property_address='2 B St', status='in_progress',
                       contract_amount=99000, customer_managed=True),
    ])
    s.commit()
    repo = RebuildProjectRepository(s)

    def titles(**kw):
        items, total = repo.get_with_filters(**kw)
        assert total == len(items)
        return sorted(i['title'] for i in items)

    assert titles(customer_managed=False) == ['Ours']
    assert titles(customer_managed=True) == ['Theirs']
    assert titles() == ['Ours', 'Theirs']
    stats = repo.get_dashboard_stats()
    assert (stats['total_projects'], stats['in_progress'], stats['customer_managed']) == (1, 1, 1)
    assert stats['total_contract_amount'] == 10000


def test_backfill_lists_claims_priced_without_a_project(db):
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
    from backfill_rebuild_projects import missing_rebuilds
    s = db.get_session()
    carrier = make_claim(s, 'Carrier', 'C-1')
    wm_only = make_claim(s, 'WM only', 'C-2')
    bid = make_claim(s, 'Bid', 'C-3')
    has_one = make_claim(s, 'Has one', 'C-4')
    deleted = make_claim(s, 'Deleted', 'C-5')
    nothing = make_claim(s, 'Nothing', 'C-6')  # noqa: F841
    sup = SupplementRequest(id=uuid.uuid4(), claim_id=bid.id, title='S')
    s.add_all([
        ClaimNegotiation(claim_id=carrier.id, revision_number=1, rcv_amount=70000),
        ClaimNegotiation(claim_id=carrier.id, revision_number=2, rcv_amount=75000, estimate_category='reconstruction'),
        ClaimNegotiation(claim_id=wm_only.id, revision_number=1, rcv_amount=8000, estimate_category='water_mitigation'),
        sup,
        BidItemEstimate(supplement_id=sup.id, estimate_type='other', title='Bid', custom_document_file_id='f'),
        ClaimNegotiation(claim_id=has_one.id, revision_number=1, rcv_amount=1),
        RebuildProject(claim_id=has_one.id, title='x'),
        ClaimNegotiation(claim_id=deleted.id, revision_number=1, rcv_amount=1),
        ClaimActivity(claim_id=deleted.id, activity_type='rebuild_created', title='Rebuild project created'),
    ])
    s.commit()
    rows = {claim.claim_number: (why, rcv) for claim, _, why, rcv in missing_rebuilds(s)}
    assert rows == {
        'C-1': ('the carrier estimate on file', 75000.0),
        'C-3': ('the contractor bid on file', 0.0),
    }
