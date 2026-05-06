"""
Field Google Sheets service — targeted pgram upserts only.

The Field machine writes to the Pgram Jobs sheet using per-job upserts.
It never calls full_sync, which would blank the SU Tracking sheet that
only the Lab machine knows how to populate.

Pgram Jobs sheet columns (0-indexed):
  0  Pgram Number        ← integer (e.g. 696)
  1  Trench
  2  SUs Open
  3  SUs Closed          ← manual, preserved read-before-write
  4  Photos—No Alignment ← TRUE when stage >= aligned
  5  Alignment+Manual    ← not set by field; preserved
  6  Overnight Completed ← not set by field; preserved
  7  Uploaded to AIR     ← not set by field; preserved
  8  Notes
  9  Last Updated (CET)
"""

import logging
import threading
import time
from typing import Optional

from backend.config import CREDENTIALS_PATH, TOKEN_DIR, TOKEN_PATH, LOG_PATH, get_config
from backend.models import FieldJob, cet_now

logger = logging.getLogger(__name__)

_SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]
_CACHE_TTL = 30

_pgram_cache: list[dict] = []
_pgram_cache_time: float = 0
_cache_lock = threading.Lock()
_gsheets_available = True
_service = None

PG_NUM = 0
PG_TRENCH = 1
PG_SUS_OPEN = 2
PG_SUS_CLOSED = 3
PG_PHOTOS = 4
PG_ALIGN = 5
PG_OVERNIGHT = 6
PG_AIR = 7
PG_NOTES = 8
PG_UPDATED = 9
PG_COLS = 10


def _log_error(msg: str):
    logger.error(msg)
    try:
        with open(LOG_PATH, "a") as f:
            f.write(f"ERROR {msg}\n")
    except OSError:
        pass


def _get_service():
    global _service, _gsheets_available
    if _service is not None:
        return _service
    if not CREDENTIALS_PATH.exists():
        _gsheets_available = False
        _log_error("credentials.json not found — Google Sheets disabled")
        return None
    try:
        from google.auth.transport.requests import Request
        from google.oauth2.credentials import Credentials
        from google_auth_oauthlib.flow import InstalledAppFlow
        from googleapiclient.discovery import build

        creds = None
        TOKEN_DIR.mkdir(parents=True, exist_ok=True)
        if TOKEN_PATH.exists():
            creds = Credentials.from_authorized_user_file(str(TOKEN_PATH), _SCOPES)
        if not creds or not creds.valid:
            if creds and creds.expired and creds.refresh_token:
                creds.refresh(Request())
            else:
                flow = InstalledAppFlow.from_client_secrets_file(str(CREDENTIALS_PATH), _SCOPES)
                creds = flow.run_local_server(port=0)
            import os as _os
            fd = _os.open(str(TOKEN_PATH), _os.O_WRONLY | _os.O_CREAT | _os.O_TRUNC, 0o600)
            with _os.fdopen(fd, "w") as token:
                token.write(creds.to_json())
        _service = build("sheets", "v4", credentials=creds)
        _gsheets_available = True
        return _service
    except Exception as e:
        _gsheets_available = False
        _log_error(f"Google Sheets auth failed: {e}")
        return None


def is_available() -> bool:
    return _gsheets_available and get_config().gsheets_spreadsheet_id not in ("", "YOUR_SPREADSHEET_ID_HERE")


def init():
    _get_service()


def run_auth_flow():
    _get_service()


def _pg_num_str(job_id: str) -> str:
    for p in str(job_id).split("_"):
        if p.isdigit():
            return p
    return str(job_id)


def _bool(val) -> bool:
    if isinstance(val, bool):
        return val
    return str(val).upper() in ("TRUE", "1", "YES")


