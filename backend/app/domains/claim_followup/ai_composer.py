"""
AI Email Composer.
Uses OpenAI/Claude to generate professional email content for insurance claim follow-ups.
"""

import logging
from typing import Any, Dict, Optional

from app.core.config import settings

logger = logging.getLogger(__name__)

# Email context prompts by type
CONTEXT_PROMPTS = {
    "initial_send": "Write a professional email to the insurance adjuster informing them that water mitigation documents have been submitted. Include: Invoice, Certificate of Satisfaction, Emergency Work Authorization, and Photo Report.",
    "wm_docs_sent": "Write a professional follow-up email to the insurance adjuster regarding water mitigation documents that were previously submitted. The documents include: Invoice, Certificate of Satisfaction (COS), Emergency Work Authorization (EWA), and Photo Report. Request confirmation of receipt and a status update.",
    "followup": "Write a follow-up email to the insurance adjuster asking if they received the previously sent documents and requesting a status update on the claim.",
    "payment_inquiry": "Write a professional email inquiring about the payment status for a water mitigation claim. Ask when the payment will be processed.",
    "supplement": "Write a professional email to the public adjuster regarding a supplement estimate that has been submitted. Request an update on the review status.",
    "estimate_request": "Write a professional email to the insurance adjuster requesting the rebuild estimate for the property.",
    "depreciation_recovery": "Write a professional email to the insurance adjuster requesting the recoverable depreciation payment. The construction/repair work has been completed and we are submitting the completion documents to release the recoverable depreciation funds.",
    "general": "Write a professional email regarding the insurance claim.",
}

TONE_INSTRUCTIONS = {
    "professional": "Use a professional, business-appropriate tone.",
    "friendly": "Use a friendly but professional tone, showing understanding and patience.",
    "urgent": "Use a firm, urgent tone emphasizing the importance of immediate attention.",
    "formal": "Use a very formal, legal-style tone appropriate for official correspondence.",
}


def generate_email_content(
    context_type: str,
    claim_context: Dict[str, Any],
    tone: str = "professional",
    language: str = "en",
    additional_context: Optional[str] = None,
    followup_task_id: Optional[str] = None,
) -> Dict[str, str]:
    """
    Generate email content using AI.

    Returns dict with: subject, body_html, body_text, variables_used
    """
    # Build the prompt
    base_prompt = CONTEXT_PROMPTS.get(context_type, CONTEXT_PROMPTS["general"])
    tone_instruction = TONE_INSTRUCTIONS.get(tone, TONE_INSTRUCTIONS["professional"])

    # Language instruction
    lang_instruction = ""
    if language == "ko":
        lang_instruction = "Write the email in Korean (한국어)."
    elif language == "es":
        lang_instruction = "Write the email in Spanish."
    else:
        lang_instruction = "Write the email in English."

    prompt = f"""You are a professional email writer for a water mitigation and restoration company.

{base_prompt}

{tone_instruction}
{lang_instruction}

Context information:
- Claim Number: {claim_context.get('claim_number', 'N/A')}
- Insurance Company: {claim_context.get('insurance_company', 'N/A')}
- Adjuster Name: {claim_context.get('adjuster_name', 'N/A')}
- Homeowner: {claim_context.get('homeowner_name', 'N/A')}
- Property Address: {claim_context.get('property_address', 'N/A')}
- Our Estimate Amount: ${claim_context.get('our_estimate_amount', 0):,.2f}
- Insurance ACV: ${claim_context.get('current_acv', 0):,.2f}

{f"Additional context: {additional_context}" if additional_context else ""}

Please provide:
1. A concise email subject line
2. The email body in HTML format (use <p> tags for paragraphs, no complex HTML)

Format your response exactly as:
SUBJECT: [subject line here]
BODY:
[email body HTML here]
"""

    try:
        # Try OpenAI first (most likely available in this project)
        result = _call_openai(prompt)
        if result:
            return _parse_ai_response(result, claim_context)
    except Exception as e:
        logger.warning(f"OpenAI generation failed: {e}")

    # Fallback: generate a basic template-based email
    return _generate_fallback_email(context_type, claim_context, tone)


def _call_openai(prompt: str) -> Optional[str]:
    """Call OpenAI API for email generation"""
    api_key = getattr(settings, "OPENAI_API_KEY", None)
    if not api_key:
        logger.warning("No OPENAI_API_KEY configured, using fallback")
        return None

    try:
        import openai
        client = openai.OpenAI(api_key=api_key)
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "You are a professional email writer for a water mitigation company."},
                {"role": "user", "content": prompt},
            ],
            temperature=0.7,
            max_tokens=1000,
        )
        return response.choices[0].message.content
    except Exception as e:
        logger.error(f"OpenAI API error: {e}")
        raise


