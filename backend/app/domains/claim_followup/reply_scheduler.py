"""
Reply check scheduler.

Checks IMAP inboxes for replies to sent follow-up emails, twice a day
(9am and 3pm US Eastern).
"""

import asyncio
import logging
from datetime import datetime

import pytz
from apscheduler.triggers.cron import CronTrigger

from app.core.scheduler import shared_scheduler

logger = logging.getLogger(__name__)

US_EASTERN_TZ = pytz.timezone("America/New_York")


def _sync_check_replies() -> dict:
    """Run the synchronous IMAP reply check (called in thread pool)."""
    from app.domains.claim_followup.reply_tracker import ReplyTracker
    tracker = ReplyTracker()
    return tracker.check_replies()


async def check_replies_job():
    """Periodic job to check for email replies."""
    try:
        us_time = datetime.now(US_EASTERN_TZ)

        logger.info(
            f"Starting reply check at "
            f"{us_time.strftime('%Y-%m-%d %I:%M %p')} ET"
        )

        loop = asyncio.get_running_loop()
        result = await loop.run_in_executor(None, _sync_check_replies)

        logger.info(
            f"Reply check completed: "
            f"accounts={result['accounts_checked']}, "
            f"replies_found={result['replies_found']}"
        )
        if result.get("errors"):
            for err in result["errors"]:
                logger.warning(
                    f"Reply check error ({err['account']}): "
                    f"{err['error']}"
                )
    except Exception as e:
        logger.error(f"Reply check job failed: {e}", exc_info=True)


def start_reply_scheduler():
    """Register reply check job - twice daily at 9am and 3pm US Eastern."""
    shared_scheduler.add_job(
        check_replies_job,
        trigger=CronTrigger(hour="9,15", minute=0, timezone=US_EASTERN_TZ),
        id="reply_check",
        name="Email Reply Auto-Check",
        replace_existing=True,
    )
    logger.info("Reply check job registered - runs twice daily (9am, 3pm ET)")


def stop_reply_scheduler():
    """Remove reply check job."""
    if shared_scheduler.get_job("reply_check"):
        shared_scheduler.remove_job("reply_check")
        logger.info("Reply check job removed")
