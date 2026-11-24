"""A revised estimate whose font prints each character at 288 minus its code
('S' as 'Í', '0' as 'ð') is read from its text, not sent to the AI reader,
which looked at the wrong pages and got the amounts wrong."""

from pathlib import Path
import json
import sys
from types import SimpleNamespace

import pymupdf

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.domains.client import negotiation_pdf_service as svc  # noqa: E402


def mirror(text):
    return "".join(chr(288 - ord(c)) if "!" <= c <= "~" else c for c in text)


def test_unmirror_reads_the_text_back():
    assert svc._unmirror("Í«³³¿®§ º±® Þ«·´¼·²¹") == "Summary for Building"
    # PyMuPDF gives the mirrored 's' (the soft hyphen) as '-'; a real '-' is 'ó'
    assert svc._unmirror("Ô»-- Ü»°®»½·¿¬·±²  øïïôëêíòïê÷") == "Less Depreciation  (11,563.16)"
    assert svc._unmirror(mirror("DOE_SAM-2-1")) == "DOE_SAM-2-1"


def test_legible_text_is_words_not_symbols():
    assert svc._is_legible("Summary for Dwelling\nLine Item Total 12,345.67\nReplacement Cost Value")
    assert not svc._is_legible(mirror("Summary for Dwelling\nLine Item Total 12,345.67\nReplacement Cost Value"))
    assert not svc._is_legible("/G21/G22/G23/G24/G25/G26/G27/G28/G29/G30/G31/G32/G33/G34/G35")
    assert not svc._is_legible("12.00 SF 34.50")


SUMMARY = [
    ("Summary for Dwelling", None),
    ("Line Item Total", "21,400.00"),
    ("Overhead", "2,140.00"),
    ("Profit", "2,140.00"),
    ("Material Sales Tax", "620.10"),
    ("Replacement Cost Value", "$26,300.10"),
    ("Less Depreciation", "(4,210.55)"),
    ("Actual Cash Value", "$22,089.55"),
    ("Less Deductible", "(1,000.00)"),
    ("Net Claim", "$21,089.55"),
    ("Total Recoverable Depreciation", "4,210.55"),
    ("Net Claim if Depreciation is Recovered", "$25,300.10"),
]


def make_mirrored_estimate(path):
    doc = pymupdf.open()
    # A line item page first, as in the estimate, then the summary with each
    # amount in a column of its own
    page = doc.new_page()
    y = 72
    for row in ("Kitchen  Height: 8'", "1. R&R Base cabinetry  12.00 LF  245.10  2,941.20",
                "2. Paint the walls - two coats  380.00 SF  1.24  471.20", "Totals: Kitchen  3,412.40"):
        page.insert_text((72, y), mirror(row), fontsize=10)
        y += 16
    page = doc.new_page()
    y = 72
    for label, amount in SUMMARY:
        page.insert_text((72, y), mirror(label), fontsize=10)
        if amount:
            page.insert_text((400, y), mirror(amount), fontsize=10)
        y += 16
    doc.save(str(path))
    doc.close()


def test_mirrored_estimate_is_read_from_its_text(tmp_path, monkeypatch):
    pdf = tmp_path / "revised.pdf"
    make_mirrored_estimate(pdf)

    def no_ai(*args, **kwargs):
        raise AssertionError("sent to the AI reader")

    monkeypatch.setattr(svc, "_extract_sections_via_vision", no_ai)
    result = svc.extract_summary_from_pdf(str(pdf))

    assert result["metadata"]["strategy"] == "text_regex"
    [sec] = result["sections"]
    assert sec["section_name"] == "Dwelling"
    assert sec["line_item_total"] == 21400.00
    assert sec["material_sales_tax"] == 620.10
    assert sec["rcv"] == 26300.10
    assert sec["depreciation"] == 4210.55
    assert sec["deductible"] == 1000.00
    assert sec["net_acv"] == 21089.55
    assert result["validation"]["is_valid"]


def test_ai_reader_answer_is_cleaned_before_it_is_added_up(monkeypatch):
    answer = [
        {"section_name": None, "rcv": "$1,250.00", "net_acv": "(1,000.00)", "depreciation": None},
        "not a section",
    ]
    reply = SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=json.dumps(answer)))])
    client = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=lambda **kw: reply)))
    monkeypatch.setattr(svc, "_get_openai", lambda: client)

    [sec] = svc._extract_sections_via_vision(b"png", "image/png")
    assert sec == {"section_name": "", "rcv": 1250.0, "net_acv": 1000.0, "depreciation": 0}
    assert svc.compute_totals([sec])["rcv_amount"] == 1250.0
