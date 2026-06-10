"""
AI Email Composer.
Uses OpenAI/Claude to generate professional email content for insurance claim follow-ups.
Supports stage-aware WM follow-up emails that escalate in tone over time.
"""

import logging
from datetime import datetime
from typing import Any, Dict, Optional
from zoneinfo import ZoneInfo

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

# Stage-aware prompts for WM follow-ups
WM_FOLLOWUP_STAGE_PROMPTS = {
    "first": (
        "Write a brief, polite first follow-up email to confirm the adjuster received "
        "the water mitigation documentation. Keep it simple - just ask for receipt confirmation "
        "and offer to provide additional information if needed."
    ),
    "second": (
        "Write a friendly second follow-up email. The adjuster hasn't responded yet. "
        "Ask whether the file is still under review or if payment has already been processed. "
        "If the check has been issued, ask for the date and who it was mailed to. "
        "Offer to provide any further documentation needed."
    ),
    "third": (
        "Write a more direct third follow-up. Reference the specific date the documents "
        "were submitted. Ask the adjuster to confirm receipt and provide the current status "
        "of the endorsement/payment. Mention you're available if additional information is needed."
    ),
    "escalated": (
        "Write a concise, direct follow-up. Keep it brief. Ask for an update on the payment "
        "status for the water mitigation invoice. If the check has been issued, ask for "
        "confirmation of the date and recipient. Keep the tone professional but persistent."
    ),
}

TONE_INSTRUCTIONS = {
    "professional": "Use a professional, business-appropriate tone.",
    "friendly": "Use a friendly but professional tone, showing understanding and patience.",
    "urgent": "Use a firm, urgent tone emphasizing the importance of immediate attention.",
    "formal": "Use a very formal, legal-style tone appropriate for official correspondence.",
}


def _get_greeting() -> str:
    """Get time-appropriate greeting based on US Eastern time."""
    eastern_now = datetime.now(ZoneInfo("America/New_York"))
    return "Good morning" if eastern_now.hour < 12 else "Good afternoon"


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
    For WM follow-ups, uses stage-aware templates based on contact_count.

    Returns dict with: subject, body_html, body_text, variables_used
    """
    # Determine if this is a stage-aware WM follow-up
    followup_stage = claim_context.get('followup_stage')
    task_type = claim_context.get('task_type')

    # Use stage-aware prompt for WM follow-ups
    if task_type == 'wm_docs_sent' and followup_stage and context_type in ('followup', 'wm_docs_sent'):
        base_prompt = WM_FOLLOWUP_STAGE_PROMPTS.get(followup_stage, CONTEXT_PROMPTS["followup"])
    else:
        base_prompt = CONTEXT_PROMPTS.get(context_type, CONTEXT_PROMPTS["general"])

    tone_instruction = TONE_INSTRUCTIONS.get(tone, TONE_INSTRUCTIONS["professional"])

    # Language instruction
    if language == "ko":
        lang_instruction = "Write the email in Korean (한국어)."
    elif language == "es":
        lang_instruction = "Write the email in Spanish."
    else:
        lang_instruction = "Write the email in English."

    # Build stage context for the prompt
    stage_context = ""
    if followup_stage:
        contact_count = claim_context.get('contact_count', 0)
        days_since_sent = claim_context.get('days_since_docs_sent')
        docs_sent_date = claim_context.get('documents_sent_date')
        stage_context = f"\n- Follow-up stage: {followup_stage} (contact #{contact_count + 1})"
        if docs_sent_date:
            stage_context += f"\n- Documents originally sent on: {docs_sent_date}"
        if days_since_sent is not None:
            stage_context += f"\n- Days since documents sent: {days_since_sent}"
        days_since_last = claim_context.get('days_since_last_contact')
        if days_since_last is not None:
            stage_context += f"\n- Days since last follow-up: {days_since_last}"

    # WM-specific context
    wm_context = ""
    wm_address = claim_context.get('wm_property_address') or claim_context.get('property_address', '')
    wm_homeowner = claim_context.get('wm_homeowner_name') or claim_context.get('homeowner_name', '')
    if wm_address:
        wm_context += f"\n- Property Address: {wm_address}"
    if wm_homeowner:
        wm_context += f"\n- Homeowner Name: {wm_homeowner}"

    # Adjuster first name for personalized greeting
    adjuster_name = claim_context.get('adjuster_name', '')
    adjuster_first = adjuster_name.split()[0] if adjuster_name.strip() else ''

    prompt = f"""You are a professional email writer for a water mitigation and restoration company.

