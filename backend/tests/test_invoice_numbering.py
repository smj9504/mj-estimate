"""Company invoice numbers INV-[Code]-[Year]-[N]: the next N is one past the
company's highest that year. On in-memory SQLite, through the same session
wrapper production uses (it has no Supabase-style .table())."""
import sys
import uuid
from contextlib import contextmanager
from pathlib import Path
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app.main  # noqa: F401,E402  registers every model
from app.core.database_factory import SQLAlchemySession  # noqa: E402
from app.domains.invoice.models import Invoice  # noqa: E402
from app.domains.invoice.numbering import next_company_invoice_number  # noqa: E402
from app.domains.invoice.service import InvoiceService  # noqa: E402


@pytest.fixture
def make_session():
    engine = create_engine('sqlite://', poolclass=StaticPool, connect_args={'check_same_thread': False})
    Invoice.__table__.create(engine)
    factory = sessionmaker(bind=engine)
    yield lambda: SQLAlchemySession(factory())
    engine.dispose()


def add_invoices(make_session, *numbers):
    with make_session() as s:
        for number in numbers:
            s.add(Invoice(id=uuid.uuid4(), invoice_number=number, client_name='Pat Homeowner'))


def test_next_number_is_one_past_the_highest(make_session):
    add_invoices(make_session, *[f'INV-BE1K-2026-{n}' for n in range(1, 28)])
    with make_session() as s:
        assert next_company_invoice_number(s, 'BE1K', '2026') == ('INV-BE1K-2026-28', 28)


def test_other_companies_years_and_odd_numbers_do_not_count(make_session):
    add_invoices(
        make_session,
        'INV-BE1K-2026-2', 'INV-BE1K-2026-5',   # a gap: 3 and 4 were deleted
        'INV-ZZ9Q-2026-40',                       # another company
        'INV-BE1K-2025-90',                       # last year
        'INV-BE1K-2026-7-old', 'INV-0042-BE1K-3',  # not this format
    )
    with make_session() as s:
        # Never hands a deleted invoice's number out again
        assert next_company_invoice_number(s, 'BE1K', '2026') == ('INV-BE1K-2026-6', 6)
        assert next_company_invoice_number(s, 'BE1K', '2027') == ('INV-BE1K-2027-1', 1)


def test_invoice_service_numbers_without_the_old_counter_error(make_session, monkeypatch, capsys):
    add_invoices(make_session, 'INV-BE1K-2026-1', 'INV-BE1K-2026-2')
    company_id = str(uuid.uuid4())

    @contextmanager
    def session_cm():
        with make_session() as s:
            yield s

    database = SimpleNamespace(get_session=session_cm, get_readonly_session=session_cm)
    monkeypatch.setattr('app.core.database_factory.get_database', lambda: database)
    monkeypatch.setattr(
        'app.domains.company.repository.get_company_repository',
        lambda session: SimpleNamespace(
            get_by_id=lambda cid: {'company_code': 'BE1K'} if cid == company_id else None
        ),
    )
    monkeypatch.setattr(
        'app.domains.invoice.service.datetime',
        SimpleNamespace(utcnow=lambda: __import__('datetime').datetime(2026, 11, 25)),
    )

    result = InvoiceService(database).generate_invoice_number(company_id)

    assert result == {'invoice_number': 'INV-BE1K-2026-3', 'sequence': 3, 'company_code': 'BE1K', 'year': '2026'}
    assert 'Error counting' not in capsys.readouterr().out