def _read_range(range_name: str) -> Optional[list[list]]:
    svc = _get_service()
    if svc is None:
        return None
    sid = get_config().gsheets_spreadsheet_id
    try:
        result = (
            svc.spreadsheets()
            .values()
            .get(spreadsheetId=sid, range=range_name)
            .execute(num_retries=2)
        )
        return result.get("values", [])
    except Exception as e:
        _log_error(f"_read_range({range_name}) failed: {e}")
        return None


def _write_range(range_name: str, values: list[list]):
    svc = _get_service()
    if svc is None:
        return
    sid = get_config().gsheets_spreadsheet_id
    try:
        svc.spreadsheets().values().update(
            spreadsheetId=sid,
            range=range_name,
            valueInputOption="RAW",
            body={"values": values},
        ).execute()
    except Exception as e:
        _log_error(f"_write_range({range_name}) failed: {e}")
        raise


def get_pgram_rows() -> list[dict]:
    global _pgram_cache, _pgram_cache_time
    with _cache_lock:
        if time.time() - _pgram_cache_time < _CACHE_TTL:
            return list(_pgram_cache)

    if not is_available():
        return []

    rows = _read_range("Pgram Jobs!A:J")
    if rows is None:
        with _cache_lock:
            return list(_pgram_cache)

    result = []
    for row in rows[1:]:
        if not row:
            continue
        while len(row) < PG_COLS:
            row.append("")
        if not row[PG_NUM]:
            continue
        raw = str(row[PG_NUM])
        job_id = f"Pgram_Job_{raw}" if raw.isdigit() else raw
        notes = row[PG_NOTES]
        if isinstance(notes, bool) or str(notes).upper() in ("TRUE", "FALSE"):
            notes = ""
        result.append({
            "job_id": job_id,
            "trench": row[PG_TRENCH],
            "notes": notes,
        })

    with _cache_lock:
        _pgram_cache = result
        _pgram_cache_time = time.time()
    return result


def upsert_pgram(job: FieldJob):
    """Write or update this job's row in Pgram Jobs. Preserves Lab-controlled columns."""
    if not is_available():
        return

    rows = _read_range("Pgram Jobs!A:J")
    if rows is None:
        return

    svc = _get_service()
    if svc is None:
        return
    sid = get_config().gsheets_spreadsheet_id

    num_str = _pg_num_str(job.job_id)
    photos = job.stage in ("aligned", "move_to_msi")

    # Find existing row
    target_row_idx = None
    preserved_sus_closed = 0
    preserved_align = False
    preserved_overnight = False
    preserved_air = False
    preserved_sus_open = 0

    for i, row in enumerate(rows[1:], start=2):
        if not row:
            continue
        while len(row) < PG_COLS:
            row.append("")
        if _pg_num_str(str(row[PG_NUM])) == num_str:
            target_row_idx = i
            preserved_sus_closed = row[PG_SUS_CLOSED]
            preserved_align = _bool(row[PG_ALIGN])
            preserved_overnight = _bool(row[PG_OVERNIGHT])
            preserved_air = _bool(row[PG_AIR])
            preserved_sus_open = row[PG_SUS_OPEN]
            break

    new_row = [
        int(num_str) if num_str.isdigit() else num_str,
        job.trench,
        preserved_sus_open,
        preserved_sus_closed,
        photos,
        preserved_align,
        preserved_overnight,
        preserved_air,
        job.notes,
        cet_now(),
    ]

    try:
        if target_row_idx is not None:
            _write_range(f"Pgram Jobs!A{target_row_idx}:J{target_row_idx}", [new_row])
        else:
            svc.spreadsheets().values().append(
                spreadsheetId=sid,
                range="Pgram Jobs!A1",
                valueInputOption="RAW",
                insertDataOption="INSERT_ROWS",
                body={"values": [new_row]},
            ).execute()
        # Invalidate cache
        with _cache_lock:
            global _pgram_cache_time
            _pgram_cache_time = 0
    except Exception as e:
        _log_error(f"upsert_pgram({job.job_id}) failed: {e}")
        raise
