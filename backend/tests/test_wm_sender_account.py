"""The WM send dialogs preselect email_accounts[0]: the sender's own account."""
import importlib.util
import sys
from pathlib import Path
from types import ModuleType, SimpleNamespace

import pytest

COMPANY_ID = 'company-1'
OTHER_COMPANY_ID = 'company-2'


def _account(email, company_id=None):
    return SimpleNamespace(
        id=email, email_address=email, display_name=email, company_id=company_id,
    )


class _Query:
    def __init__(self, rows):
        self.rows = rows

    def filter(self, *_):
        return self

    def all(self):
        return self.rows


class _Session:
    def __init__(self, rows):
        self.rows = rows

    def query(self, *_):
        return _Query(self.rows)


@pytest.fixture
def email_service(monkeypatch):
    # As in test_document_memory: no DB connection is needed, so stub only
    # the DB factory to stay independent of deployment credentials.
    module = ModuleType('app.core.database_factory')
    module.get_database = lambda: None
    monkeypatch.setitem(sys.modules, 'app.core.database_factory', module)
    models = ModuleType('app.domains.email_ingestion.models')
    models.EmailAccount = SimpleNamespace(is_active=True, can_send=True)
    monkeypatch.setitem(sys.modules, 'app.domains.email_ingestion.models', models)
    path = Path(__file__).resolve().parents[1] / 'app/domains/water_mitigation/adjuster_email_service.py'
    spec = importlib.util.spec_from_file_location('_wm_sender_test.email', path)
    email_module = importlib.util.module_from_spec(spec)
    monkeypatch.setitem(sys.modules, spec.name, email_module)
    spec.loader.exec_module(email_module)
    return email_module.AdjusterEmailService(database=object())


def _emails(accounts):
    return [a['email_address'] for a in accounts]


def test_own_account_beats_one_matching_the_job_company(email_service):
    rows = [
        _account('jyoo@enter.construction', COMPANY_ID),
        _account('msong@enter.construction'),
    ]
    accounts = email_service._get_email_accounts(
        _Session(rows), company_id=COMPANY_ID, sender_email='msong@enter.construction',
    )
    assert accounts[0]['email_address'] == 'msong@enter.construction'


def test_own_account_matches_regardless_of_case(email_service):
    rows = [_account('jyoo@enter.construction'), _account('MSong@Enter.Construction')]
    accounts = email_service._get_email_accounts(
        _Session(rows), sender_email=' msong@enter.construction ',
    )
    assert accounts[0]['email_address'] == 'MSong@Enter.Construction'


def test_without_an_own_account_the_job_company_comes_first(email_service):
    rows = [
        _account('a@other.example', OTHER_COMPANY_ID),
        _account('z@enter.construction', COMPANY_ID),
    ]
    accounts = email_service._get_email_accounts(
        _Session(rows), company_id=COMPANY_ID, sender_email='nobody@example.com',
    )
    assert _emails(accounts) == ['z@enter.construction', 'a@other.example']


def test_order_does_not_depend_on_row_order(email_service):
    rows = [
        _account('jyoo@enter.construction', COMPANY_ID),
        _account('msong@enter.construction', COMPANY_ID),
        _account('documents@scopit.work'),
    ]
    expected = email_service._get_email_accounts(_Session(rows), company_id=COMPANY_ID)
    reordered = email_service._get_email_accounts(_Session(rows[::-1]), company_id=COMPANY_ID)
    assert _emails(reordered) == _emails(expected)
