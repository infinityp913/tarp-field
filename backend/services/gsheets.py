"""
Field Google Sheets service — writes to TARP Field Pgram Tracking only.

TARP Field Pgram Tracking columns (0-indexed):
  0  Pgram Number        ← integer (e.g. 696)
  1  SUs Opened          ← from field UI
  2  SUs Closed          ← from field UI
  3  Field Notes         ← from field UI
  4  Field Stage         ← raw_images / aligned / moved_to_msi
  5  Last Updated (CET)

The field machine NEVER writes to TARP Lab Pgram Tracking or SU trench tabs.
Those are lab-owned. The lab reads this sheet during sync.
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
_creds = None  # Cached credentials — kept to detect mid-session revocation

_FIELD_SHEET = "TARP Field Pgram Tracking"

# Column indices — TARP Field Pgram Tracking
FP_NUM = 0
FP_SUS_OPENED = 1
FP_SUS_CLOSED = 2
FP_NOTES = 3
FP_STAGE = 4
FP_UPDATED = 5
FP_COLS = 6

# Dark green header
_HEADER_R = 46 / 255
_HEADER_G = 92 / 255
_HEADER_B = 40 / 255


def _log_error(msg: str):
    logger.error(msg)
    try:
        with open(LOG_PATH, "a") as f:
            f.write(f"ERROR {msg}\n")
    except OSError:
        pass


def _save_token(creds) -> None:
    import os as _os
    fd = _os.open(str(TOKEN_PATH), _os.O_WRONLY | _os.O_CREAT | _os.O_TRUNC, 0o600)
    with _os.fdopen(fd, "w") as token:
        token.write(creds.to_json())


def _get_service():
    global _service, _creds, _gsheets_available

    # Fast path: cached service — check creds are still valid before returning.
    if _service is not None and _creds is not None:
        if _creds.valid:
            return _service
        if _creds.expired and _creds.refresh_token:
            try:
                from google.auth.transport.requests import Request
                _creds.refresh(Request())
                _save_token(_creds)
                return _service
            except Exception as e:
                _gsheets_available = False
                _service = None
                _creds = None
                _log_error(f"Token refresh failed (likely revoked): {e}")
                return None
        _gsheets_available = False
        _service = None
        _creds = None
        return None

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
            _save_token(creds)
        _creds = creds
        _service = build("sheets", "v4", credentials=creds)
        _gsheets_available = True
        return _service
    except Exception as e:
        _gsheets_available = False
        _service = None
        _creds = None
        _log_error(f"Google Sheets auth failed: {e}")
        return None


def is_available() -> bool:
    return _gsheets_available and get_config().gsheets_spreadsheet_id not in ("", "YOUR_SPREADSHEET_ID_HERE")


def init():
    """Ensure TARP Field Pgram Tracking tab exists at startup."""
    if is_available():
        _ensure_field_sheet()


def run_auth_flow():
    """Delete stale token and run the OAuth browser flow."""
    global _service, _creds, _gsheets_available
    if not CREDENTIALS_PATH.exists():
        return
    if TOKEN_PATH.exists():
        TOKEN_PATH.unlink()
    _service = None
    _creds = None
    _gsheets_available = True
    _get_service()


def _ensure_field_sheet():
    """Create TARP Field Pgram Tracking tab if it doesn't exist yet."""
    svc = _get_service()
    if svc is None:
        return
    sid = get_config().gsheets_spreadsheet_id
    try:
        meta = svc.spreadsheets().get(spreadsheetId=sid).execute()
        existing = {s["properties"]["title"] for s in meta.get("sheets", [])}
        if _FIELD_SHEET not in existing:
            svc.spreadsheets().batchUpdate(
                spreadsheetId=sid,
                body={"requests": [{"addSheet": {"properties": {"title": _FIELD_SHEET}}}]},
            ).execute()
            # Write header
            _write_range(f"{_FIELD_SHEET}!A1:F1", [[
                "Pgram Number", "SUs Opened", "SUs Closed",
                "Field Notes", "Field Stage", "Last Updated (CET)",
            ]])
            # Apply header style
            meta2 = svc.spreadsheets().get(spreadsheetId=sid).execute()
            existing2 = {s["properties"]["title"]: s["properties"]["sheetId"]
                         for s in meta2.get("sheets", [])}
            sheet_id = existing2.get(_FIELD_SHEET, 0)
            if sheet_id:
                _apply_header_style(svc, sid, sheet_id)
    except Exception as e:
        _log_error(f"_ensure_field_sheet failed: {e}")


