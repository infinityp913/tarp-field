from fastapi import APIRouter, HTTPException

from backend.models import FieldJob, IgnoredFolder, MoveStageRequest, UpdateNotesRequest, UpdateSURequest, CreateJobRequest, FIELD_STAGES
from backend.services import filesystem, gsheets
from backend.config import get_config, CREDENTIALS_PATH, TOKEN_PATH

router = APIRouter(prefix="/api/field")

# In-memory stores (keyed by job_id) — survive between scans within a session.
# Authoritative copy is Google Sheets after a push.
_notes: dict[str, str] = {}
_su_opened: dict[str, str] = {}
_su_closed: dict[str, str] = {}


def _enrich(job: FieldJob) -> dict:
    d = job.model_dump()
    d["notes"] = _notes.get(job.job_id, job.notes)
    d["su_opened"] = _su_opened.get(job.job_id, job.su_opened)
    d["su_closed"] = _su_closed.get(job.job_id, job.su_closed)
    return d


@router.get("/jobs")
def list_jobs():
    jobs = filesystem.scan_all_jobs()
    return [_enrich(j) for j in jobs]


@router.get("/ignored-folders", response_model=list[IgnoredFolder])
def list_ignored_folders():
    """Folders found under a stage directory whose names don't match the
    Pgram_Job_### convention and are therefore not shown on the board.
    The UI uses this to warn the user about misnamed folders.
    """
    return filesystem.scan_ignored_folders()


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


@router.put("/jobs/{job_id}/su")
def update_su(job_id: str, req: UpdateSURequest):
    job = filesystem.get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"Job not found: {job_id}")
    _su_opened[job_id] = req.su_opened
    _su_closed[job_id] = req.su_closed
    return _enrich(job)


@router.get("/sheet-url")
def sheet_url():
    cfg = get_config()
    sid = cfg.gsheets_spreadsheet_id
    if not sid or sid in ("", "YOUR_SPREADSHEET_ID_HERE"):
        return {"sheet_url": None}
    return {"sheet_url": f"https://docs.google.com/spreadsheets/d/{sid}"}


@router.get("/auth-status")
def auth_status():
    available = gsheets.is_available()
    auth_error = CREDENTIALS_PATH.exists() and TOKEN_PATH.exists() and not available
    return {
        "available": available,
        "has_credentials": CREDENTIALS_PATH.exists(),
        "has_token": TOKEN_PATH.exists(),
        "auth_error": auth_error,
    }


@router.post("/auth")
def reauth():
    """Delete the stale token and re-run the OAuth browser flow on the server machine."""
    if not CREDENTIALS_PATH.exists():
        raise HTTPException(status_code=503, detail="credentials.json not found — cannot authenticate.")
    try:
        gsheets.run_auth_flow()
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Auth failed: {e}")
    return {"ok": True}


@router.post("/push")
def push_to_sheets():
    """Push all current job states to Google Sheets (targeted upserts — no full_sync)."""
    if not gsheets.is_available():
        raise HTTPException(status_code=503, detail="Google Sheets not configured")
    jobs = filesystem.scan_all_jobs()
    for job in jobs:
        job.notes = _notes.get(job.job_id, "")
        job.su_opened = _su_opened.get(job.job_id, "")
        job.su_closed = _su_closed.get(job.job_id, "")
    # Batched write: bounded API calls regardless of job count, so a large push
    # doesn't trip the Sheets read quota (60/min/user → HTTP 429).
    errors = gsheets.push_all(jobs)
    if errors:
        raise HTTPException(status_code=500, detail=f"Push failed: {'; '.join(errors)}")
    return {"pushed": len(jobs)}


@router.post("/sync")
def sync_with_sheets():
    """Pull notes/SU fields from sheet into in-memory store, then push merged state back.

    Pull rule: sheet value wins when non-empty; local value is kept when sheet is empty.
    Only jobs that exist on the filesystem are updated — no new pgram numbers are created
    from sheet rows. Rows in the sheet for unknown pgrams are left untouched.
    Returns the updated job list so the frontend can refresh state.
    """
    if not gsheets.is_available():
        raise HTTPException(status_code=503, detail="Google Sheets not configured")

    jobs = filesystem.scan_all_jobs()
    job_ids = {j.job_id for j in jobs}

    # Pull: merge non-empty sheet values into in-memory stores for existing jobs only.
    pulled = gsheets.pull_notes_and_su()
    if pulled is None:
        raise HTTPException(status_code=503, detail="Failed to read sheet data")

    for row in pulled:
        job_id = row["job_id"]
        if job_id not in job_ids:
            continue
        if row["notes"]:
            _notes[job_id] = row["notes"]
        if row["su_opened"]:
            _su_opened[job_id] = row["su_opened"]
        if row["su_closed"]:
            _su_closed[job_id] = row["su_closed"]

    # Push merged state to sheet.
    for job in jobs:
        job.notes = _notes.get(job.job_id, "")
        job.su_opened = _su_opened.get(job.job_id, "")
        job.su_closed = _su_closed.get(job.job_id, "")

    errors = gsheets.push_all(jobs)
    if errors:
        raise HTTPException(status_code=500, detail=f"Sync failed: {'; '.join(errors)}")

    return [_enrich(j) for j in jobs]
