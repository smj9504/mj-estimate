"""
Trash auto-cleanup scheduler

Photos in trash for 30+ days are permanently deleted (storage + database).
Runs once daily at 3:00 AM US Eastern time.
"""

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from datetime import datetime
import logging
import pytz

from app.core.database_factory import get_database

logger = logging.getLogger(__name__)

# Separate scheduler instance for trash cleanup
trash_scheduler = AsyncIOScheduler()

US_EASTERN_TZ = pytz.timezone('America/New_York')

TRASH_RETENTION_DAYS = 30


async def cleanup_expired_trash_job():
    """
    Daily job to permanently delete photos in trash for 30+ days.
    Deletes from cloud storage (GCS/GDrive) first, then removes DB records.
    """
    import asyncio
    asyncio.create_task(_run_cleanup_in_background())


async def _run_cleanup_in_background():
    """Run trash cleanup in background to avoid blocking"""
    try:
        us_time = datetime.now(US_EASTERN_TZ)
        logger.info(f"Starting trash cleanup job at {us_time.strftime('%Y-%m-%d %I:%M %p')} ET")

        database = get_database()
        db = database.get_session()

        try:
            from app.domains.water_mitigation.service import WaterMitigationService
            service = WaterMitigationService(db)
            result = service.cleanup_expired_trash(retention_days=TRASH_RETENTION_DAYS)
            db.commit()

            logger.info(
                f"Trash cleanup completed: "
                f"deleted={result['deleted_count']}, "
                f"failed={result['failed_count']}, "
                f"total_expired={result['total_expired']}"
            )
        finally:
            db.close()

    except Exception as e:
        logger.error(f"Trash cleanup job failed: {e}", exc_info=True)


def start_trash_scheduler():
    """Start trash cleanup scheduler - runs daily at 3:00 AM ET"""
    trash_scheduler.add_job(
        cleanup_expired_trash_job,
        trigger=CronTrigger(hour=3, minute=0, timezone=US_EASTERN_TZ),
        id='trash_cleanup',
        name='Trash Auto-Cleanup (30 days)',
        replace_existing=True
    )

    trash_scheduler.start()
    logger.info(
        f"Trash cleanup scheduler started - "
        f"runs daily at 3:00 AM ET, "
        f"retention={TRASH_RETENTION_DAYS} days"
    )


def stop_trash_scheduler():
    """Stop trash cleanup scheduler"""
    if trash_scheduler.running:
        trash_scheduler.shutdown()
        logger.info("Trash cleanup scheduler stopped")
