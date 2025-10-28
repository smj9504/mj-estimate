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
    정기 동기화 작업
    - 근무 시간 (9am-6pm ET): 15분마다
    - 비근무 시간: 3시간마다
    """
    if not settings.GOOGLE_SHEETS_WATER_MITIGATION_ID:
        logger.warning("Google Sheets ID not configured, skipping sync")
        return

    # 스케줄 전략에 따라 실행 여부 결정
    # 이 함수는 1분마다 호출되며, 시간대에 따라 동기화 여부를 결정
    current_minute = datetime.now(US_EASTERN_TZ).minute
    is_business = is_business_hours()

    # 근무 시간: 15분마다 (0, 15, 30, 45분)
    if is_business:
        if current_minute not in [0, 15, 30, 45]:
            return
    # 비근무 시간: 3시간마다 (0분에만 실행, 스케줄러가 3시간 간격으로 호출)
    else:
        if current_minute != 0:
            return

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
        logger.error(f"Scheduled sync failed: {e}", exc_info=True)


def start_scheduler():
    """
    스케줄러 시작
    - 1분마다 체크하여 시간대별 동기화 실행
    - 근무 시간 (9am-6pm ET): 15분마다 동기화
    - 비근무 시간: 3시간마다 동기화
    """
    if not settings.GOOGLE_SHEETS_WATER_MITIGATION_ID:
        logger.warning("Google Sheets sync scheduler disabled (no Spreadsheet ID configured)")
        return

    # 1분마다 실행하여 시간대에 따라 동기화 여부 결정
    scheduler.add_job(
        sync_google_sheets_job,
        trigger=IntervalTrigger(minutes=1),
        id='google_sheets_sync',
        name='Google Sheets 동기화 (스마트 스케줄)',
        replace_existing=True
    )

    scheduler.start()
    us_time = datetime.now(US_EASTERN_TZ)
    is_business = is_business_hours()
    schedule_info = "15분 간격" if is_business else "3시간 간격"
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
