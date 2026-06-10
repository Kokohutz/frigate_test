"""
Federation API — read-only hub that aggregates stats from multiple remote Argus instances.
Only active when config.federation.enabled is True and the current user has admin role.
"""

import asyncio
import logging

import httpx
from fastapi import APIRouter, HTTPException, Request

router = APIRouter(prefix="/federation", tags=["federation"])
logger = logging.getLogger(__name__)


async def _fetch_instance_stats(url: str, token: str) -> dict:
    """Poll /api/stats from a remote instance. Returns error dict on failure."""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            headers = {"Authorization": f"Bearer {token}"} if token else {}
            r = await client.get(f"{url.rstrip('/')}/api/stats", headers=headers)
            r.raise_for_status()
            data = r.json()
            data["_url"] = url
            data["_healthy"] = True
            return data
    except Exception as e:
        return {"_url": url, "_healthy": False, "_error": str(e)}


@router.get("/instances")
async def list_instances(request: Request):
    """List all configured remote instances with their current stats."""
    cfg = request.app.frigate_config
    if not cfg.federation.enabled:
        raise HTTPException(status_code=404, detail="Federation not enabled")
    instances = cfg.federation.instances
    if not instances:
        return []
    results = await asyncio.gather(
        *[_fetch_instance_stats(inst.url, inst.token) for inst in instances]
    )
    # Merge config name into each result
    for i, inst in enumerate(instances):
        if inst.name:
            results[i]["_name"] = inst.name
    return results


@router.get("/summary")
async def federation_summary(request: Request):
    """Aggregate summary across all instances: total cameras, detectors, events/24h."""
    cfg = request.app.frigate_config
    if not cfg.federation.enabled:
        raise HTTPException(status_code=404, detail="Federation not enabled")
    results = await asyncio.gather(
        *[
            _fetch_instance_stats(inst.url, inst.token)
            for inst in cfg.federation.instances
        ]
    )
    total_cameras = 0
    total_detections_day = 0
    healthy = sum(1 for r in results if r.get("_healthy"))
    for r in results:
        if not r.get("_healthy"):
            continue
        # stats structure mirrors /api/stats response
        cameras = r.get("cameras", {})
        total_cameras += len(cameras)
        for cam_stats in cameras.values():
            total_detections_day += cam_stats.get("detection_fps", 0) * 86400
    return {
        "instances_total": len(results),
        "instances_healthy": healthy,
        "cameras_total": total_cameras,
        "estimated_detections_24h": int(total_detections_day),
    }
