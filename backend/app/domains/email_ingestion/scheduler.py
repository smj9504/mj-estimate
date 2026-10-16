"""
Email ingestion polling scheduler.

Polls all active email accounts once daily, storing claim-related inbound
messages (received_emails) and matching attachments to
claims by claim number/address and queueing them for review (dedup via
message-id + attachment hash is handled in EmailIngestionService).
The poll never creates claims or estimate revisions on its own - matched
attachments wait as 'pending' until confirmed in the review screen.
Runs once daily at 6:00 AM US Eastern time.
"""

import asyncio
import logging
from datetime import datetime

import pytz
from apscheduler.triggers.cron import CronTrigger

from app.core.scheduler import shared_scheduler

logger = logging.getLogger(__name__)

US_EASTERN_TZ = pytz.timezone("America/New_York")


def _sync_poll_all_accounts() -> dict:
    """Run the synchronous IMAP poll (called in thread pool)."""
    from app.domains.email_ingestion.service import EmailIngestionService
    service = EmailIngestionService()
    # Every inbound message is stored now, not only ones with attachments, so
    # a day's mail easily passes the old 50. Only the newest `limit` since the
    # last sync are fetched and last_synced_at then moves on, so anything past
    # the cap would be skipped for good.
    return service.poll_all_accounts(limit=500)


async def poll_email_accounts_job():
    """Daily job to poll all active email accounts for new attachments."""
    try:
        us_time = datetime.now(US_EASTERN_TZ)
        logger.info(
            f"Starting email ingestion poll at "
            f"{us_time.strftime('%Y-%m-%d %I:%M %p')} ET"
        )

        loop = asyncio.get_running_loop()
        result = await loop.run_in_executor(None, _sync_poll_all_accounts)

        logger.info(
            f"Email ingestion poll completed: "
            f"accounts={result['accounts_polled']}, "
            f"processed={result['total_processed']}, "
            f"pending_review={result.get('total_pending', 0)}"
        )
    except Exception as e:
        logger.error(f"Email ingestion poll job failed: {e}", exc_info=True)


def start_email_ingestion_scheduler():
    """Register email ingestion poll job - runs daily at 6:00 AM ET."""
    shared_scheduler.add_job(
        poll_email_accounts_job,
        trigger=CronTrigger(hour=6, minute=0, timezone=US_EASTERN_TZ),
        id="email_ingestion_poll",
        name="Email Ingestion Daily Poll",
        replace_existing=True,
    )
    logger.info("Email ingestion poll job registered - runs daily at 6:00 AM ET")


def stop_email_ingestion_scheduler():
    """Remove email ingestion poll job."""
    if shared_scheduler.get_job("email_ingestion_poll"):
        shared_scheduler.remove_job("email_ingestion_poll")
        logger.info("Email ingestion poll job removed")
