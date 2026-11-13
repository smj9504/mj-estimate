"""Holes from the 2026-11 audit that a signed-in account could still use:

- Xactimate unified search pasted the search box into its SQL.
- PDF renders fetched any URL, so HTML typed into a line item could attach
  file:///proc/self/environ (the server's keys) to the PDF.
- /api/staff let anyone signed in edit any staff row, role included.
"""

import os
from pathlib import Path
import sys
import uuid

os.environ.setdefault("ENVIRONMENT", "test")
os.environ.setdefault("DATABASE_URL", "sqlite:///./test_logged_in_audit_fixes.db")

from fastapi.testclient import TestClient
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.main import app
from app.common.services import pdf_service
from app.common.services.pdf_fetch_guard import PDFFetchRefused, check_url
from app.domains.auth.dependencies import get_current_staff
from app.domains.staff import api as staff_api
from app.domains.xactimate.repository import XactimateUnifiedRepository


# ---------------------------------------------------------------- Xactimate SQL

class _Row:
    total_count = 0
    xactimate_count = 0
    custom_count = 0


class _Result:
    def fetchall(self):
        return []

    def fetchone(self):
        return _Row()


class _RecordingSession:
    def __init__(self):
        self.calls = []

    def execute(self, statement, params=None):
        self.calls.append((str(statement), dict(params or {})))
        return _Result()


HOSTILE = "x' UNION SELECT password_hash FROM staff --"


def test_unified_search_sends_what_was_typed_as_values_not_sql():
    session = _RecordingSession()
    XactimateUnifiedRepository(session).unified_search(
        search_term=HOSTILE, category="DRY'; DROP TABLE line_items; --",
        company_id="c0ffee'--", page=2, page_size=25,
    )
    assert len(session.calls) == 2
    for sql, params in session.calls:
        assert "UNION SELECT password_hash" not in sql
        assert "DROP TABLE" not in sql
        assert "c0ffee" not in sql
        assert params["search_like"] == f"%{HOSTILE}%"
        assert params["category"] == "DRY'; DROP TABLE line_items; --"
        assert params["company_id"] == "c0ffee'--"
    page_sql, page_params = session.calls[0]
    assert "LIMIT :page_limit OFFSET :page_offset" in page_sql
    assert (page_params["page_limit"], page_params["page_offset"]) == (25, 25)


def test_unified_search_filters_xactimate_items_by_their_category_column():
    session = _RecordingSession()
    XactimateUnifiedRepository(session).unified_search(category="DRY", item_type="XACTIMATE")
    sql, _ = session.calls[0]
    assert "category_code = :category" in sql
    assert "cat = :category" not in sql


# ---------------------------------------------------------------- PDF fetches

TEMPLATES = pdf_service.TEMPLATE_DIR


@pytest.mark.parametrize("url", [
    "file:///proc/self/environ",
    "file:///etc/passwd",
    (Path(__file__).resolve().parents[1] / ".env").as_uri(),
    (TEMPLATES / ".." / ".." / ".env").as_uri(),
    "file://fileserver/share/secrets.txt",
    "ftp://example.com/x",
    "gopher://example.com/x",
])
def test_a_pdf_cannot_read_server_files_or_odd_schemes(url):
    with pytest.raises(PDFFetchRefused):
        pdf_service.check_pdf_fetch_url(url)


@pytest.mark.parametrize("url", [
    "data:image/png;base64,iVBORw0KGgo=",
    "https://fonts.googleapis.com/css2?family=Inter",
    (TEMPLATES / "plumber_report" / "standard" / "style.css").as_uri(),
])
def test_a_pdf_still_gets_its_own_css_logos_and_photos(url):
    pdf_service.check_pdf_fetch_url(url)


@pytest.mark.parametrize("url", [
    "http://127.0.0.1:8000/api/companies/",
    "http://localhost/x",
    "http://169.254.169.254/latest/meta-data/",
    "http://10.1.2.3/x",
])
def test_production_pdfs_cannot_reach_private_addresses(url):
    with pytest.raises(PDFFetchRefused):
        check_url(url, [TEMPLATES], block_private_hosts=True)
    check_url(url, [TEMPLATES], block_private_hosts=False)  # dev: local storage URLs


