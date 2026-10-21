"""
Email service for sending emails via SMTP
"""
import smtplib
from html import escape
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from typing import List, Optional
import logging

from app.core.config import settings

logger = logging.getLogger(__name__)


class EmailService:
    """Service for sending emails"""

    @staticmethod
    def send_email(
        to_email: str,
        subject: str,
        html_content: str,
        text_content: Optional[str] = None
    ) -> bool:
        """
        Send an email via SMTP

        Args:
            to_email: Recipient email address
            subject: Email subject
            html_content: HTML content of the email
            text_content: Plain text content (fallback)

        Returns:
            bool: True if email sent successfully, False otherwise
        """
        if not settings.EMAIL_ENABLED:
            logger.warning(f"Email sending is disabled. Would have sent to: {to_email}")
            logger.info(f"Subject: {subject}")
            logger.info(f"Content: {html_content[:200]}...")
            return False

        if not settings.SMTP_USER or not settings.SMTP_PASSWORD:
            logger.error("SMTP credentials not configured")
            return False

        try:
            # Create message
            message = MIMEMultipart('alternative')
            message['From'] = f"{settings.SMTP_FROM_NAME} <{settings.SMTP_FROM_EMAIL}>"
            message['To'] = to_email
            message['Subject'] = subject

            # Add text and HTML parts
            if text_content:
                text_part = MIMEText(text_content, 'plain')
                message.attach(text_part)

            html_part = MIMEText(html_content, 'html')
            message.attach(html_part)

            # Connect to SMTP server and send
            logger.info(f"Attempting to send email to {to_email} via {settings.SMTP_HOST}:{settings.SMTP_PORT}")
            logger.info(f"Using SMTP user: {settings.SMTP_USER}")

            # No set_debuglevel: its output includes the AUTH line, i.e. the
            # base64-encoded SMTP username and password
            with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=30) as server:
                logger.info("Starting TLS...")
                server.starttls()
                logger.info("Logging in to SMTP server...")
                server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
                logger.info("Sending message...")
                server.send_message(message)

            logger.info(f"✅ Email sent successfully to {to_email}")
            return True

        except smtplib.SMTPAuthenticationError as e:
            logger.error(f"❌ SMTP Authentication failed: {e}")
            logger.error(f"Check your Gmail App Password and ensure 2FA is enabled")
            return False
        except smtplib.SMTPException as e:
            logger.error(f"❌ SMTP error occurred: {e}")
            return False
        except Exception as e:
            logger.error(f"❌ Failed to send email to {to_email}: {e}")
            import traceback
            logger.error(traceback.format_exc())
            return False

    @staticmethod
    def send_password_reset_email(to_email: str, token: str) -> bool:
        """
        Send password reset email

        Args:
            to_email: User's email address
            token: Password reset token

        Returns:
            bool: True if email sent successfully
        """
        brand = settings.SMTP_FROM_NAME
        reset_link = f"{settings.FRONTEND_URL}/reset-password?token={token}"
        subject = f"Reset your {brand} password"

        html_content = _account_email(
            title=subject,
            preheader="Use the link inside to choose a new password. It expires in 1 hour.",
            heading="Reset your password",
            body=(
                _paragraph(f"We got a request to reset the password for your {escape(brand)} account. "
                           "Choose a new one with the button below.")
                + _button(reset_link, "Reset password")
                + _paragraph("This link expires in <strong style=\"color:#37352f; font-weight:500;\">1 hour</strong>.",
                             muted=True, top=24, bottom=0)
                + _link_fallback(reset_link)
            ),
            footer=("Didn't ask for this? Ignore this email and your password stays the same. "
                    "This is an automated message; replies aren't read."),
        )

        text_content = f"""Reset your password

We got a request to reset the password for your {brand} account.
Choose a new one here:
{reset_link}

This link expires in 1 hour.

Didn't ask for this? Ignore this email and your password stays the same.
This is an automated message; replies aren't read.
"""

        return EmailService.send_email(
            to_email=to_email,
            subject=subject,
            html_content=html_content,
            text_content=text_content
        )

    @staticmethod
    def send_password_change_code(to_email: str, code: str, minutes: int) -> bool:
        """
        Send the code someone enters on their profile to change their password

        Returns:
            bool: True if email sent successfully
        """
        brand = settings.SMTP_FROM_NAME
        subject = f"Your password change code - {brand}"

        code_box = (
            '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" '
            'style="background-color:#f7f7f5; border-radius:8px; margin:0 0 24px;">'
            f'<tr><td align="center" style="padding:18px 16px; font-family:{FONT}; font-size:30px; '
            'font-weight:600; letter-spacing:8px; color:#37352f;">'
            f'{escape(code)}</td></tr></table>'
        )
        html_content = _account_email(
            title=subject,
            preheader=f"Your code is {code}. It expires in {minutes} minutes.",
            heading="Your password change code",
            body=(
                _paragraph(f"Enter this code on your profile to change your {escape(brand)} password.")
                + code_box
                + _paragraph(f"It expires in {minutes} minutes.", muted=True, bottom=0)
            ),
            footer=("Didn't ask to change your password? Ignore this email and tell your "
                    "administrator. Your password stays the same."),
        )

        text_content = f"""Use this code to change your {brand} password: {code}

It expires in {minutes} minutes.

If you didn't ask to change your password, ignore this email and tell
your administrator. Your password stays the same.
"""

        return EmailService.send_email(
            to_email=to_email,
            subject=subject,
            html_content=html_content,
            text_content=text_content
        )

    @staticmethod
    def send_welcome_email(to_email: str, username: str, first_name: Optional[str] = None) -> bool:
        """
        Send welcome email to new users

        Args:
            to_email: User's email address
            username: User's username, which they sign in with
            first_name: Used in the greeting when known

        Returns:
            bool: True if email sent successfully
        """
        brand = settings.SMTP_FROM_NAME
        login_url = f"{settings.FRONTEND_URL}/login"
        name = first_name or username
        subject = f"Welcome to {brand}"

        username_box = (
            '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" '
            'style="background-color:#f7f7f5; border-radius:8px; margin:0 0 28px;">'
            f'<tr><td style="padding:14px 16px; font-family:{FONT}; font-size:13px; line-height:1.4; color:#73726e;">'
            'Username'
            f'<div style="margin-top:2px; font-size:15px; font-weight:500; color:#37352f;">{escape(username)}</div>'
            '</td></tr></table>'
        )
        html_content = _account_email(
            title=subject,
            preheader=f"Your {brand} account is ready. Sign in with {username}.",
            heading=f"Welcome, {escape(name)}",
            body=(
                _paragraph(f"Your {escape(brand)} account is ready. Sign in to get started.")
                + username_box
                + _button(login_url, f"Sign in to {brand}")
                + _link_fallback(login_url)
            ),
            footer=(f"You're getting this because an account was created for {escape(to_email)}. "
                    "Questions? Ask your administrator."),
        )

        text_content = f"""Welcome, {name}

Your {brand} account is ready. Sign in to get started.

Username: {username}
Sign in: {login_url}

You're getting this because an account was created for {to_email}.
Questions? Ask your administrator.
"""

        return EmailService.send_email(
            to_email=to_email,
            subject=subject,
            html_content=html_content,
            text_content=text_content
        )


