"""
Email Ingestion service - orchestrates polling, classification, matching, and upload.
"""

import io
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from cryptography.fernet import Fernet

from app.core.config import settings

logger = logging.getLogger(__name__)

# Encryption key for email passwords
# Generate once: Fernet.generate_key() and store in env
_ENCRYPTION_KEY = getattr(settings, "EMAIL_ENCRYPTION_KEY", None)


def _get_fernet() -> Fernet:
    """Get Fernet instance for password encryption/decryption"""
    key = _ENCRYPTION_KEY or settings.SECRET_KEY[:32].ljust(32, "=")
    # Fernet requires url-safe base64 encoded 32 bytes
    import base64
    padded = key.encode("utf-8")[:32].ljust(32, b"\0")
    key_b64 = base64.urlsafe_b64encode(padded)
    return Fernet(key_b64)


def encrypt_password(password: str) -> str:
    """Encrypt a password for storage"""
    f = _get_fernet()
    return f.encrypt(password.encode("utf-8")).decode("utf-8")


def decrypt_password(encrypted: str) -> str:
    """Decrypt a stored password"""
    f = _get_fernet()
    return f.decrypt(encrypted.encode("utf-8")).decode("utf-8")


class EmailIngestionService:
    """Orchestrates the email ingestion pipeline"""

    def __init__(self, database=None):
        from app.core.database_factory import get_database
        self.database = database or get_database()

    def _get_session(self):
        return self.database.get_session()

    def _get_readonly_session(self):
        return self.database.get_readonly_session()

    # ============================================================
    # Account Management
    # ============================================================

    def create_account(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Create a new email account with encrypted password"""
        session = self._get_session()
        try:
            from app.domains.email_ingestion.repository import get_email_account_repository
            repo = get_email_account_repository(session)

            # Encrypt password
            plain_password = data.pop("password")
            data["encrypted_password"] = encrypt_password(plain_password)

            result = repo.create(data)
            session.commit()
            return result
        except Exception as e:
            session.rollback()
            logger.error(f"Error creating email account: {e}")
            raise
        finally:
            session.close()

    def update_account(self, account_id: str, data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Update an email account"""
        session = self._get_session()
        try:
            from app.domains.email_ingestion.repository import get_email_account_repository
            repo = get_email_account_repository(session)

            # Encrypt password if provided
            if "password" in data and data["password"]:
                data["encrypted_password"] = encrypt_password(data.pop("password"))
            else:
                data.pop("password", None)

            result = repo.update(account_id, data)
            session.commit()
            return result
        except Exception as e:
            session.rollback()
            raise
        finally:
            session.close()

    def delete_account(self, account_id: str) -> bool:
        """Delete an email account"""
        session = self._get_session()
        try:
            from app.domains.email_ingestion.repository import get_email_account_repository
            repo = get_email_account_repository(session)
            result = repo.delete(account_id)
            session.commit()
            return result
        except Exception as e:
            session.rollback()
            raise
        finally:
            session.close()

    def get_accounts(self, company_id: Optional[str] = None) -> List[Dict[str, Any]]:
        """Get all email accounts"""
        session = self._get_readonly_session()
        try:
            from app.domains.email_ingestion.repository import get_email_account_repository
            repo = get_email_account_repository(session)
            return repo.get_active_accounts(company_id)
        finally:
            session.close()

    def get_account(self, account_id: str) -> Optional[Dict[str, Any]]:
        """Get a single email account"""
        session = self._get_readonly_session()
        try:
            from app.domains.email_ingestion.repository import get_email_account_repository
            repo = get_email_account_repository(session)
            return repo.get_by_id(account_id)
        finally:
            session.close()

    def get_all_accounts(self) -> List[Dict[str, Any]]:
        """Get all email accounts (active and inactive), enriched with company_name"""
        session = self._get_readonly_session()
        try:
            from app.domains.email_ingestion.repository import get_email_account_repository
            repo = get_email_account_repository(session)
            accounts = repo.get_all(order_by="-created_at")
            self._enrich_with_company_name(session, accounts)
            return accounts
        finally:
            session.close()

    def _enrich_with_company_name(self, session, accounts: List[Dict[str, Any]]):
        """Add company_name to each account dict"""
        company_ids = [
            str(a['company_id']) for a in accounts
            if a.get('company_id')
        ]
        if not company_ids:
            return
        from app.domains.company.models import Company
        companies = session.query(
            Company.id, Company.name
        ).filter(Company.id.in_(company_ids)).all()
        name_map = {str(c.id): c.name for c in companies}
        for a in accounts:
            cid = str(a['company_id']) if a.get('company_id') else None
            a['company_name'] = name_map.get(cid) if cid else None

    def connect_oauth(self, code: str, data: Dict[str, Any]) -> Dict[str, Any]:
        """Connect an email account via Google OAuth.
        Creates a new account or updates existing one."""
        from google.oauth2.credentials import Credentials
        from google_auth_oauthlib.flow import Flow
        from googleapiclient.discovery import build
        from app.core.config import settings
        from app.core.encryption import encrypt_text
        from app.domains.email_ingestion.repository import (
            get_email_account_repository,
        )

        # Gmail scopes for IMAP + SMTP
        scopes = [
            "https://mail.google.com/",
            "https://www.googleapis.com/auth/userinfo.email",
            "openid",
        ]

        client_config = {
            "web": {
                "client_id": settings.GOOGLE_OAUTH_CLIENT_ID,
                "client_secret": settings.GOOGLE_OAUTH_CLIENT_SECRET,
                "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                "token_uri": "https://oauth2.googleapis.com/token",
                "redirect_uris": [
                    settings.GOOGLE_OAUTH_REDIRECT_URI
                ],
            }
        }

        flow = Flow.from_client_config(
            client_config,
            scopes=scopes,
            redirect_uri=settings.GOOGLE_OAUTH_REDIRECT_URI,
        )
        flow.fetch_token(code=code)
        creds = flow.credentials

        # Get user email
        svc = build("oauth2", "v2", credentials=creds)
        userinfo = svc.userinfo().get().execute()
        email_address = userinfo.get("email", "")
        display_name = userinfo.get("name", email_address)

        session = self._get_session()
        try:
            repo = get_email_account_repository(session)

            # Check if account with this email already exists
            existing = repo.get_by_email(email_address)

            account_data = {
                "auth_method": "oauth",
                "oauth_access_token": encrypt_text(creds.token),
                "oauth_refresh_token": encrypt_text(
                    creds.refresh_token
                ) if creds.refresh_token else None,
                "oauth_token_expiry": creds.expiry,
                "encrypted_password": encrypt_password("oauth"),
                "is_active": True,
            }

            if existing:
                # Update existing account to OAuth
                account_data.update({
                    k: v for k, v in data.items()
                    if v is not None and k in (
                        "company_id", "sender_name", "sender_phone",
                    )
                })
                result = repo.update(str(existing["id"]), account_data)
            else:
                # Detect provider
                domain = email_address.split("@")[1] if "@" in email_address else ""
                provider = "gmail"
                if "outlook" in domain or "office" in domain:
                    provider = "outlook"

                account_data.update({
                    "display_name": data.get("sender_name") or display_name,
                    "email_address": email_address,
                    "provider_type": provider,
                    "imap_server": "imap.gmail.com",
                    "imap_port": 993,
                    "use_ssl": True,
                    "username": email_address,
                    "company_id": data.get("company_id"),
                    "sender_name": data.get("sender_name"),
                    "sender_phone": data.get("sender_phone"),
                })
                result = repo.create(account_data)

            session.commit()
            self._enrich_with_company_name(session, [result])
            return result
        except Exception as e:
            session.rollback()
            logger.error(f"OAuth connect failed: {e}")
            raise
        finally:
            session.close()

    def get_oauth_url(self) -> Dict[str, str]:
        """Generate Google OAuth authorization URL for email access"""
        from app.core.config import settings
        from google_auth_oauthlib.flow import Flow

        scopes = [
            "https://mail.google.com/",
            "https://www.googleapis.com/auth/userinfo.email",
            "openid",
        ]

        client_config = {
            "web": {
                "client_id": settings.GOOGLE_OAUTH_CLIENT_ID,
                "client_secret": settings.GOOGLE_OAUTH_CLIENT_SECRET,
                "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                "token_uri": "https://oauth2.googleapis.com/token",
                "redirect_uris": [
                    settings.GOOGLE_OAUTH_REDIRECT_URI
                ],
            }
        }

        flow = Flow.from_client_config(
            client_config,
            scopes=scopes,
            redirect_uri=settings.GOOGLE_OAUTH_REDIRECT_URI,
        )

        auth_url, state = flow.authorization_url(
            access_type="offline",
            include_granted_scopes="true",
            prompt="consent",
            state="email_account",
        )

        return {"authorization_url": auth_url, "state": state}

    def _build_imap_client(self, account: Dict[str, Any], session=None):
        """Build an IMAPClient with proper auth (password or OAuth)"""
        from app.domains.email_ingestion.email_client import IMAPClient

        auth_method = account.get("auth_method", "password")
        oauth_token = None
        password = ""

        if auth_method == "oauth":
            from app.domains.claim_followup.smtp_service import SmtpService
            smtp = SmtpService()
            oauth_token = smtp._get_fresh_oauth_token(
                account, session
            )
        else:
            password = decrypt_password(account["encrypted_password"])

        return IMAPClient(
            server=account["imap_server"],
            port=account["imap_port"],
            username=account["username"],
            password=password,
            use_ssl=account["use_ssl"],
            oauth_access_token=oauth_token,
        )

    def test_account(self, account_id: str) -> Dict[str, Any]:
        """Test IMAP connection for an account"""
        session = self._get_readonly_session()
        try:
            from app.domains.email_ingestion.repository import get_email_account_repository
            repo = get_email_account_repository(session)
            account = repo.get_by_id(account_id)

            if not account:
                return {"success": False, "message": "Account not found", "inbox_count": None}

            client = self._build_imap_client(account, session)
            success, message, inbox_count = client.test_connection()
            return {"success": success, "message": message, "inbox_count": inbox_count}
        except Exception as e:
            return {"success": False, "message": str(e), "inbox_count": None}
        finally:
            session.close()

    # ============================================================
    # Polling & Processing
    # ============================================================

    def poll_account(self, account_id: str) -> Dict[str, Any]:
        """Poll a single email account for new insurance estimate PDFs"""
        session = self._get_session()
        try:
            from app.domains.email_ingestion.repository import (
                get_email_account_repository,
                get_email_ingestion_log_repository,
            )
            account_repo = get_email_account_repository(session)
            log_repo = get_email_ingestion_log_repository(session)

            account = account_repo.get_by_id(account_id)
            if not account:
                raise ValueError(f"Account {account_id} not found")

            # Connect to IMAP
            imap = self._build_imap_client(account, session)

            # Fetch unseen emails with attachments
            emails = imap.fetch_unseen_with_attachments(
                since_date=account.get("last_synced_at"),
                limit=50,
            )

            stats = {
                "account_id": account_id,
                "account_email": account["email_address"],
                "emails_found": len(emails),
                "processed": 0,
                "uploaded": 0,
                "skipped": 0,
                "duplicates": 0,
                "errors": 0,
            }

            for fetched_email in emails:
                # Check if already processed
                if log_repo.exists_by_message_id(fetched_email.message_id):
                    stats["duplicates"] += 1
                    continue

                # Process each PDF attachment
                for attachment in fetched_email.pdf_attachments:
                    try:
                        result = self._process_attachment(
                            session=session,
                            log_repo=log_repo,
                            account=account,
                            fetched_email=fetched_email,
                            attachment=attachment,
                        )
                        stats["processed"] += 1
                        if result.get("status") == "uploaded":
                            stats["uploaded"] += 1
                        elif result.get("status") == "skipped":
                            stats["skipped"] += 1
                        elif result.get("status") == "duplicate":
                            stats["duplicates"] += 1
                    except Exception as e:
                        logger.error(f"Error processing attachment {attachment.filename}: {e}")
                        stats["errors"] += 1
                        # Log the error
                        log_repo.create({
                            "email_account_id": account_id,
                            "message_id": fetched_email.message_id,
                            "subject": fetched_email.subject,
                            "sender": fetched_email.sender,
                            "received_at": fetched_email.received_at,
                            "attachment_name": attachment.filename,
                            "attachment_hash": attachment.sha256_hash,
                            "status": "failed",
                            "error_message": str(e),
                        })
                        session.commit()

            # Update last_synced_at
            from app.domains.email_ingestion.models import EmailAccount
            acc = session.query(EmailAccount).filter(EmailAccount.id == account_id).first()
            if acc:
                acc.last_synced_at = datetime.now(timezone.utc)
                session.commit()

            return stats

        except Exception as e:
            session.rollback()
            logger.error(f"Error polling account {account_id}: {e}")
            raise
        finally:
            session.close()

    def poll_all_accounts(self) -> Dict[str, Any]:
        """Poll all active email accounts"""
        accounts = self.get_accounts()
        results = []
        total_processed = 0
        total_uploaded = 0

        for account in accounts:
            try:
                result = self.poll_account(str(account["id"]))
                results.append(result)
                total_processed += result["processed"]
                total_uploaded += result["uploaded"]
            except Exception as e:
                logger.error(f"Error polling account {account['email_address']}: {e}")
                results.append({
                    "account_id": str(account["id"]),
                    "account_email": account["email_address"],
                    "emails_found": 0,
                    "processed": 0,
                    "uploaded": 0,
                    "skipped": 0,
                    "duplicates": 0,
                    "errors": 1,
                })

        return {
            "accounts_polled": len(results),
            "results": results,
            "total_processed": total_processed,
            "total_uploaded": total_uploaded,
        }

    def _process_attachment(
        self,
        session,
        log_repo,
        account: Dict[str, Any],
        fetched_email,
        attachment,
    ) -> Dict[str, Any]:
        """Process a single PDF attachment through the pipeline"""
        from app.domains.email_ingestion.classifier import (
            classify_email_attachment,
            extract_pdf_text_first_pages,
        )
        from app.domains.email_ingestion.matcher import match_email_to_client

        account_id = str(account["id"])

        # Step 1: Check attachment hash duplicate
        if log_repo.exists_by_attachment_hash(attachment.sha256_hash):
            log_data = {
                "email_account_id": account_id,
                "message_id": fetched_email.message_id,
                "subject": fetched_email.subject,
                "sender": fetched_email.sender,
                "received_at": fetched_email.received_at,
                "attachment_name": attachment.filename,
                "attachment_hash": attachment.sha256_hash,
                "status": "duplicate",
                "skip_reason": "Attachment with same hash already uploaded",
            }
            log_repo.create(log_data)
            session.commit()
            return {"status": "duplicate"}

        # Step 2: Classify
        is_estimate, confidence, reason = classify_email_attachment(
            sender=fetched_email.sender,
            subject=fetched_email.subject,
            body=fetched_email.body_text,
            pdf_data=attachment.data,
        )

        if not is_estimate:
            log_data = {
                "email_account_id": account_id,
                "message_id": fetched_email.message_id,
                "subject": fetched_email.subject,
                "sender": fetched_email.sender,
                "received_at": fetched_email.received_at,
                "attachment_name": attachment.filename,
                "attachment_hash": attachment.sha256_hash,
                "status": "skipped",
                "is_insurance_estimate": False,
                "classification_reason": reason,
                "skip_reason": f"Not classified as insurance estimate (confidence: {confidence}%)",
            }
            log_repo.create(log_data)
            session.commit()
            return {"status": "skipped"}

        # Step 3: Match to client/claim
        pdf_text = extract_pdf_text_first_pages(attachment.data)
        email_text = f"Subject: {fetched_email.subject}\n{fetched_email.body_text}"
        match_result = match_email_to_client(session, email_text, pdf_text)

        if not match_result.client_id:
            # No match - create pending log for manual review
            log_data = {
                "email_account_id": account_id,
                "message_id": fetched_email.message_id,
                "subject": fetched_email.subject,
                "sender": fetched_email.sender,
                "received_at": fetched_email.received_at,
                "attachment_name": attachment.filename,
                "attachment_hash": attachment.sha256_hash,
                "status": "pending",
                "is_insurance_estimate": True,
                "classification_reason": reason,
            }
            log_repo.create(log_data)
            session.commit()
            return {"status": "pending"}

        # Step 4: Create claim if needed
        claim_created = False
        claim_id = match_result.claim_id

        if match_result.needs_new_claim and not claim_id:
            claim_id, claim_created = self._create_claim_for_match(
                session, match_result, fetched_email
            )

        # Step 5: Check duplicate for this specific claim
        if claim_id and log_repo.exists_by_attachment_hash(attachment.sha256_hash, claim_id):
            log_data = {
                "email_account_id": account_id,
                "message_id": fetched_email.message_id,
                "subject": fetched_email.subject,
                "sender": fetched_email.sender,
                "received_at": fetched_email.received_at,
                "attachment_name": attachment.filename,
                "attachment_hash": attachment.sha256_hash,
                "status": "duplicate",
                "matched_client_id": match_result.client_id,
                "matched_claim_id": claim_id,
                "skip_reason": "Same file already uploaded to this claim",
            }
            log_repo.create(log_data)
            session.commit()
            return {"status": "duplicate"}

        # Step 6: Upload file and create negotiation
        file_id, negotiation_id = self._upload_and_create_negotiation(
            session, claim_id, attachment, fetched_email
        )

        # Step 7: Create success log
        log_data = {
            "email_account_id": account_id,
            "message_id": fetched_email.message_id,
            "subject": fetched_email.subject,
            "sender": fetched_email.sender,
            "received_at": fetched_email.received_at,
            "attachment_name": attachment.filename,
            "attachment_hash": attachment.sha256_hash,
            "status": "uploaded",
            "is_insurance_estimate": True,
            "classification_reason": reason,
            "matched_client_id": match_result.client_id,
            "matched_claim_id": claim_id,
            "match_method": match_result.method,
            "match_confidence": match_result.confidence,
            "claim_created": claim_created,
            "negotiation_id": negotiation_id,
            "file_id": file_id,
        }
        log_repo.create(log_data)
        session.commit()

        return {"status": "uploaded", "file_id": file_id, "negotiation_id": negotiation_id}

    def _create_claim_for_match(
        self, session, match_result, fetched_email
    ) -> tuple:
        """Create a new claim for a matched client"""
        from app.domains.client.models import Claim

        claim_number = match_result.claim_number_extracted or f"AUTO-{datetime.now().strftime('%Y%m%d%H%M%S')}"

        claim = Claim(
            client_id=match_result.client_id,
            claim_number=claim_number,
            insurance_policy_number=match_result.policy_number_extracted,
            status="open",
            notes=f"Auto-created from email: {fetched_email.subject}",
        )
        session.add(claim)
        session.flush()

        return str(claim.id), True

    def _upload_and_create_negotiation(
        self, session, claim_id, attachment, fetched_email
    ) -> tuple:
        """Upload PDF file and create ClaimNegotiation entry"""
        from app.domains.file.models import File
        from app.domains.client.models import ClaimNegotiation
        from app.domains.client.repository import get_claim_negotiation_repository

        # Upload file using storage system
        import uuid
        file_id = str(uuid.uuid4())

        try:
            from app.domains.file.service import FileService
            file_service = FileService()

            import asyncio
            loop = asyncio.get_event_loop()
            if loop.is_running():
                import concurrent.futures
                with concurrent.futures.ThreadPoolExecutor() as pool:
                    file_result = pool.submit(
                        asyncio.run,
                        file_service.upload_file(
                            file_data=io.BytesIO(attachment.data),
                            original_filename=attachment.filename,
                            content_type="application/pdf",
                            context="claim-negotiation",
                            context_id=claim_id,
                            category="insurance-estimate",
                            description=f"Auto-ingested from email: {fetched_email.subject}",
                        )
                    ).result()
                    file_id = file_result.get("id", file_id)
                    file_url = file_result.get("url", "")
            else:
                file_result = asyncio.run(
                    file_service.upload_file(
                        file_data=io.BytesIO(attachment.data),
                        original_filename=attachment.filename,
                        content_type="application/pdf",
                        context="claim-negotiation",
                        context_id=claim_id,
                        category="insurance-estimate",
                        description=f"Auto-ingested from email: {fetched_email.subject}",
                    )
                )
                file_id = file_result.get("id", file_id)
                file_url = file_result.get("url", "")
        except Exception as e:
            logger.warning(f"Storage upload failed, saving file record directly: {e}")
            # Fallback: storage.upload() never ran, so this url is a plain
            # local-style path, not a real cloud location - mark it 'local'
            # so download code doesn't mistake it for a genuine cloud file.
            file_url = f"/uploads/claim-negotiation/{claim_id}/{attachment.filename}"
            file_record = File(
                id=file_id,
                filename=attachment.filename,
                original_name=attachment.filename,
                content_type="application/pdf",
                size=len(attachment.data),
                url=file_url,
                storage_provider="local",
                context="claim-negotiation",
                context_id=claim_id,
                category="insurance-estimate",
                description=f"Auto-ingested from email: {fetched_email.subject}",
            )
            session.add(file_record)
            session.flush()

        # Create ClaimNegotiation
        neg_repo = get_claim_negotiation_repository(session)
        next_rev = neg_repo.get_next_revision_number(claim_id)

        negotiation_data = {
            "claim_id": claim_id,
            "revision_number": next_rev,
            "revision_type": "initial" if next_rev == 1 else "supplement",
            "date_received": fetched_email.received_at or datetime.now(timezone.utc),
            "received_from": fetched_email.sender,
            "document_url": file_url if 'file_url' in dir() else "",
            "document_name": attachment.filename,
            "notes": f"Auto-ingested from email: {fetched_email.subject}",
        }
        neg_result = neg_repo.create_and_update_claim(negotiation_data)

        return file_id, str(neg_result.get("id", ""))

    # ============================================================
    # Log Management
    # ============================================================

    def get_logs(
        self,
        status: Optional[str] = None,
        account_id: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> List[Dict[str, Any]]:
        """Get ingestion logs with filters"""
        session = self._get_readonly_session()
        try:
            from app.domains.email_ingestion.repository import get_email_ingestion_log_repository
            repo = get_email_ingestion_log_repository(session)
            logs = repo.get_logs_with_filters(status, account_id, limit, offset)

            # Enrich with client/claim names
            for log in logs:
                if log.get("matched_client_id"):
                    from app.domains.client.models import Client
                    client = session.query(Client).filter(
                        Client.id == log["matched_client_id"]
                    ).first()
                    log["client_name"] = client.display_name if client else None

                if log.get("matched_claim_id"):
                    from app.domains.client.models import Claim
                    claim = session.query(Claim).filter(
                        Claim.id == log["matched_claim_id"]
                    ).first()
                    log["claim_number"] = claim.claim_number if claim else None

                if log.get("email_account_id"):
                    from app.domains.email_ingestion.models import EmailAccount
                    acc = session.query(EmailAccount).filter(
                        EmailAccount.id == log["email_account_id"]
                    ).first()
                    log["account_email"] = acc.email_address if acc else None

            return logs
        finally:
            session.close()

    def get_pending_logs(self) -> List[Dict[str, Any]]:
        """Get logs needing manual review"""
        return self.get_logs(status="pending")

    def get_stats(self) -> Dict[str, int]:
        """Get ingestion statistics"""
        session = self._get_readonly_session()
        try:
            from app.domains.email_ingestion.repository import get_email_ingestion_log_repository
            repo = get_email_ingestion_log_repository(session)
            return repo.get_stats()
        finally:
            session.close()

    def manual_assign(self, log_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
        """Manually assign a pending log to a client/claim and process it"""
        session = self._get_session()
        try:
            from app.domains.email_ingestion.repository import get_email_ingestion_log_repository
            from app.domains.email_ingestion.models import EmailIngestionLog

            log_repo = get_email_ingestion_log_repository(session)
            log = session.query(EmailIngestionLog).filter(
                EmailIngestionLog.id == log_id
            ).first()

            if not log:
                raise ValueError("Log not found")

            client_id = str(data["client_id"])
            claim_id = data.get("claim_id")
            reviewed_by = data.get("reviewed_by")

            # Create claim if requested
            claim_created = False
            if data.get("create_claim") and not claim_id:
                from app.domains.client.models import Claim
                claim_number = data.get("claim_number") or f"MANUAL-{datetime.now().strftime('%Y%m%d%H%M%S')}"
                claim = Claim(
                    client_id=client_id,
                    claim_number=claim_number,
                    status="open",
                    notes=f"Created during manual email assignment",
                )
                session.add(claim)
                session.flush()
                claim_id = str(claim.id)
                claim_created = True

            if claim_id:
                claim_id = str(claim_id)

            # Update log
            log.matched_client_id = client_id
            log.matched_claim_id = claim_id
            log.match_method = "manual"
            log.match_confidence = 100
            log.claim_created = claim_created
            log.reviewed_by = reviewed_by
            log.reviewed_at = datetime.now(timezone.utc)
            log.status = "matched"

            session.commit()

            return log_repo._convert_to_dict(log)
        except Exception as e:
            session.rollback()
            raise
        finally:
            session.close()

    def skip_log(self, log_id: str, reason: str, reviewed_by: Optional[str] = None) -> Dict[str, Any]:
        """Mark a log as skipped"""
        session = self._get_session()
        try:
            from app.domains.email_ingestion.models import EmailIngestionLog
            from app.domains.email_ingestion.repository import get_email_ingestion_log_repository

            log = session.query(EmailIngestionLog).filter(
                EmailIngestionLog.id == log_id
            ).first()

            if not log:
                raise ValueError("Log not found")

            log.status = "skipped"
            log.skip_reason = reason
            log.reviewed_by = reviewed_by
            log.reviewed_at = datetime.now(timezone.utc)

            session.commit()

            repo = get_email_ingestion_log_repository(session)
            return repo._convert_to_dict(log)
        except Exception as e:
            session.rollback()
            raise
        finally:
            session.close()