{base_prompt}

{tone_instruction}
{lang_instruction}

Context information:
- Claim Number: {claim_context.get('claim_number', 'N/A')}
- Insurance Company: {claim_context.get('insurance_company', 'N/A')}
- Adjuster Name: {adjuster_name or 'N/A'}
- Adjuster First Name: {adjuster_first or 'N/A'}{wm_context}{stage_context}

{f"Additional context: {additional_context}" if additional_context else ""}

Important guidelines:
- Use a time-appropriate greeting ({_get_greeting()})
- If the adjuster's first name is known, use it in the greeting
- Keep the email concise and professional
- Do NOT include a signature block (it will be added automatically)
- End with "Thanks for your time!" or similar brief closing

Please provide:
1. A concise email subject line (just the claim number for follow-ups)
2. The email body in HTML format (use <p> tags for paragraphs, no complex HTML)

Format your response exactly as:
SUBJECT: [subject line here]
BODY:
[email body HTML here]
"""

    try:
        result = _call_openai(prompt)
        if result:
            return _parse_ai_response(result, claim_context)
    except Exception as e:
        logger.warning(f"OpenAI generation failed: {e}")

    # Fallback: generate stage-aware template-based email
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
    """Generate a template-based email (fallback when AI is unavailable).

    For WM follow-ups, uses stage-aware templates based on contact_count.
    """
    claim_number = claim_context.get('claim_number', '')
    adjuster_name = claim_context.get('adjuster_name', 'Adjuster')
    adjuster_first = adjuster_name.split()[0] if adjuster_name.strip() else ''
    property_address = (
        claim_context.get('wm_property_address')
        or claim_context.get('property_address', '')
    )
    homeowner_name = (
        claim_context.get('wm_homeowner_name')
        or claim_context.get('homeowner_name', '')
    )
    # Extract last name for brief references
    homeowner_last = homeowner_name.split()[-1] if homeowner_name.strip() else ''
    documents_sent_date = claim_context.get('documents_sent_date', '')
    greeting = _get_greeting()
    followup_stage = claim_context.get('followup_stage')
    task_type = claim_context.get('task_type')

    # Personalized greeting
    if adjuster_first:
        greeting_line = f"{greeting} {adjuster_first},"
    else:
        greeting_line = f"{greeting},"

    # ─── Stage-aware WM follow-up templates ───
    if task_type == 'wm_docs_sent' and followup_stage and context_type in ('followup', 'wm_docs_sent'):
        subject = claim_number or "Water Mitigation Follow-up"

        if followup_stage == 'first':
            body = f"""<p>{greeting_line}</p>
<p>I'm just following up on my previous email regarding the documentation for the water mitigation work{f' at {property_address}' if property_address else ''} and wanted to confirm that you received it.</p>
<p>Please feel free to let me know if you have any questions or need any additional information.</p>
<p>Thanks for your time!</p>"""

        elif followup_stage == 'second':
            body = f"""<p>Hi {adjuster_first or adjuster_name}, I hope you're doing well.</p>
<p>I'm just following up on the water mitigation job{f' at {property_address}' if property_address else ''}.</p>
<p>I wasn't sure if the file is still under review or if the payment has already been processed.</p>
<p>If the check has been issued, could you please let me know the date and who it was mailed to?</p>
<p>Or, if you need any further documentation to wrap this up, just let me know! I'm happy to help.</p>
<p>Thanks for your time!</p>"""

        elif followup_stage == 'third':
            body = f"""<p>{greeting_line}</p>
