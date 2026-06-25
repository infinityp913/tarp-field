"""Tests for gsheets.pull_notes_and_su and the /api/field/sync endpoint."""
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from backend.services import gsheets
from backend.models import FieldJob


# ---------------------------------------------------------------------------
# Helpers shared across tests
# ---------------------------------------------------------------------------

_HEADER = ["Pgram Number", "SUs Opened", "SUs Closed", "Field Notes", "Field Stage", "Last Updated"]


def _sheet_rows(*rows):
    """Build a sheet rows list with a header prepended."""
    return [_HEADER, *rows]


# ---------------------------------------------------------------------------
# pull_notes_and_su — unit tests
# ---------------------------------------------------------------------------

class TestPullNotesAndSu:
    def test_returns_empty_when_unavailable(self, monkeypatch):
        monkeypatch.setattr(gsheets, "is_available", lambda: False)
        assert gsheets.pull_notes_and_su() == []

    def test_returns_none_when_read_fails(self, monkeypatch):
        monkeypatch.setattr(gsheets, "is_available", lambda: True)
        monkeypatch.setattr(gsheets, "_read_range", lambda r: None)
        assert gsheets.pull_notes_and_su() is None

    def test_parses_notes_su_opened_su_closed(self, monkeypatch):
        monkeypatch.setattr(gsheets, "is_available", lambda: True)
        monkeypatch.setattr(gsheets, "_read_range", lambda r: _sheet_rows(
            ["696", "SU17001", "SU17002", "Some notes", "raw_images", "2026-01-01"],
        ))
        result = gsheets.pull_notes_and_su()
        assert len(result) == 1
        assert result[0]["job_id"] == "Pgram_Job_696"
        assert result[0]["notes"] == "Some notes"
        assert result[0]["su_opened"] == "SU17001"
        assert result[0]["su_closed"] == "SU17002"

    def test_pads_short_rows(self, monkeypatch):
        monkeypatch.setattr(gsheets, "is_available", lambda: True)
        # Row has only pgram number — all other columns missing
        monkeypatch.setattr(gsheets, "_read_range", lambda r: _sheet_rows(["696"]))
        result = gsheets.pull_notes_and_su()
        assert result[0]["notes"] == ""
        assert result[0]["su_opened"] == ""
        assert result[0]["su_closed"] == ""

    def test_skips_rows_with_empty_pgram_number(self, monkeypatch):
        monkeypatch.setattr(gsheets, "is_available", lambda: True)
        monkeypatch.setattr(gsheets, "_read_range", lambda r: _sheet_rows(
            ["", "SU17001", "SU17002", "orphan notes", "raw_images", "2026-01-01"],
            ["697", "", "", "valid row", "aligned", "2026-01-02"],
        ))
        result = gsheets.pull_notes_and_su()
        assert len(result) == 1
        assert result[0]["job_id"] == "Pgram_Job_697"

    def test_skips_empty_rows(self, monkeypatch):
        monkeypatch.setattr(gsheets, "is_available", lambda: True)
        monkeypatch.setattr(gsheets, "_read_range", lambda r: _sheet_rows(
            [],
            ["697", "", "", "notes here", "raw_images", "2026-01-01"],
        ))
        result = gsheets.pull_notes_and_su()
        assert len(result) == 1

    def test_non_digit_pgram_number_used_as_is(self, monkeypatch):
        monkeypatch.setattr(gsheets, "is_available", lambda: True)
        monkeypatch.setattr(gsheets, "_read_range", lambda r: _sheet_rows(
            ["CustomID", "SU1", "SU2", "note", "raw_images", "2026-01-01"],
        ))
        result = gsheets.pull_notes_and_su()
        assert result[0]["job_id"] == "CustomID"

    def test_string_true_false_notes_treated_as_empty(self, monkeypatch):
        monkeypatch.setattr(gsheets, "is_available", lambda: True)
        monkeypatch.setattr(gsheets, "_read_range", lambda r: _sheet_rows(
            ["696", "", "", "TRUE", "raw_images", "2026-01-01"],
            ["697", "", "", "FALSE", "raw_images", "2026-01-01"],
        ))
        result = gsheets.pull_notes_and_su()
        assert result[0]["notes"] == ""
        assert result[1]["notes"] == ""

    def test_ignores_boolean_notes(self, monkeypatch):
        monkeypatch.setattr(gsheets, "is_available", lambda: True)
        monkeypatch.setattr(gsheets, "_read_range", lambda r: _sheet_rows(
            ["696", "", "", True, "raw_images", "2026-01-01"],
        ))
        result = gsheets.pull_notes_and_su()
        assert result[0]["notes"] == ""

    def test_ignores_boolean_su_values(self, monkeypatch):
        monkeypatch.setattr(gsheets, "is_available", lambda: True)
        monkeypatch.setattr(gsheets, "_read_range", lambda r: _sheet_rows(
            ["696", True, False, "notes", "raw_images", "2026-01-01"],
        ))
        result = gsheets.pull_notes_and_su()
        assert result[0]["su_opened"] == ""
        assert result[0]["su_closed"] == ""

    def test_string_true_false_su_treated_as_empty(self, monkeypatch):
        monkeypatch.setattr(gsheets, "is_available", lambda: True)
        monkeypatch.setattr(gsheets, "_read_range", lambda r: _sheet_rows(
            ["696", "TRUE", "FALSE", "notes", "raw_images", "2026-01-01"],
        ))
        result = gsheets.pull_notes_and_su()
        assert result[0]["su_opened"] == ""
        assert result[0]["su_closed"] == ""

    def test_updates_cache_after_read(self, monkeypatch):
        import time
        monkeypatch.setattr(gsheets, "is_available", lambda: True)
        monkeypatch.setattr(gsheets, "_read_range", lambda r: _sheet_rows(
            ["700", "SU100", "SU101", "field note", "aligned", "2026-01-01"],
        ))
        gsheets.pull_notes_and_su()
        # Cache should now be warm so get_pgram_rows returns without another read
        read_count = [0]
        original_read = gsheets._read_range
        monkeypatch.setattr(gsheets, "_read_range", lambda r: (read_count.__setitem__(0, read_count[0] + 1), original_read(r))[1])
        # Force cache to appear fresh via monkeypatch so teardown restores original value
        monkeypatch.setattr(gsheets, "_pgram_cache_time", time.time())
        gsheets.get_pgram_rows()
        assert read_count[0] == 0, "get_pgram_rows should use warm cache after pull_notes_and_su"


