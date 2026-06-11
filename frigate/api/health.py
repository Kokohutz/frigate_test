"""Health-check endpoints.

GET /api/health/live  — liveness probe (always 200 if Python is up, no auth)
GET /api/health/ready — readiness probe (200 when DB + config are OK, no auth)
GET /api/health       — full diagnostic report (admin auth required)
"""

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from frigate.api.auth import allow_public
from frigate.startup_check import StartupChecker, overall_status

logger = logging.getLogger(__name__)

router = APIRouter(tags=["health"])

# Keys that must pass for the readiness probe to succeed
_CRITICAL_KEYS = {"database", "config"}


@router.get("/api/health/live", dependencies=[Depends(allow_public)])
async def liveness():
    """Liveness probe — returns 200 as long as the Python process is running."""
    return {"status": "alive"}


@router.get("/api/health/ready", dependencies=[Depends(allow_public)])
async def readiness(request: Request):
    """Readiness probe — returns 503 until critical checks have passed."""
    cached: dict | None = getattr(request.app.state, "health_checks", None)
    if cached is None:
        return JSONResponse(
            {"status": "starting", "message": "checks not yet run"}, status_code=503
        )

    failed = [k for k in _CRITICAL_KEYS if cached.get(k, {}).get("status") == "fail"]
    if failed:
        return JSONResponse(
            {"status": "not_ready", "failed": failed},
            status_code=503,
        )
    return {"status": "ready"}


@router.get("/api/health")
async def health_check(request: Request):
    """Run all startup checks and return a detailed status report."""
    checker = StartupChecker(
        config=request.app.frigate_config,
        db=request.app.state.database,
    )
    raw = await checker.run_all()

    checks = {name: result.as_dict() for name, result in raw.items()}
    now = datetime.now(timezone.utc).isoformat()

    # Cache so the readiness probe can read it without re-running checks
    request.app.state.health_checks = checks
    request.app.state.health_timestamp = now

    return {
        "overall": overall_status(checks),
        "timestamp": now,
        "checks": checks,
    }
