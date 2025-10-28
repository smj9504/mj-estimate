"""
Email service for sending emails via SMTP
"""
import smtplib
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

            with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=30) as server:
                server.set_debuglevel(1)  # Enable debug output
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

        subject = "Reset Your Password - MJ Estimate"

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
                    <p>We received a request to reset your password for your MJ Estimate account.</p>
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
                        <p>This is an automated message from MJ Estimate. Please do not reply to this email.</p>
                    </div>
                </div>
            </div>
        </body>
        </html>
        """

        text_content = f"""
        Password Reset Request

        Hello,

        We received a request to reset your password for your MJ Estimate account.

        Click the link below to reset your password:
        {reset_link}

        This link will expire in 1 hour.

        If you didn't request a password reset, you can safely ignore this email.

        ---
        This is an automated message from MJ Estimate. Please do not reply to this email.
        """

        return EmailService.send_email(
            to_email=to_email,
            subject=subject,
            html_content=html_content,
            text_content=text_content
        )

    @staticmethod
    def send_welcome_email(to_email: str, username: str) -> bool:
        """
        Send welcome email to new users

        Args:
            to_email: User's email address
            username: User's username

        Returns:
            bool: True if email sent successfully
        """
        subject = "Welcome to MJ Estimate"

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
                    background-color: #52c41a;
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
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>Welcome to MJ Estimate!</h1>
                </div>
                <div class="content">
                    <p>Hi {username},</p>
                    <p>Your account has been successfully created. You can now log in and start using MJ Estimate.</p>
                    <p style="text-align: center;">
                        <a href="{settings.FRONTEND_URL}/login" class="button">Go to Login</a>
                    </p>
                    <p>If you have any questions, feel free to contact our support team.</p>
                </div>
            </div>
        </body>
        </html>
        """

        text_content = f"""
        Welcome to MJ Estimate!

        Hi {username},

        Your account has been successfully created. You can now log in and start using MJ Estimate.

        Login at: {settings.FRONTEND_URL}/login

        If you have any questions, feel free to contact our support team.
        """

        return EmailService.send_email(
            to_email=to_email,
            subject=subject,
            html_content=html_content,
            text_content=text_content
        )


# Create singleton instance
email_service = EmailService()
