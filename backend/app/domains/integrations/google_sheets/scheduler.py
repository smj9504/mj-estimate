"""
Google Sheets 자동 동기화 스케줄러
"""

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger
from datetime import datetime
import logging

from app.core.database_factory import get_database
from app.core.config import settings
from app.domains.integrations.google_sheets.sync_service import GoogleSheetsSyncService

logger = logging.getLogger(__name__)

# 스케줄러 인스턴스
scheduler = AsyncIOScheduler()


async def sync_google_sheets_job():
    """
    정기 동기화 작업
    매 5분마다 실행
    """
    if not settings.GOOGLE_SHEETS_WATER_MITIGATION_ID:
        logger.warning("Google Sheets ID not configured, skipping sync")
        return

    try:
        logger.info("Starting scheduled Google Sheets sync...")

        # 데이터베이스 세션 생성
        database = get_database()
        db = database.get_session()

        try:
            # 동기화 서비스 생성
            sync_service = GoogleSheetsSyncService(
                db,
                settings.GOOGLE_SHEETS_WATER_MITIGATION_ID
            )

            # 동기화 실행
            stats = await sync_service.sync_all_rows(
                sheet_name=settings.GOOGLE_SHEETS_WATER_MITIGATION_SHEET_NAME,
                skip_header=True
            )

            logger.info(
                f"Scheduled sync completed: "
                f"processed={stats['processed']}, "
                f"created={stats['created']}, "
                f"updated={stats['updated']}, "
                f"failed={stats['failed']}"
            )
        finally:
            db.close()

    except Exception as e:
        logger.error(f"Scheduled sync failed: {e}", exc_info=True)


def start_scheduler():
    """
    스케줄러 시작
    """
    if not settings.GOOGLE_SHEETS_WATER_MITIGATION_ID:
        logger.warning("Google Sheets sync scheduler disabled (no Spreadsheet ID configured)")
        return

    # 매 5분마다 실행
    scheduler.add_job(
        sync_google_sheets_job,
        trigger=IntervalTrigger(minutes=5),
        id='google_sheets_sync',
        name='Google Sheets 동기화',
        replace_existing=True
    )

    scheduler.start()
    logger.info("Google Sheets sync scheduler started (every 5 minutes)")


def stop_scheduler():
    """
    스케줄러 중지
    """
    if scheduler.running:
        scheduler.shutdown()
        logger.info("Google Sheets sync scheduler stopped")