def _parse_ai_response(response: str, claim_context: Dict[str, Any]) -> Dict[str, str]:
    """Parse AI response into subject and body"""
    import re

    subject = ""
    body_html = ""

    # Extract subject
    subject_match = re.search(r'SUBJECT:\s*(.+?)(?:\n|$)', response)
    if subject_match:
        subject = subject_match.group(1).strip()

    # Extract body
    body_match = re.search(r'BODY:\s*\n(.+)', response, re.DOTALL)
    if body_match:
        body_html = body_match.group(1).strip()

    if not subject or not body_html:
        # Fallback parsing
        lines = response.strip().split('\n')
        if lines:
            subject = lines[0].replace("SUBJECT:", "").replace("Subject:", "").strip()
            body_html = '\n'.join(lines[1:]).replace("BODY:", "").strip()

    # Generate plain text version
    body_text = re.sub(r'<[^>]+>', '', body_html)
    body_text = re.sub(r'\s+', ' ', body_text).strip()

    return {
        "subject": subject,
        "body_html": body_html,
        "body_text": body_text,
        "variables_used": claim_context,
    }


def _generate_fallback_email(
    context_type: str,
    claim_context: Dict[str, Any],
    tone: str,
) -> Dict[str, str]:
    """Generate a basic email without AI (fallback)"""
    claim_number = claim_context.get('claim_number', '')
    adjuster_name = claim_context.get('adjuster_name', 'Adjuster')
    property_address = claim_context.get('property_address', '')
    insurance_company = claim_context.get('insurance_company', '')

    templates = {
        "wm_docs_sent": {
            "subject": f"Follow-up: Water Mitigation Documents - Claim #{claim_number}",
            "body": f"""<p>Dear {adjuster_name},</p>
<p>I am following up on the water mitigation documents submitted for Claim #{claim_number} at {property_address}.</p>
<p>The following documents were included:</p>
<ul>
<li>Invoice</li>
<li>Certificate of Satisfaction (COS)</li>
<li>Emergency Work Authorization (EWA)</li>
<li>Photo Report</li>
</ul>
<p>Could you please confirm receipt and provide a status update on the claim?</p>
<p>Thank you.</p>
<p>Best regards</p>""",
        },
        "initial_send": {
            "subject": f"Water Mitigation Documents Submitted - Claim #{claim_number}",
            "body": f"""<p>Dear {adjuster_name},</p>
<p>I hope this email finds you well. I am writing to inform you that we have submitted the following documents for Claim #{claim_number} at {property_address}:</p>
<ul>
<li>Invoice</li>
<li>Certificate of Satisfaction (COS)</li>
<li>Emergency Work Authorization (EWA)</li>
<li>Photo Report</li>
</ul>
<p>Please confirm receipt of these documents at your earliest convenience. If you need any additional information, please don't hesitate to reach out.</p>
<p>Thank you for your attention to this matter.</p>
<p>Best regards</p>""",
        },
        "followup": {
            "subject": f"Follow-up: Claim #{claim_number} - Document Status",
            "body": f"""<p>Dear {adjuster_name},</p>
<p>I am following up on the documents submitted for Claim #{claim_number} at {property_address}.</p>
<p>Could you please confirm whether you have received the documents? I would also appreciate any update on the claim status.</p>
<p>Please let me know if there is anything else needed from our end.</p>
<p>Thank you.</p>
<p>Best regards</p>""",
        },
        "payment_inquiry": {
            "subject": f"Payment Status Inquiry - Claim #{claim_number}",
            "body": f"""<p>Dear {adjuster_name},</p>
<p>I am writing to inquire about the payment status for Claim #{claim_number} ({property_address}).</p>
<p>Could you please provide an update on when we can expect the payment to be processed?</p>
<p>Thank you for your assistance.</p>
<p>Best regards</p>""",
        },
        "supplement": {
            "subject": f"Supplement Estimate Submitted - Claim #{claim_number}",
            "body": f"""<p>Dear {adjuster_name},</p>
<p>I am writing to follow up on the supplement estimate submitted for Claim #{claim_number} at {property_address}.</p>
<p>Could you please provide an update on the review status?</p>
<p>Thank you.</p>
<p>Best regards</p>""",
        },
        "estimate_request": {
            "subject": f"Rebuild Estimate Request - Claim #{claim_number}",
            "body": f"""<p>Dear {adjuster_name},</p>
<p>I am writing to request the rebuild estimate for Claim #{claim_number} at {property_address}.</p>
<p>Please let us know when we can expect to receive the estimate.</p>
<p>Thank you.</p>
<p>Best regards</p>""",
        },
        "depreciation_recovery": {
            "subject": f"Recoverable Depreciation Request - Claim #{claim_number}",
            "body": f"""<p>Dear {adjuster_name},</p>
<p>I am writing regarding Claim #{claim_number} at {property_address}.</p>
<p>The repair/construction work has been completed. We have submitted all required completion documents and are requesting the release of the recoverable depreciation funds.</p>
<p>Please let us know if any additional documentation is needed to process this payment.</p>
<p>Thank you for your prompt attention to this matter.</p>
<p>Best regards</p>""",
        },
    }

    template = templates.get(context_type, templates.get("followup"))
    import re
    body_text = re.sub(r'<[^>]+>', '', template["body"])

    return {
        "subject": template["subject"],
        "body_html": template["body"],
        "body_text": body_text,
        "variables_used": claim_context,
    }
