"""A claim's supplements come with their bid items, so the Rebuild project page
(and the client's claim page) can show what was asked for in the supplement, on a
throwaway SQLite database."""

from pathlib import Path
import sys

import pytest
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.compiler import compiles

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.core import database_factory
from app.core.database_factory import Base, SQLiteDatabase
from app.domains.client.models import Claim, Client
from app.domains.supplement.models import BidItemEstimate, SupplementFollowUp, SupplementRequest
from app.domains.supplement.schemas import SupplementRequestResponse
from app.domains.supplement.service import SupplementService
# SQLAlchemy configures every loaded model on first use, and models other test
# files load name classes by string, so register them all as the app does
import app.main  # noqa: E402,F401

TABLES = [Client, Claim, SupplementRequest, BidItemEstimate, SupplementFollowUp]


@compiles(JSONB, 'sqlite')
def jsonb_as_json(type_, compiler, **kw):
    """supplement_requests keeps a JSONB column; SQLite stores it as JSON"""
    return 'JSON'


@pytest.fixture
def env(tmp_path, monkeypatch):
    database = SQLiteDatabase(f"sqlite:///{tmp_path / 'test.db'}")
    sa.event.listen(
        database.engine, 'connect', lambda conn, _: conn.execute('PRAGMA foreign_keys=OFF')
    )
    Base.metadata.create_all(database.engine, tables=[m.__table__ for m in TABLES])
    monkeypatch.setattr(database_factory, 'get_database', lambda: database)

    session = database.get_session()
    client = Client(display_name='Pat Client', owners=[])
    session.add(client)
    session.flush()
    claim = Claim(client_id=client.id, claim_number='TEST-001', status='negotiating')
    other_claim = Claim(client_id=client.id, claim_number='TEST-002', status='negotiating')
    for row in (claim, other_claim):
        session.add(row)
    session.flush()
    supplement = SupplementRequest(claim_id=claim.id, title='Supplement', status='submitted')
    empty = SupplementRequest(claim_id=claim.id, title='Estimate request', status='identified')
    elsewhere = SupplementRequest(claim_id=other_claim.id, title='Other claim', status='submitted')
    for row in (supplement, empty, elsewhere):
        session.add(row)
    session.flush()
    for row in (
        BidItemEstimate(
            supplement_id=supplement.id, estimate_type='xactimate', title='Xactimate',
            custom_amount=18250.0, custom_document_file_id='file-xact',
            custom_document_file_name='Supplement.pdf',
        ),
        BidItemEstimate(
            supplement_id=supplement.id, estimate_type='bathroom', title='Hall bath',
            description='Tub surround and floor tile', custom_amount=9400.0,
            included_in_xactimate=True,
        ),
        BidItemEstimate(supplement_id=elsewhere.id, estimate_type='packing', title='Pack-out'),
    ):
        session.add(row)
    ids = {'claim': str(claim.id), 'supplement': str(supplement.id), 'empty': str(empty.id)}
    session.commit()
    session.close()
    return ids


def test_each_supplement_on_the_claim_comes_with_its_bid_items(env):
    result = SupplementService().get_by_claim(env['claim'])

    by_id = {str(s['id']): s for s in result}
    assert set(by_id) == {env['supplement'], env['empty']}

    # Listed by when they were added; rows made in the same second can come either way
    items = {i['estimate_type']: i for i in by_id[env['supplement']]['bid_items']}
    assert set(items) == {'xactimate', 'bathroom'}
    assert by_id[env['supplement']]['bid_item_count'] == 2
    xact, bath = items['xactimate'], items['bathroom']
    assert xact['custom_document_file_id'] == 'file-xact'
    assert bath['description'] == 'Tub surround and floor tile'
    assert bath['included_in_xactimate'] is True

    assert by_id[env['empty']]['bid_items'] == []
    assert by_id[env['empty']]['bid_item_count'] == 0


def test_the_response_keeps_the_bid_items(env):
    result = SupplementService().get_by_claim(env['claim'])
    supplement = next(s for s in result if str(s['id']) == env['supplement'])

    response = SupplementRequestResponse(**supplement)

    amounts = {i.title: i.custom_amount for i in response.bid_items}
    assert amounts == {'Xactimate': 18250.0, 'Hall bath': 9400.0}