def _apply_header_style(svc, sid: str, sheet_id: int):
    try:
        svc.spreadsheets().batchUpdate(spreadsheetId=sid, body={"requests": [
            {
                "updateSheetProperties": {
                    "properties": {"sheetId": sheet_id, "gridProperties": {"frozenRowCount": 1}},
                    "fields": "gridProperties.frozenRowCount",
                }
            },
            # Header row: dark green background, white bold text
            {
                "repeatCell": {
                    "range": {"sheetId": sheet_id, "startRowIndex": 0, "endRowIndex": 1,
                               "startColumnIndex": 0, "endColumnIndex": FP_COLS},
                    "cell": {
                        "userEnteredFormat": {
                            "backgroundColor": {"red": _HEADER_R, "green": _HEADER_G, "blue": _HEADER_B},
                            "textFormat": {"foregroundColor": {"red": 1, "green": 1, "blue": 1},
                                           "bold": True},
                            "horizontalAlignment": "CENTER",
                        }
                    },
                    "fields": "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)",
                }
            },
            # Data rows: explicit white background so appended rows don't inherit header green
            {
                "repeatCell": {
                    "range": {"sheetId": sheet_id, "startRowIndex": 1, "endRowIndex": 2000,
                               "startColumnIndex": 0, "endColumnIndex": FP_COLS},
                    "cell": {
                        "userEnteredFormat": {
                            "backgroundColor": {"red": 1.0, "green": 1.0, "blue": 1.0},
                        }
                    },
                    "fields": "userEnteredFormat(backgroundColor)",
                }
            },
        ]}).execute()
    except Exception as e:
        _log_error(f"_apply_header_style failed (non-fatal): {e}")


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
    """Read TARP Field Pgram Tracking — used to prefill stage info on field UI."""
    global _pgram_cache, _pgram_cache_time
    with _cache_lock:
        if time.time() - _pgram_cache_time < _CACHE_TTL:
            return list(_pgram_cache)

    if not is_available():
        return []

    rows = _read_range(f"{_FIELD_SHEET}!A:F")
    if rows is None:
        with _cache_lock:
            return list(_pgram_cache)

    result = []
    for row in rows[1:]:
        if not row:
            continue
        while len(row) < FP_COLS:
            row.append("")
        if not row[FP_NUM]:
            continue
        raw = str(row[FP_NUM])
        job_id = f"Pgram_Job_{raw}" if raw.isdigit() else raw
        notes = row[FP_NOTES]
        if isinstance(notes, bool) or str(notes).upper() in ("TRUE", "FALSE"):
            notes = ""
        result.append({
            "job_id": job_id,
            "sus_opened": str(row[FP_SUS_OPENED]),
            "sus_closed": str(row[FP_SUS_CLOSED]),
            "notes": notes,
        })

    with _cache_lock:
        _pgram_cache = result
        _pgram_cache_time = time.time()
    return result


def upsert_pgram(job: FieldJob):
    """Write or update this job's row in TARP Field Pgram Tracking."""
    if not is_available():
        return

    _ensure_field_sheet()

    rows = _read_range(f"{_FIELD_SHEET}!A:F")
    if rows is None:
        return

    svc = _get_service()
    if svc is None:
        return
    sid = get_config().gsheets_spreadsheet_id

    num_str = _pg_num_str(job.job_id)
    new_row = [
        int(num_str) if num_str.isdigit() else num_str,
        job.su_opened,
        job.su_closed,
        job.notes,
        job.stage,
        cet_now(),
    ]

    target_row_idx = None
    for i, row in enumerate(rows[1:], start=2):
        if not row:
            continue
        while len(row) < FP_COLS:
            row.append("")
        if _pg_num_str(str(row[FP_NUM])) == num_str:
            target_row_idx = i
            break

    try:
        if target_row_idx is not None:
            _write_range(f"{_FIELD_SHEET}!A{target_row_idx}:F{target_row_idx}", [new_row])
            row_to_clear = target_row_idx
        else:
            result = svc.spreadsheets().values().append(
                spreadsheetId=sid,
                range=f"{_FIELD_SHEET}!A1",
                valueInputOption="RAW",
                insertDataOption="INSERT_ROWS",
                body={"values": [new_row]},
            ).execute()
            # Parse the actual row that was written so we can clear its background.
            # updatedRange is like "TARP Field Pgram Tracking!A5:F5"
            updated = result.get("updates", {}).get("updatedRange", "")
            row_to_clear = None
            if updated:
                import re as _re
                m = _re.search(r"[A-Z](\d+):", updated)
                if m:
                    row_to_clear = int(m.group(1))

        # Reset background to white so inherited header green doesn't bleed into data rows.
        if row_to_clear is not None:
            meta = svc.spreadsheets().get(spreadsheetId=sid).execute()
            sheet_ids = {s["properties"]["title"]: s["properties"]["sheetId"]
                         for s in meta.get("sheets", [])}
            sh_id = sheet_ids.get(_FIELD_SHEET)
            if sh_id is not None:
                row_0 = row_to_clear - 1  # convert 1-indexed to 0-indexed
                svc.spreadsheets().batchUpdate(spreadsheetId=sid, body={"requests": [{
                    "repeatCell": {
                        "range": {"sheetId": sh_id,
                                   "startRowIndex": row_0, "endRowIndex": row_0 + 1,
                                   "startColumnIndex": 0, "endColumnIndex": FP_COLS},
                        "cell": {"userEnteredFormat": {
                            "backgroundColor": {"red": 1.0, "green": 1.0, "blue": 1.0},
                        }},
                        "fields": "userEnteredFormat(backgroundColor)",
                    }
                }]}).execute()

        with _cache_lock:
            global _pgram_cache_time
            _pgram_cache_time = 0
    except Exception as e:
        _log_error(f"upsert_pgram({job.job_id}) failed: {e}")
        raise
