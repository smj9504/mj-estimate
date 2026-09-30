"""
Shared APScheduler instance.

All scheduled jobs (trash cleanup, reply check, Google Sheets sync)
share a single AsyncIOScheduler to avoid spawning multiple OS threads.
"""

from apscheduler.schedulers.asyncio import AsyncIOScheduler
import logging

logger = logging.getLogger(__name__)

# APScheduler's defaults drop a job whose fire time passes while the process
# is down or busy (misfire_grace_time=1 second). This service redeploys often
# and every deploy restarts the process, so a cron job scheduled for a fixed
# hour was silently skipped whenever a restart overlapped its window, with no
# catch-up run - e.g. the twice-daily reply check missing a reply for days.
# A generous grace time lets a job that came due during a restart still run
# once the process is back, and coalesce collapses several missed fires into
# a single run rather than replaying each one.
shared_scheduler = AsyncIOScheduler(
    job_defaults={
        "misfire_grace_time": 3600,  # still run if we were down < 1h
        "coalesce": True,            # collapse missed fires into one run
        "max_instances": 1,
    }
)


def start_shared_scheduler():
    """Start the shared scheduler if not already running."""
    if not shared_scheduler.running:
        shared_scheduler.start()
        logger.info("Shared scheduler started")


def stop_shared_scheduler():
    """Stop the shared scheduler."""
    if shared_scheduler.running:
        shared_scheduler.shutdown()
        logger.info("Shared scheduler stopped")
