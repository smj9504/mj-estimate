"""
Insurance estimate PDF classifier.
Determines if an email attachment is an insurance company estimate.
Uses a multi-layered approach: sender domain, email keywords, PDF content analysis.
"""

import logging
import re
from typing import Optional, Tuple

logger = logging.getLogger(__name__)

# Known insurance company email domains
INSURANCE_DOMAINS = {
    "statefarm.com", "allstate.com", "geico.com", "progressive.com",
    "usaa.com", "libertymutual.com", "nationwide.com", "farmers.com",
    "travelers.com", "americanfamily.com", "erieinsurance.com",
    "thehartford.com", "hanover.com", "chubb.com", "aig.com",
    "zurichna.com", "metlife.com", "csaa.com", "amica.com",
    "safeco.com", "auto-owners.com", "westfieldinsurance.com",
    "xactware.com", "verisk.com",  # Xactimate platform
}

# Keywords indicating insurance estimate in email subject/body
EMAIL_KEYWORDS = [
    r"estimate",
    r"claim\s*(number|#|no\.?)",
    r"loss\s*(date|report)",
    r"xactimate",
    r"xact\s*analysis",
    r"scope\s*of\s*(loss|work|repair)",
    r"insurance\s*(estimate|claim|report)",
    r"adjuster",
    r"supplement",
    r"reinspection",
    r"re-inspection",
    r"appraisal",
    r"coverage\s*(determination|decision)",
    r"proof\s*of\s*loss",
    r"acv|rcv|actual\s*cash\s*value|replacement\s*cost",
    r"depreciation",
    r"deductible",
    r"policy\s*(number|#|no\.?)",
]

# Keywords in PDF text indicating insurance estimate
PDF_KEYWORDS = [
    r"xactimate",
    r"claim\s*(number|#|no\.?)\s*:?\s*\S+",
    r"policy\s*(number|#|no\.?)\s*:?\s*\S+",
    r"date\s*of\s*loss",
    r"insured\s*:?\s*\S+",
    r"insurance\s*company",
    r"coverage\s*(a|b|c|d)",
    r"actual\s*cash\s*value",
    r"replacement\s*cost\s*value",
    r"depreciation",
    r"o\s*&?\s*p|overhead\s*(and|&)\s*profit",
    r"scope\s*of\s*(loss|repair|work)",
    r"adjuster",
    r"deductible",
    r"line\s*item\s*total",
    r"material\s*sales\s*tax",
    r"recoverable\s*depreciation",
    r"net\s*claim",
]

# Compiled patterns for performance
_email_patterns = [re.compile(kw, re.IGNORECASE) for kw in EMAIL_KEYWORDS]
_pdf_patterns = [re.compile(kw, re.IGNORECASE) for kw in PDF_KEYWORDS]


def _extract_sender_domain(sender: str) -> Optional[str]:
    """Extract domain from email sender string like 'Name <user@domain.com>'"""
    match = re.search(r"[\w.+-]+@([\w.-]+)", sender)
    return match.group(1).lower() if match else None


def classify_by_sender(sender: str) -> Tuple[bool, int, str]:
    """
    Check if sender is from a known insurance domain.
    Returns (is_match, confidence, reason)
    """
    domain = _extract_sender_domain(sender)
    if not domain:
        return False, 0, "No domain found in sender"

    for ins_domain in INSURANCE_DOMAINS:
        if domain == ins_domain or domain.endswith(f".{ins_domain}"):
            return True, 90, f"Sender domain matches insurance company: {ins_domain}"

    return False, 0, f"Sender domain {domain} not in known insurance list"


def classify_by_email_content(subject: str, body: str) -> Tuple[bool, int, str]:
    """
    Check email subject and body for insurance estimate keywords.
    Returns (is_match, confidence, reason)
    """
    text = f"{subject} {body}".lower()
    matches = []

    for pattern in _email_patterns:
        found = pattern.findall(text)
        if found:
            matches.append(pattern.pattern)

    if len(matches) >= 3:
        return True, 85, f"Email contains {len(matches)} insurance keywords: {', '.join(matches[:5])}"
    elif len(matches) >= 1:
        return False, 40, f"Email has some keywords ({len(matches)}), not enough for classification"

    return False, 0, "No insurance keywords found in email"