# ---------------------------------------------------------------------------
# /api/field/sync — endpoint integration tests
# ---------------------------------------------------------------------------

@pytest.fixture
def client(monkeypatch, tmp_path):
    """TestClient with sheets stubbed and a minimal filesystem."""
    from backend.main import app
    from backend import config as cfg_module
    from backend.routers import field as field_router

    # Isolate in-memory stores so tests don't bleed into each other.
    monkeypatch.setattr(field_router, "_notes", {})
    monkeypatch.setattr(field_router, "_su_opened", {})
    monkeypatch.setattr(field_router, "_su_closed", {})

    # Build a real (but temporary) directory tree with one job.
    raw = tmp_path / "Raw Images"
    (raw / "Pgram_Job_696").mkdir(parents=True)
    (tmp_path / "Aligned").mkdir()
    (tmp_path / "Moved to MSI").mkdir()

    cfg = cfg_module.Config.__new__(cfg_module.Config)
    cfg.base_path = str(tmp_path)
    cfg.stage_folders = {
        "raw_images": "Raw Images",
        "aligned": "Aligned",
        "moved_to_msi": "Moved to MSI",
    }
    cfg.gsheets_spreadsheet_id = "test-sheet-id"
    cfg.host = "127.0.0.1"
    cfg.port = 8000
    monkeypatch.setattr(cfg_module, "_instance", cfg)

    monkeypatch.setattr(gsheets, "is_available", lambda: True)
    monkeypatch.setattr(gsheets, "push_all", lambda jobs: [])

    return TestClient(app)


