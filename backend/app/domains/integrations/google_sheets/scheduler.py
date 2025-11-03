"""
Google Sheets 자동 동기화 스케줄러

스케줄 전략:
- 미국 시간 오전 9시 ~ 오후 6시 (근무 시간): 15분마다 동기화
- 그 외 시간 (비근무 시간): 3시간마다 동기화
"""

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger
from datetime import datetime
import logging
import pytz

from app.core.database_factory import get_database
from app.core.config import settings
from app.domains.integrations.google_sheets.sync_service import GoogleSheetsSyncService

logger = logging.getLogger(__name__)

# 스케줄러 인스턴스
scheduler = AsyncIOScheduler()

# 미국 Eastern 시간대 (뉴욕)
US_EASTERN_TZ = pytz.timezone('America/New_York')


def is_business_hours() -> bool:
    """
    미국 Eastern 시간대 기준 근무 시간 체크
    오전 9시 ~ 오후 6시 (18시)
    """
    us_time = datetime.now(US_EASTERN_TZ)
    return 9 <= us_time.hour < 18


async def sync_google_sheets_job():
    """
    정기 동기화 작업 (백그라운드 실행)
    - 근무 시간 (9am-6pm ET): 15분마다
    - 비근무 시간: 3시간마다

    Note: asyncio.create_task()로 백그라운드 실행하여 API 블로킹 방지
    """
    if not settings.GOOGLE_SHEETS_WATER_MITIGATION_ID:
        logger.warning("Google Sheets ID not configured, skipping sync")
        return

    is_business = is_business_hours()

    # 백그라운드 태스크로 실행 (블로킹 방지)
    import asyncio
    asyncio.create_task(_run_sync_in_background(is_business))

    schedule_type = "business hours (15min)" if is_business else "off-hours (180min)"
    logger.info(f"Google Sheets sync task started in background [{schedule_type}]")

    # 다음 실행 스케줄 조정 (동적 변경)
    _update_schedule_if_needed()


async def _run_sync_in_background(is_business: bool):
    """
    백그라운드에서 실제 동기화 실행

    Args:
        is_business: 근무 시간 여부
    """
    try:
        us_time = datetime.now(US_EASTERN_TZ)
        schedule_type = "business hours (15min)" if is_business else "off-hours (3hr)"
        logger.info(f"Starting scheduled Google Sheets sync [{schedule_type}] - US Time: {us_time.strftime('%I:%M %p')}")

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
                f"Scheduled sync completed [{schedule_type}]: "
                f"processed={stats['processed']}, "
                f"created={stats['created']}, "
                f"updated={stats['updated']}, "
                f"failed={stats['failed']}"
            )
        finally:
            db.close()

    except Exception as e:
        logger.error(f"Background sync failed: {e}", exc_info=True)


def _update_schedule_if_needed():
    """
    시간대 변화에 따라 스케줄 동적 업데이트
    - 근무 시간 전환: 15분 간격
    - 비근무 시간 전환: 180분 간격
    """
    is_business = is_business_hours()
    interval_minutes = 15 if is_business else 180

    # 기존 job 가져오기
    existing_job = scheduler.get_job('google_sheets_sync')
    if existing_job:
        current_interval = existing_job.trigger.interval.total_seconds() / 60

        # 간격이 변경되었을 때만 업데이트
        if current_interval != interval_minutes:
            scheduler.reschedule_job(
                'google_sheets_sync',
                trigger=IntervalTrigger(minutes=interval_minutes)
            )
            schedule_type = "business hours (15min)" if is_business else "off-hours (180min)"
            logger.info(f"Schedule updated to {schedule_type}")


def start_scheduler():
    """
    스케줄러 시작
    - 근무 시간 (9am-6pm ET): 15분마다 동기화
    - 비근무 시간: 3시간(180분)마다 동기화
    - 시간대 전환 시 자동으로 간격 조정
    """
    if not settings.GOOGLE_SHEETS_WATER_MITIGATION_ID:
        logger.warning("Google Sheets sync scheduler disabled (no Spreadsheet ID configured)")
        return

    # 초기 실행 간격 결정
    is_business = is_business_hours()
    initial_interval = 15 if is_business else 180

    scheduler.add_job(
        sync_google_sheets_job,
        trigger=IntervalTrigger(minutes=initial_interval),
        id='google_sheets_sync',
        name='Google Sheets Sync (Smart Schedule)',
        replace_existing=True
    )

    scheduler.start()
    us_time = datetime.now(US_EASTERN_TZ)
    schedule_info = "15min interval" if is_business else "180min interval"
    logger.info(
        f"Google Sheets sync scheduler started - "
        f"US Time: {us_time.strftime('%I:%M %p %Z')}, "
        f"Current mode: {schedule_info}"
    )


def stop_scheduler():
    """
    스케줄러 중지
    """
    if scheduler.running:
        scheduler.shutdown()
        logger.info("Google Sheets sync scheduler stopped")
