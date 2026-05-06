from fastapi import APIRouter, HTTPException

from backend.models import FieldJob, MoveStageRequest, UpdateNotesRequest, CreateJobRequest, FIELD_STAGES
from backend.services import filesystem, gsheets

router = APIRouter(prefix="/api/field")

# In-memory notes store (keyed by job_id) — persists notes between scans within a session.
# Notes are also written to Google Sheets on push.
_notes: dict[str, str] = {}


def _enrich(job: FieldJob) -> dict:
    d = job.model_dump()
    d["notes"] = _notes.get(job.job_id, job.notes)
    return d


@router.get("/jobs")
def list_jobs():
    jobs = filesystem.scan_all_jobs()
    return [_enrich(j) for j in jobs]


@router.post("/jobs", status_code=201)
def create_job(req: CreateJobRequest):
    try:
        job = filesystem.create_job(req.job_id, req.su_string)
    except FileExistsError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return _enrich(job)


@router.put("/jobs/{job_id}/stage")
def move_stage(job_id: str, req: MoveStageRequest):
    if req.target_stage not in FIELD_STAGES:
        raise HTTPException(status_code=400, detail=f"Invalid stage: {req.target_stage}")
    try:
        job = filesystem.move_job(job_id, req.target_stage)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except FileExistsError as e:
        raise HTTPException(status_code=409, detail=str(e))
    return _enrich(job)


@router.put("/jobs/{job_id}/notes")
def update_notes(job_id: str, req: UpdateNotesRequest):
    job = filesystem.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Job not found: {job_id}")
    _notes[job_id] = req.notes
    return _enrich(job)


@router.post("/push")
def push_to_sheets():
    """Push all current job states to Google Sheets (targeted upserts — no full_sync)."""
    if not gsheets.is_available():
        raise HTTPException(status_code=503, detail="Google Sheets not configured")
    jobs = filesystem.scan_all_jobs()
    errors: list[str] = []
    for job in jobs:
        job.notes = _notes.get(job.job_id, "")
        try:
            gsheets.upsert_pgram(job)
        except Exception as e:
            errors.append(f"{job.job_id}: {e}")
    if errors:
        raise HTTPException(status_code=500, detail=f"Partial failure: {'; '.join(errors)}")
    return {"pushed": len(jobs)}