def test_sync_returns_503_when_sheets_unavailable(monkeypatch, tmp_path):
    monkeypatch.setattr(gsheets, "is_available", lambda: False)
    from backend.main import app
    c = TestClient(app)
    resp = c.post("/api/field/sync")
    assert resp.status_code == 503


def test_sync_pulls_sheet_notes_into_response(client, monkeypatch):
    monkeypatch.setattr(gsheets, "pull_notes_and_su", lambda: [
        {"job_id": "Pgram_Job_696", "notes": "pulled note", "su_opened": "", "su_closed": ""},
    ])
    resp = client.post("/api/field/sync")
    assert resp.status_code == 200
    jobs = resp.json()
    job = next(j for j in jobs if j["job_id"] == "Pgram_Job_696")
    assert job["notes"] == "pulled note"


def test_sync_pulls_su_opened_and_closed(client, monkeypatch):
    monkeypatch.setattr(gsheets, "pull_notes_and_su", lambda: [
        {"job_id": "Pgram_Job_696", "notes": "", "su_opened": "SU17001", "su_closed": "SU17002"},
    ])
    resp = client.post("/api/field/sync")
    assert resp.status_code == 200
    job = next(j for j in resp.json() if j["job_id"] == "Pgram_Job_696")
    assert job["su_opened"] == "SU17001"
    assert job["su_closed"] == "SU17002"


def test_sync_does_not_overwrite_local_with_empty_sheet_value(client, monkeypatch):
    from backend.routers import field as field_router
    field_router._notes["Pgram_Job_696"] = "local note"
    # Sheet has empty notes — local should be preserved
    monkeypatch.setattr(gsheets, "pull_notes_and_su", lambda: [
        {"job_id": "Pgram_Job_696", "notes": "", "su_opened": "", "su_closed": ""},
    ])
    resp = client.post("/api/field/sync")
    assert resp.status_code == 200
    job = next(j for j in resp.json() if j["job_id"] == "Pgram_Job_696")
    assert job["notes"] == "local note"


def test_sync_ignores_unknown_pgram_rows_from_sheet(client, monkeypatch):
    from backend.routers import field as field_router
    monkeypatch.setattr(gsheets, "pull_notes_and_su", lambda: [
        {"job_id": "Pgram_Job_999", "notes": "ghost row", "su_opened": "", "su_closed": ""},
    ])
    resp = client.post("/api/field/sync")
    assert resp.status_code == 200
    # Unknown job should not appear in response
    assert all(j["job_id"] != "Pgram_Job_999" for j in resp.json())
    # And should not pollute in-memory store
    assert "Pgram_Job_999" not in field_router._notes


def test_sync_returns_500_when_push_fails(client, monkeypatch):
    monkeypatch.setattr(gsheets, "pull_notes_and_su", lambda: [])
    monkeypatch.setattr(gsheets, "push_all", lambda jobs: ["write error"])
    resp = client.post("/api/field/sync")
    assert resp.status_code == 500
    assert "Sync failed" in resp.json()["detail"]


def test_sync_aborts_when_pull_returns_none(client, monkeypatch):
    """Transient sheet read failure must not trigger a push of stale/empty data."""
    monkeypatch.setattr(gsheets, "pull_notes_and_su", lambda: None)
    resp = client.post("/api/field/sync")
    assert resp.status_code == 503
    assert "Failed to read sheet data" in resp.json()["detail"]


def test_sync_sheet_value_wins_over_local_when_both_non_empty(client, monkeypatch):
    from backend.routers import field as field_router
    field_router._notes["Pgram_Job_696"] = "old local note"
    monkeypatch.setattr(gsheets, "pull_notes_and_su", lambda: [
        {"job_id": "Pgram_Job_696", "notes": "sheet note", "su_opened": "", "su_closed": ""},
    ])
    resp = client.post("/api/field/sync")
    assert resp.status_code == 200
    job = next(j for j in resp.json() if j["job_id"] == "Pgram_Job_696")
    assert job["notes"] == "sheet note"
