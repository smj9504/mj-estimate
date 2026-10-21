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
        reset_link = f"{settings.FRONTEND_URL}/reset-password?token={token}"

        subject = "Reset Your Password - SimpleWorks"

        html_content = f"""
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <style>
                body {{
                    font-family: Arial, sans-serif;
                    line-height: 1.6;
                    color: #333;
                }}
                .container {{
                    max-width: 600px;
                    margin: 0 auto;
                    padding: 20px;
                }}
                .header {{
                    background-color: #1890ff;
                    color: white;
                    padding: 20px;
                    text-align: center;
                    border-radius: 5px 5px 0 0;
                }}
                .content {{
                    background-color: #f5f5f5;
                    padding: 30px;
                    border-radius: 0 0 5px 5px;
                }}
                .button {{
                    display: inline-block;
                    padding: 12px 30px;
                    background-color: #1890ff;
                    color: white;
                    text-decoration: none;
                    border-radius: 5px;
                    margin: 20px 0;
                }}
                .footer {{
                    margin-top: 30px;
                    padding-top: 20px;
                    border-top: 1px solid #ddd;
                    font-size: 12px;
                    color: #666;
                }}
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>Password Reset Request</h1>
                </div>
                <div class="content">
                    <p>Hello,</p>
                    <p>We received a request to reset your password for your SimpleWorks account.</p>
                    <p>Click the button below to reset your password:</p>
                    <p style="text-align: center;">
                        <a href="{reset_link}" class="button">Reset Password</a>
                    </p>
                    <p>Or copy and paste this link into your browser:</p>
                    <p style="word-break: break-all; color: #1890ff;">
                        {reset_link}
                    </p>
                    <p><strong>This link will expire in 1 hour.</strong></p>
                    <p>If you didn't request a password reset, you can safely ignore this email.</p>
                    <div class="footer">
                        <p>This is an automated message from SimpleWorks. Please do not reply to this email.</p>
                    </div>
                </div>
            </div>
        </body>
        </html>
        """

        text_content = f"""
        Password Reset Request

        Hello,

        We received a request to reset your password for your SimpleWorks account.

        Click the link below to reset your password:
        {reset_link}

        This link will expire in 1 hour.

        If you didn't request a password reset, you can safely ignore this email.

        ---
        This is an automated message from SimpleWorks. Please do not reply to this email.
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
        sender = settings.SMTP_FROM_NAME
        subject = f"Your password change code - {sender}"

        html_content = f"""
        <!DOCTYPE html>
        <html>
        <head><meta charset="utf-8"></head>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #37352f;">
            <div style="max-width: 480px; margin: 0 auto; padding: 24px;">
                <p>Use this code to change your {sender} password:</p>
                <p style="font-size: 28px; font-weight: 600; letter-spacing: 6px; margin: 16px 0;">{code}</p>
                <p>It expires in {minutes} minutes.</p>
                <p style="color: #73726e; font-size: 13px;">
                    If you didn't ask to change your password, ignore this email
                    and tell your administrator. Your password stays the same.
                </p>
            </div>
        </body>
        </html>
        """

        text_content = f"""
        Use this code to change your {sender} password: {code}

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

        # Email clients drop <style> blocks and flexbox unevenly, so the layout
        # is tables with inline styles. Colours and type follow DESIGN.md.
        font = ("-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, "
                "Arial, sans-serif")
        b, n, u, url = (escape(brand), escape(name), escape(username), escape(login_url))

        html_content = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>Welcome to {b}</title>
</head>
<body style="margin:0; padding:0; background-color:#f7f7f5;">
<div style="display:none; max-height:0; overflow:hidden;">Your {b} account is ready. Sign in with {u}.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f7f7f5;">
  <tr>
    <td align="center" style="padding:40px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;">
        <tr>
          <td style="padding:0 4px 20px; font-family:{font}; font-size:15px; font-weight:600; letter-spacing:-0.01em; color:#37352f;">
            {b}
          </td>
        </tr>
        <tr>
          <td style="background-color:#ffffff; border:1px solid #e9e9e7; border-radius:12px; padding:36px 32px;">
            <h1 style="margin:0 0 12px; font-family:{font}; font-size:24px; line-height:1.3; font-weight:600; letter-spacing:-0.015em; color:#37352f;">
              Welcome, {n}
            </h1>
            <p style="margin:0 0 24px; font-family:{font}; font-size:15px; line-height:1.6; color:#5f5e5b;">
              Your {b} account is ready. Sign in to get started.
            </p>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f7f7f5; border-radius:8px; margin:0 0 28px;">
              <tr>
                <td style="padding:14px 16px; font-family:{font}; font-size:13px; line-height:1.4; color:#73726e;">
                  Username
                  <div style="margin-top:2px; font-size:15px; font-weight:500; color:#37352f;">{u}</div>
                </td>
              </tr>
            </table>
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="border-radius:8px; background-color:#1f74c9;">
                  <a href="{url}" style="display:inline-block; padding:12px 24px; font-family:{font}; font-size:15px; font-weight:500; color:#ffffff; text-decoration:none; border-radius:8px;">
                    Sign in to {b}
                  </a>
                </td>
              </tr>
            </table>
            <p style="margin:28px 0 0; font-family:{font}; font-size:13px; line-height:1.5; color:#73726e;">
              Button not working? Open <a href="{url}" style="color:#1f74c9; text-decoration:none; word-break:break-all;">{url}</a>
            </p>
          </td>
        </tr>
        <tr>
          <td style="padding:20px 4px 0; font-family:{font}; font-size:12px; line-height:1.5; color:#a5a29a;">
            You're getting this because an account was created for {escape(to_email)}.
            Questions? Ask your administrator.
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>
"""

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


# Create singleton instance
email_service = EmailService()
