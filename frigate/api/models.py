"""Model conversion API.

Accepts an uploaded ML model file and converts it to a target format
appropriate for one of the configured detectors. Conversion runs in a
BackgroundTasks job and progress is polled via GET /models/jobs/{job_id}.
"""

from __future__ import annotations

import logging
import uuid
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, Form, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse

from frigate.api.auth import require_role
from frigate.api.defs.tags import Tags
from frigate.util.model_convert import (
    JOBS,
    ConversionJob,
    SourceFormat,
    TargetFormat,
    cleanup_stage,
    detect_source_format,
    run_conversion,
    stage_upload,
    target_for_detector_type,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=[Tags.app])


@router.get(
    "/models/targets",
    dependencies=[Depends(require_role(["admin"]))],
    summary="List available target formats and which detectors use them",
)
async def list_targets(request: Request):
    """Return target format catalogue + the suggested target derived from each
    currently configured detector. The frontend uses this to pre-select the
    right target when the user opens the converter."""
    detectors = request.app.frigate_config.detectors
    detector_suggestions = {
        name: target_for_detector_type(d.type).value for name, d in detectors.items()
    }
    return JSONResponse(
        content={
            "targets": [t.value for t in TargetFormat],
            "sources": [s.value for s in SourceFormat],
            "detector_suggestions": detector_suggestions,
        }
    )


def _do_convert(job_id: str, staged_path: Path) -> None:
    job = JOBS[job_id]
    try:
        run_conversion(job, staged_path)
    finally:
        cleanup_stage(staged_path)


@router.post(
    "/models/convert",
    dependencies=[Depends(require_role(["admin"]))],
    summary="Upload a model file and start a conversion job",
)
async def convert_model(
    background_tasks: BackgroundTasks,
    file: UploadFile,
    target: str = Form(..., description="Target format (see /models/targets)"),
):
    if file.filename is None:
        return JSONResponse(
            status_code=400,
            content={"success": False, "message": "No filename in upload"},
        )

    try:
        target_fmt = TargetFormat(target)
    except ValueError:
        return JSONResponse(
            status_code=400,
            content={
                "success": False,
                "message": f"Unknown target '{target}'. Use one from /models/targets.",
            },
        )

    payload = await file.read()
    if len(payload) == 0:
        return JSONResponse(
            status_code=400,
            content={"success": False, "message": "Uploaded file is empty"},
        )
    # 2 GB upper bound — TensorRT engine files can be ~1.5 GB
    if len(payload) > 2 * 1024 * 1024 * 1024:
        return JSONResponse(
            status_code=413,
            content={"success": False, "message": "Upload exceeds 2 GB limit"},
        )

    staged = stage_upload(payload, file.filename)
    src_fmt = detect_source_format(staged)

    job_id = uuid.uuid4().hex
    job = ConversionJob(
        job_id=job_id,
        source_filename=file.filename,
        source_format=src_fmt,
        target_format=target_fmt,
    )
    JOBS[job_id] = job
    background_tasks.add_task(_do_convert, job_id, staged)
    return JSONResponse(content={"success": True, "job": job.to_dict()})


@router.get(
    "/models/jobs/{job_id}",
    dependencies=[Depends(require_role(["admin"]))],
    summary="Poll a conversion job's progress",
)
async def get_job(job_id: str):
    job = JOBS.get(job_id)
    if job is None:
        return JSONResponse(
            status_code=404,
            content={"success": False, "message": "Job not found"},
        )
    return JSONResponse(content={"success": True, "job": job.to_dict()})


@router.get(
    "/models/jobs",
    dependencies=[Depends(require_role(["admin"]))],
    summary="List all conversion jobs in this process",
)
async def list_jobs():
    return JSONResponse(content={"jobs": [j.to_dict() for j in JOBS.values()]})


@router.get(
    "/models/jobs/{job_id}/download",
    dependencies=[Depends(require_role(["admin"]))],
    summary="Download the output of a completed conversion job",
)
async def download_output(job_id: str):
    job = JOBS.get(job_id)
    if job is None or job.status != "done" or not job.output_path:
        return JSONResponse(
            status_code=404,
            content={"success": False, "message": "No output available"},
        )
    out = Path(job.output_path)
    if not out.exists():
        return JSONResponse(
            status_code=410,
            content={"success": False, "message": "Output file no longer exists"},
        )
    return FileResponse(out, filename=out.name, media_type="application/octet-stream")
