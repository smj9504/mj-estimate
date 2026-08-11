"""
Email ingestion polling scheduler.

Polls all active email accounts once daily, matching attachments to
claims by claim number/address and uploading them (dedup via message-id
+ attachment hash is handled in EmailIngestionService).
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
    return service.poll_all_accounts()


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
            f"uploaded={result['total_uploaded']}"
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
