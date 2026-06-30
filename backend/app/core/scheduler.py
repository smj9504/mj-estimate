"""
Shared APScheduler instance.

All scheduled jobs (trash cleanup, reply check, Google Sheets sync)
share a single AsyncIOScheduler to avoid spawning multiple OS threads.
"""

from apscheduler.schedulers.asyncio import AsyncIOScheduler
import logging

logger = logging.getLogger(__name__)

shared_scheduler = AsyncIOScheduler()


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
