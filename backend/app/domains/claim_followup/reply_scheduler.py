"""
Reply check scheduler.

Periodically checks IMAP inboxes for replies to sent follow-up emails.
Runs every 10 minutes during US Eastern business hours (9am-6pm),
every 1 hour outside business hours.
"""

import asyncio
import logging
from datetime import datetime

import pytz
from apscheduler.triggers.interval import IntervalTrigger

from app.core.scheduler import shared_scheduler

logger = logging.getLogger(__name__)

US_EASTERN_TZ = pytz.timezone("America/New_York")


def _is_business_hours() -> bool:
    us_time = datetime.now(US_EASTERN_TZ)
    return 9 <= us_time.hour < 18


async def check_replies_job():
    """Periodic job to check for email replies."""
    asyncio.create_task(_run_check_in_background())


async def _run_check_in_background():
    try:
        us_time = datetime.now(US_EASTERN_TZ)

        # Skip if outside business hours (run less frequently)
        # The scheduler fires every 10 min; we only run every 60 min
        # outside business hours by skipping 5 out of 6 calls.
        if not _is_business_hours() and us_time.minute >= 10:
            return

        logger.info(
            f"Starting reply check at "
            f"{us_time.strftime('%Y-%m-%d %I:%M %p')} ET"
        )

        from app.domains.claim_followup.reply_tracker import ReplyTracker
        tracker = ReplyTracker()
        result = tracker.check_replies()

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
    """Register reply check job - every 10 minutes."""
    shared_scheduler.add_job(
        check_replies_job,
        trigger=IntervalTrigger(minutes=10),
        id="reply_check",
        name="Email Reply Auto-Check",
        replace_existing=True,
    )
    logger.info("Reply check job registered - runs every 10 minutes")


def stop_reply_scheduler():
    """Remove reply check job."""
    if shared_scheduler.get_job("reply_check"):
        shared_scheduler.remove_job("reply_check")
        logger.info("Reply check job removed")