def classify_by_pdf_content(pdf_text: str) -> Tuple[bool, int, str]:
    """
    Analyze PDF text content for insurance estimate patterns.
    Only needs first 2-3 pages worth of text.
    Returns (is_match, confidence, reason)
    """
    if not pdf_text or len(pdf_text.strip()) < 50:
        return False, 0, "PDF text too short or empty"

    text = pdf_text.lower()
    matches = []

    for pattern in _pdf_patterns:
        found = pattern.findall(text)
        if found:
            matches.append(pattern.pattern)

    if len(matches) >= 5:
        return True, 95, f"PDF contains {len(matches)} strong insurance estimate indicators"
    elif len(matches) >= 3:
        return True, 80, f"PDF contains {len(matches)} insurance estimate indicators"
    elif len(matches) >= 1:
        return False, 30, f"PDF has some indicators ({len(matches)}), uncertain"

    return False, 0, "No insurance estimate patterns found in PDF"


def extract_pdf_text_first_pages(pdf_data: bytes, max_pages: int = 3) -> str:
    """
    Extract text from the first N pages of a PDF.
    Uses pdfplumber for better text extraction.
    Falls back to pypdf if pdfplumber not available.
    """
    text = ""

    # Try pdfplumber first
    try:
        import pdfplumber
        import io

        with pdfplumber.open(io.BytesIO(pdf_data)) as pdf:
            for i, page in enumerate(pdf.pages[:max_pages]):
                page_text = page.extract_text()
                if page_text:
                    text += page_text + "\n"
        if text.strip():
            return text
    except ImportError:
        pass
    except Exception as e:
        logger.warning(f"pdfplumber extraction failed: {e}")

    # Fallback to pypdf (the maintained successor to PyPDF2; same PdfReader API)
    try:
        from pypdf import PdfReader
        import io

        reader = PdfReader(io.BytesIO(pdf_data))
        for i, page in enumerate(reader.pages[:max_pages]):
            page_text = page.extract_text()
            if page_text:
                text += page_text + "\n"
    except ImportError:
        logger.warning("Neither pdfplumber nor pypdf available for PDF text extraction")
    except Exception as e:
        logger.warning(f"pypdf extraction failed: {e}")

    return text


def classify_email_attachment(
    sender: str,
    subject: str,
    body: str,
    pdf_data: bytes,
) -> Tuple[bool, int, str]:
    """
    Multi-layered classification of an email attachment.
    Returns (is_insurance_estimate, confidence, reason)

    Classification logic:
    1. Sender domain check (high confidence if match)
    2. Email subject/body keywords
    3. PDF content analysis (first 2-3 pages)

    Final decision: any single layer with confidence >= 80 or
    combined score from multiple layers >= 70.
    """
    reasons = []
    max_confidence = 0

    # Layer 1: Sender domain
    sender_match, sender_conf, sender_reason = classify_by_sender(sender)
    reasons.append(f"[Sender:{sender_conf}%] {sender_reason}")
    if sender_conf > max_confidence:
        max_confidence = sender_conf

    # Layer 2: Email content
    email_match, email_conf, email_reason = classify_by_email_content(subject, body)
    reasons.append(f"[Email:{email_conf}%] {email_reason}")
    if email_conf > max_confidence:
        max_confidence = email_conf

    # Layer 3: PDF content (only if not already confident)
    pdf_conf = 0
    if max_confidence < 80:
        pdf_text = extract_pdf_text_first_pages(pdf_data)
        _, pdf_conf, pdf_reason = classify_by_pdf_content(pdf_text)
        reasons.append(f"[PDF:{pdf_conf}%] {pdf_reason}")
        if pdf_conf > max_confidence:
            max_confidence = pdf_conf
    else:
        # Still extract PDF text for claim number extraction later
        reasons.append("[PDF] Skipped - already confident from other signals")

    combined_reason = " | ".join(reasons)

    # Decision logic
    if max_confidence >= 80:
        return True, max_confidence, combined_reason

    # Combined score: if multiple weak signals, still classify as estimate
    combined = (sender_conf * 0.3 + email_conf * 0.4 + pdf_conf * 0.3)
    if combined >= 70:
        return True, int(combined), f"Combined score: {combined_reason}"

    return False, max_confidence, combined_reason
