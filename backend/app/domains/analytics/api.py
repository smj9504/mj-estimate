"""
Analytics API endpoints
"""

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any

from app.core.database_factory import get_db
from .models import ApiUsageLog

router = APIRouter(prefix="/analytics", tags=["Analytics"])


@router.get("/api-usage")
def get_api_usage(
    period: str = Query("daily", pattern="^(daily|weekly|monthly)$"),
    start: Optional[str] = Query(None, description="ISO date start (inclusive)"),
    end: Optional[str] = Query(None, description="ISO date end (exclusive)"),
    provider: Optional[str] = Query("openai"),
    db: Session = Depends(get_db),
):
    """
    Aggregate API usage by period.

    Returns buckets with totals and per-service breakdowns.
    """
    # Resolve date range
    now = datetime.utcnow()
    if end:
        end_dt = datetime.fromisoformat(end)
    else:
        end_dt = now

    if start:
        start_dt = datetime.fromisoformat(start)
    else:
        if period == "daily":
            start_dt = end_dt - timedelta(days=30)
        elif period == "weekly":
            start_dt = end_dt - timedelta(weeks=26)
        else:
            start_dt = end_dt - timedelta(days=365)

    # Load raw logs
    query = db.query(ApiUsageLog).filter(
        ApiUsageLog.created_at >= start_dt,
        ApiUsageLog.created_at < end_dt
    )
    if provider:
        query = query.filter(ApiUsageLog.provider == provider)
    logs: List[ApiUsageLog] = query.all()

    # Bucketize
    def bucket_key(dt: datetime) -> str:
        if period == "daily":
            return dt.strftime("%Y-%m-%d")
        elif period == "weekly":
            # ISO week
            year, week, _ = dt.isocalendar()
            return f"{year}-W{week:02d}"
        else:
            return dt.strftime("%Y-%m")

    buckets: Dict[str, Dict[str, Any]] = {}
    for log in logs:
        key = bucket_key(log.created_at)
        b = buckets.setdefault(key, {
            "period": key,
            "requests": 0,
            "prompt_tokens": 0,
            "completion_tokens": 0,
            "total_tokens": 0,
            "cost_usd": 0.0,
            "by_service": {}
        })
        b["requests"] += (log.input_count or 1)
        b["prompt_tokens"] += (log.prompt_tokens or 0)
        b["completion_tokens"] += (log.completion_tokens or 0)
        b["total_tokens"] += (log.total_tokens or ((log.prompt_tokens or 0) + (log.completion_tokens or 0)))
        b["cost_usd"] += (log.cost_usd or 0.0)

        svc = b["by_service"].setdefault(log.service_name, {
            "requests": 0,
            "prompt_tokens": 0,
            "completion_tokens": 0,
            "total_tokens": 0,
            "cost_usd": 0.0,
        })
        svc["requests"] += (log.input_count or 1)
        svc["prompt_tokens"] += (log.prompt_tokens or 0)
        svc["completion_tokens"] += (log.completion_tokens or 0)
        svc["total_tokens"] += (log.total_tokens or ((log.prompt_tokens or 0) + (log.completion_tokens or 0)))
        svc["cost_usd"] += (log.cost_usd or 0.0)

    # Sort buckets by period key ascending
    periods_sorted = sorted(buckets.keys())
    return {
        "period": period,
        "start": start_dt.isoformat(),
        "end": end_dt.isoformat(),
        "buckets": [buckets[k] for k in periods_sorted]
    }