def _weasyprint_or_skip():
    try:
        import weasyprint  # noqa: F401
    except (ImportError, OSError) as exc:  # Windows without the GTK runtime
        pytest.skip(f"WeasyPrint can't load here: {exc}")


def test_an_attachment_link_typed_into_a_document_is_dropped(tmp_path):
    _weasyprint_or_skip()
    secret = tmp_path / "secret.txt"
    secret.write_text("SECRET_KEY=do-not-leak")
    html = (
        "<p>Line item</p>"
        f'<link rel="attachment" href="{secret.as_uri()}">'
        '<link rel="attachment" href="file:///proc/self/environ">'
    )
    pdf = pdf_service._render_html_pdf(html)
    assert pdf.startswith(b"%PDF")
    assert b"do-not-leak" not in pdf
    assert b"EmbeddedFile" not in pdf


# ---------------------------------------------------------------- /api/staff

class _FakeStaff:
    def __init__(self, role):
        self.id = uuid.uuid4()
        self.role = role


class _FakeStaffService:
    def get_staff_with_filters(self, filters):
        return {"staff": []}

    def get_by_id(self, staff_id):
        return {"gdrive_enabled": False}

    def update(self, staff_id, data):
        raise AssertionError("should not get this far")

    def create_staff_member(self, staff):
        raise AssertionError("should not get this far")


@pytest.fixture
def signed_in():
    """Sign in as a given role for one test; returns the staff stand-in."""
    def sign_in(role):
        staff = _FakeStaff(role)
        app.dependency_overrides[get_current_staff] = lambda: staff
        app.dependency_overrides[staff_api.get_staff_service] = _FakeStaffService
        return staff
    yield sign_in
    app.dependency_overrides.pop(get_current_staff, None)
    app.dependency_overrides.pop(staff_api.get_staff_service, None)


client = TestClient(app, raise_server_exceptions=False)


@pytest.mark.parametrize("method,url,body", [
    ("PUT", f"/api/staff/{uuid.uuid4()}", {"role": "admin"}),
    ("POST", "/api/staff/", {"email": "new@example.com"}),
    ("GET", "/api/staff/", None),
    ("GET", f"/api/staff/{uuid.uuid4()}", None),
    ("DELETE", f"/api/staff/{uuid.uuid4()}", None),
    ("PUT", f"/api/staff/{uuid.uuid4()}/permissions", {}),
    ("GET", "/api/staff/audit-logs/", None),
])
def test_staff_records_are_admin_only(signed_in, method, url, body):
    signed_in("estimator")
    assert client.request(method, url, json=body).status_code == 403


def test_an_admin_still_lists_staff(signed_in):
    signed_in("admin")
    resp = client.get("/api/staff/")
    assert resp.status_code == 200
    assert resp.json() == {"data": [], "total": 0}


def test_people_open_their_own_drive_settings_only(signed_in):
    me = signed_in("estimator")
    assert client.get(f"/api/staff/{me.id}/gdrive-settings").status_code == 200
    assert client.get(f"/api/staff/{uuid.uuid4()}/gdrive-settings").status_code == 403
    assert client.post(f"/api/staff/{uuid.uuid4()}/gdrive-oauth/disconnect").status_code == 403


def test_an_admin_opens_anyones_drive_settings(signed_in):
    signed_in("super_admin")
    assert client.get(f"/api/staff/{uuid.uuid4()}/gdrive-settings").status_code == 200


def test_a_password_change_is_for_your_own_account(signed_in):
    signed_in("estimator")
    resp = client.post(
        f"/api/staff/change-password?current_staff_id={uuid.uuid4()}",
        json={"current_password": "a", "new_password": "b", "confirm_password": "b"},
    )
    assert resp.status_code == 403