# ============================================================
# Account email layout
# ============================================================
# Email clients drop <style> blocks and flexbox unevenly, so these are tables
# with inline styles. Colours and type follow DESIGN.md. Arguments marked
# html are inserted as is: escape anything a user typed before passing it.

FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif"


def _paragraph(html: str, muted: bool = False, top: int = 0, bottom: int = 24) -> str:
    color, size = ('#73726e', 13) if muted else ('#5f5e5b', 15)
    return (f'<p style="margin:{top}px 0 {bottom}px; font-family:{FONT}; font-size:{size}px; '
            f'line-height:1.6; color:{color};">{html}</p>')


def _button(url: str, label: str) -> str:
    return (
        '<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>'
        '<td style="border-radius:8px; background-color:#1f74c9;">'
        f'<a href="{escape(url)}" style="display:inline-block; padding:12px 24px; font-family:{FONT}; '
        'font-size:15px; font-weight:500; color:#ffffff; text-decoration:none; border-radius:8px;">'
        f'{escape(label)}</a></td></tr></table>'
    )


def _link_fallback(url: str) -> str:
    """The link as text, for clients that strip the button."""
    u = escape(url)
    return (f'<p style="margin:28px 0 0; font-family:{FONT}; font-size:13px; line-height:1.5; color:#73726e;">'
            f'Button not working? Open <a href="{u}" style="color:#1f74c9; text-decoration:none; '
            f'word-break:break-all;">{u}</a></p>')


def _account_email(title: str, preheader: str, heading: str, body: str, footer: str) -> str:
    """Brand name over a white card on a light page, with a small footer.

    heading, body and footer are html; title and preheader are plain text.
    """
    brand = escape(settings.SMTP_FROM_NAME)
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>{escape(title)}</title>
</head>
<body style="margin:0; padding:0; background-color:#f7f7f5;">
<div style="display:none; max-height:0; overflow:hidden;">{escape(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f7f7f5;">
  <tr>
    <td align="center" style="padding:40px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;">
        <tr>
          <td style="padding:0 4px 20px; font-family:{FONT}; font-size:15px; font-weight:600; letter-spacing:-0.01em; color:#37352f;">
            {brand}
          </td>
        </tr>
        <tr>
          <td style="background-color:#ffffff; border:1px solid #e9e9e7; border-radius:12px; padding:36px 28px;">
            <h1 style="margin:0 0 12px; font-family:{FONT}; font-size:24px; line-height:1.3; font-weight:600; letter-spacing:-0.015em; color:#37352f;">
              {heading}
            </h1>
            {body}
          </td>
        </tr>
        <tr>
          <td style="padding:20px 4px 0; font-family:{FONT}; font-size:12px; line-height:1.5; color:#a5a29a;">
            {footer}
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>
"""


# Create singleton instance
email_service = EmailService()
