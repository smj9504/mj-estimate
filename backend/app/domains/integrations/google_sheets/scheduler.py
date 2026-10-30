"""
Google Sheets 자동 동기화 스케줄러

매일 오전 8시 (미국 Eastern) 한 번 동기화한다. 근무 시작 전에 전날 입력분이
반영되고, 그 사이에 바로 필요하면 화면의 동기화 버튼을 쓴다.
"""

import asyncio

from apscheduler.triggers.cron import CronTrigger
from datetime import datetime
import logging
import pytz

from app.core.database_factory import get_database
from app.core.config import settings
from app.core.scheduler import shared_scheduler as scheduler
from app.domains.integrations.google_sheets.sync_service import GoogleSheetsSyncService

logger = logging.getLogger(__name__)

# 미국 Eastern 시간대 (뉴욕)
US_EASTERN_TZ = pytz.timezone('America/New_York')


def _sync_sheets_blocking() -> dict:
    """Run the Google Sheets sync in a thread pool (blocking I/O + DB)."""
    us_time = datetime.now(US_EASTERN_TZ)
    sheet_names = settings.water_mitigation_sheet_names
    logger.info(
        f"Starting scheduled Google Sheets sync - "
        f"US Time: {us_time.strftime('%I:%M %p')}, "
        f"Sheets: {sheet_names}"
    )

    database = get_database()
    db = database.get_session()
    try:
        sync_service = GoogleSheetsSyncService(
            db,
            settings.GOOGLE_SHEETS_WATER_MITIGATION_ID
        )
        # sync_multiple_sheets is async, run it in a new event loop inside this thread
        stats = asyncio.run(sync_service.sync_multiple_sheets(
            sheet_names=sheet_names,
            skip_header=True
        ))
        logger.info(
            f"Scheduled sync completed: "
            f"sheets={len(sheet_names)}, "
            f"processed={stats['processed']}, "
            f"created={stats['created']}, "
            f"updated={stats['updated']}, "
            f"failed={stats['failed']}"
        )
        return stats
    finally:
        db.close()


async def sync_google_sheets_job():
    """정기 동기화 작업 (스레드풀에서 실행하여 이벤트 루프 블로킹 방지)"""
    if not settings.GOOGLE_SHEETS_WATER_MITIGATION_ID:
        logger.warning("Google Sheets ID not configured, skipping sync")
        return

    logger.info("Google Sheets sync task started")

    try:
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(None, _sync_sheets_blocking)
    except Exception as e:
        logger.error(f"Background sync failed: {e}", exc_info=True)


def start_scheduler():
    """스케줄러 시작 - 매일 오전 8시 (미국 Eastern) 동기화"""
    if not settings.GOOGLE_SHEETS_WATER_MITIGATION_ID:
        logger.warning("Google Sheets sync scheduler disabled (no Spreadsheet ID configured)")
        return

    scheduler.add_job(
        sync_google_sheets_job,
        trigger=CronTrigger(hour=8, minute=0, timezone=US_EASTERN_TZ),
        id='google_sheets_sync',
        name='Google Sheets Daily Sync',
        replace_existing=True
    )

    logger.info("Google Sheets sync job registered - runs daily at 8:00 AM ET")


def stop_scheduler():
    """Google Sheets 동기화 job 제거"""
    if scheduler.get_job('google_sheets_sync'):
        scheduler.remove_job('google_sheets_sync')
        logger.info("Google Sheets sync job removed")