<p>I haven't heard back regarding the water mitigation docs{f' submitted on {documents_sent_date}' if documents_sent_date else ''}.</p>
<p>Could you please confirm receipt and let me know the current status of the endorsement?</p>
<p>Please let me know if you need any further information to process the payment.</p>
<p>Thanks for your time!</p>"""

        else:  # escalated
            body = f"""<p>Hope all is well.</p>
<p>Just following up on the water mitigation invoice{f' for {homeowner_last}' if homeowner_last else ''}. Do you have an update on the payment status?</p>
<p>If the check has already been issued, could you confirm the date and the recipient?</p>
<p>Thanks for your time!</p>"""

        import re
        body_text = re.sub(r'<[^>]+>', '', body)
        return {
            "subject": subject,
            "body_html": body,
            "body_text": body_text,
            "variables_used": claim_context,
        }

    # ─── Standard (non-stage-aware) templates ───
    templates = {
        "wm_docs_sent": {
            "subject": f"Follow-up: Water Mitigation Documents - Claim #{claim_number}",
            "body": f"""<p>Dear {adjuster_name},</p>
<p>I am following up on the water mitigation documents submitted for Claim #{claim_number}{f' at {property_address}' if property_address else ''}.</p>
<p>The following documents were included:</p>
<ul>
<li>Invoice</li>
<li>Certificate of Satisfaction (COS)</li>
<li>Emergency Work Authorization (EWA)</li>
<li>Photo Report</li>
</ul>
<p>Could you please confirm receipt and provide a status update on the claim?</p>
<p>Thank you.</p>""",
        },
        "initial_send": {
            "subject": f"Water Mitigation Documents Submitted - Claim #{claim_number}",
            "body": f"""<p>{greeting_line} I hope this email finds you well.</p>
<p>Please find the attached documentation for the water mitigation work{f' at {property_address}' if property_address else ''}.</p>
<p>I would appreciate a brief confirmation of receipt, and let me know if you have any questions.</p>
<p>Thank you.</p>""",
        },
        "followup": {
            "subject": f"Follow-up: Claim #{claim_number} - Document Status",
            "body": f"""<p>{greeting_line}</p>
<p>I am following up on the documents submitted for Claim #{claim_number}{f' at {property_address}' if property_address else ''}.</p>
<p>Could you please confirm whether you have received the documents? I would also appreciate any update on the claim status.</p>
<p>Please let me know if there is anything else needed from our end.</p>
<p>Thanks for your time!</p>""",
        },
        "payment_inquiry": {
            "subject": f"Payment Status Inquiry - Claim #{claim_number}",
            "body": f"""<p>{greeting_line}</p>
<p>I am writing to inquire about the payment status for Claim #{claim_number}{f' ({property_address})' if property_address else ''}.</p>
<p>Could you please provide an update on when we can expect the payment to be processed?</p>
<p>If the check has already been issued, could you confirm the date and the recipient?</p>
<p>Thanks for your time!</p>""",
        },
        "supplement": {
            "subject": f"Supplement Estimate Submitted - Claim #{claim_number}",
            "body": f"""<p>{greeting_line}</p>
<p>I am writing to follow up on the supplement estimate submitted for Claim #{claim_number}{f' at {property_address}' if property_address else ''}.</p>
<p>Could you please provide an update on the review status?</p>
<p>Thank you.</p>""",
        },
        "estimate_request": {
            "subject": f"Rebuild Estimate Request - Claim #{claim_number}",
            "body": f"""<p>{greeting_line}</p>
<p>I am writing to request the rebuild estimate for Claim #{claim_number}{f' at {property_address}' if property_address else ''}.</p>
<p>Please let us know when we can expect to receive the estimate.</p>
<p>Thank you.</p>""",
        },
        "depreciation_recovery": {
            "subject": f"Recoverable Depreciation Request - Claim #{claim_number}",
            "body": f"""<p>{greeting_line}</p>
<p>I am writing regarding Claim #{claim_number}{f' at {property_address}' if property_address else ''}.</p>
<p>The repair/construction work has been completed. We have submitted all required completion documents and are requesting the release of the recoverable depreciation funds.</p>
<p>Please let us know if any additional documentation is needed to process this payment.</p>
<p>Thank you for your prompt attention to this matter.</p>""",
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
