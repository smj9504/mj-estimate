"""
Error reporting to admin (Slack)

When an unhandled server error occurs, this module notifies the admin via
Slack (using the existing SlackClient.send_system_alert) and throttles
repeated notifications for the same error signature so that a recurring
bug, or many users hitting the same broken endpoint, doesn't flood the
Slack channel.

Usage:
    from app.core.error_reporting import report_error_to_admin

    await report_error_to_admin(
        request_id=request_id,
        method=request.method,
        path=route_path,       # route template preferred, see main.py
        exc=exc,
        traceback_str=traceback.format_exc(),
    )

Note: This function must never raise. A failure to notify admin must
never break the error response already being returned to the client.
"""

import logging
import time
from typing import Dict

from app.core.config import settings
from app.domains.integrations.slack.client import SlackClient

logger = logging.getLogger(__name__)

# How long to wait before sending another Slack alert for the same
# error signature (method + path + exception type).
THROTTLE_WINDOW_SECONDS = 300  # 5 minutes

# In-memory "last sent" timestamp per error signature.
# NOTE: this is per-process state. Render currently runs a single Uvicorn
# worker (render.yaml: `--workers 1`), so this is accurate today. If the
# app is ever scaled to multiple workers/instances, switch this to
# app.core.cache.CacheService (Redis-backed, already implemented) so the
# throttle state is shared across processes.
_last_sent_at: Dict[str, float] = {}


def _build_signature(method: str, path: str, exc: Exception) -> str:
    return f"{method}:{path}:{type(exc).__name__}"


async def report_error_to_admin(
    request_id: str,
    method: str,
    path: str,
    exc: Exception,
    traceback_str: str,
) -> None:
    """
    Send a Slack alert to admins about an unhandled server error.

    Throttled per (method, path, exception type) signature so the same
    recurring bug doesn't spam Slack. Never raises - any failure here is
    logged and swallowed so it can't affect the HTTP error response.
    """
    if not settings.ENABLE_INTEGRATIONS:
        return

    signature = _build_signature(method, path, exc)
    now = time.monotonic()
    last_sent = _last_sent_at.get(signature)

    if last_sent is not None and (now - last_sent) < THROTTLE_WINDOW_SECONDS:
        logger.info(
            f"[{request_id[:8]}] Skipping Slack alert for '{signature}' "
            f"(throttled, last sent {now - last_sent:.0f}s ago)"
        )
        return

    _last_sent_at[signature] = now

    try:
        slack = SlackClient()
        error_message = (str(exc) or "(no message)")[:500]
        await slack.send_system_alert(
            title="Unhandled Server Error",
            message=f"`{type(exc).__name__}`: {error_message}\n```{traceback_str[-800:]}```",
            severity="error",
            details={
                "Method": method,
                "Path": path,
                "Error Type": type(exc).__name__,
                "Request ID": request_id,
                "Environment": settings.ENVIRONMENT,
            },
        )
    except Exception as slack_error:
        # SlackClient.send_message already swallows its own errors, but
        # message construction (e.g. schema validation) happens inside
        # send_system_alert, so guard defensively here too.
        logger.error(f"[{request_id[:8]}] Failed to send Slack alert: {slack_error}")
