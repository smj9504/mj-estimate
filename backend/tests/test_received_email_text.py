"""Some mailers send a plain part that is only leftover markup. The message's
words then come from its HTML, in the snippet and in the body shown."""

from datetime import datetime, timezone
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from pathlib import Path
import sys
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.domains.email_ingestion.email_client import (  # noqa: E402
    _extract_body,
    _html_to_text,
    readable_plain_text,
)
from app.domains.email_ingestion.service import _received_email_dict  # noqa: E402

# Allstate's auto-reply, as received
ALLSTATE_PLAIN = (
    'Allstate\n\n96\n\n \n\n\n\n'
    '&nbsp;&nbsp;|&nbsp;&nbsp; (https://www.allstate.com/?agentnumber=&cid=EMC-C-E-P_CLAIMS:EN)'
    '" style="color: #0033A0; text-decoration: none;Allstate.com\n\n'
)
ALLSTATE_HTML = """<!DOCTYPE html>
<html><head></head>
<head><title>Allstate</title><style type="text/css">a { color: black; }</style></head>
<body>
<!--[if mso]><table><tr><td>Outlook only copy</td></tr></table><![endif]-->
<div style="display: none; font-size: 0;">
<span style="display: none;">Email received. &zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;</span>
</div>
<table><tr><td>Claim 0835947722</td></tr>
<tr><td>Thanks, we've received your email. If you've included any attachments,
we've added them to the claim.</td></tr>
<tr><td class="showm" style="mso-hide:all; display:none;">
<a href="tel:1-800-ALLSTATE">1-800-ALLSTATE</a></td></tr>
<tr><td class="hidem">1-800-ALLSTATE</td></tr>
<tr><td><a href="x">Tools &amp; Resources</a> &nbsp;|&nbsp;
<a href="x" style="color: #0033A0;">Allstate<span></span>.com</a></td></tr>
<tr><td>&copy; 2026 Allstate
Insurance Company.</td></tr>
<tr><td class="padt10m" style="color: #4e5969; font-size: 8px; height: 34px;">P_CLAIMS_CLM26_NGAUTOREPLYCOMM_T</td></tr>
<tr><td style="color: #4e5969; font-size: 8px;">EMAIL_TO:claims@claims.allstate.com:</td></tr></table>
</body></html>
"""
ALLSTATE_WORDS = (
    "Claim 0835947722\n"
    "Thanks, we've received your email. If you've included any attachments, "
    "we've added them to the claim.\n\n"
    "1-800-ALLSTATE\n"
    "Tools & Resources | Allstate.com\n"
    "© 2026 Allstate Insurance Company."
)


def _stored_row(**values):
    fields = dict.fromkeys(
        ("id", "email_account_id", "message_id", "in_reply_to", "subject", "sender",
         "to_addresses", "cc_addresses", "attachment_names", "matched_client_id",
         "matched_claim_id", "match_method", "match_confidence", "matched_wm_job_id",
         "snippet", "body_text", "body_html")
    )
    fields.update(received_at=datetime(2026, 10, 23, tzinfo=timezone.utc), created_at=None)
    fields.update(values)
    return SimpleNamespace(**fields)


def test_botched_plain_part_gives_way_to_the_html():
    msg = MIMEMultipart("alternative")
    msg.attach(MIMEText(ALLSTATE_PLAIN, "plain", "utf-8"))
    msg.attach(MIMEText(ALLSTATE_HTML, "html", "utf-8"))

    text, html = _extract_body(msg)

    assert text == ALLSTATE_WORDS
    assert "<table>" in html


def test_html_text_shows_only_what_the_reader_sees():
    text = _html_to_text(ALLSTATE_HTML)

    assert "Outlook only copy" not in text
    assert "Email received" not in text
    assert "\u200c" not in text and "\xa0" not in text
    assert text.count("1-800-ALLSTATE") == 1
    assert "P_CLAIMS" not in text and "EMAIL_TO" not in text


@pytest.mark.parametrize("html", [
    # MJML and the like set font-size:0 on wrappers around the real content
    '<td style="font-size:0px;padding:10px"><div style="font-size:13px">Real words</div></td>',
    '<div style="font-size: 0.8em">Real words</div>',
    '<td style="font-size: 10px">Real words</td>',
    '<td style="font-size: 8pt">Real words</td>',
])
def test_readable_text_is_not_taken_for_fine_print(html):
    assert _html_to_text(html) == "Real words"


@pytest.mark.parametrize("plain", [
    "Thanks!\n\nOn Mon, Pat <pat@carrier.com> wrote:\n> see <https://carrier.com/claims>",
    "Q&A on the claim: a < b, R&D & more",
    "Report at https://carrier.com/?a=1&b=2",
])
def test_ordinary_plain_mail_is_left_alone(plain):
    assert readable_plain_text(plain, "<p>The HTML copy</p>") == plain


def test_markup_with_no_html_to_read_instead_stays():
    assert readable_plain_text(ALLSTATE_PLAIN, "") == ALLSTATE_PLAIN


def test_html_with_no_words_leaves_the_plain_part():
    assert readable_plain_text(ALLSTATE_PLAIN, "<img src='x'>") == ALLSTATE_PLAIN


def test_html_only_mail_stays_html_only():
    assert readable_plain_text("", ALLSTATE_HTML) == ""


def test_mail_stored_with_the_botched_text_reads_clean():
    row = _stored_row(
        snippet=" ".join(ALLSTATE_PLAIN.split())[:280],
        body_text=ALLSTATE_PLAIN,
        body_html=ALLSTATE_HTML,
    )

    item = _received_email_dict(row, include_body=True)

    assert item["snippet"].startswith("Claim 0835947722 Thanks, we've received your email.")
    assert "&nbsp;" not in item["snippet"] and "style=" not in item["snippet"]
    assert item["body_text"] == ALLSTATE_WORDS
    assert item["body_html"] == ALLSTATE_HTML
    # The list leaves the body out but cleans the snippet the same way
    assert _received_email_dict(row, include_body=False)["snippet"] == item["snippet"]


def test_stored_snippet_of_good_mail_is_kept():
    row = _stored_row(snippet="As stored", body_text="Hi Mila, thanks.", body_html="<p>Hi Mila</p>")

    item = _received_email_dict(row, include_body=True)

    assert item["snippet"] == "As stored"
    assert item["body_text"] == "Hi Mila, thanks."
