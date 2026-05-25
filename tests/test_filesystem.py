"""Tests for filesystem parsing logic — no real disk I/O needed for the core cases."""
import tempfile
from pathlib import Path

import pytest

from backend.models import FieldJob, IgnoredFolder


# ---------------------------------------------------------------------------
# _parse_job_dir — unit tests (no config or disk)
# ---------------------------------------------------------------------------

from backend.services.filesystem import _parse_job_dir, _iter_job_dirs


def test_parse_basic_job():
    job = _parse_job_dir("Pgram_Job_42", "raw_images")
    assert job is not None
    assert job.job_id == "Pgram_Job_42"
    assert job.su_string == ""
    assert job.stage == "raw_images"


def test_parse_job_with_su_string():
    job = _parse_job_dir("Pgram_Job_42_SU17001", "aligned")
    assert job is not None
    assert job.job_id == "Pgram_Job_42"
    assert job.su_string == "SU17001"
    assert job.trench == "Trench 17000"


def test_parse_job_with_msi_suffix():
    job = _parse_job_dir("Pgram_Job_42_SU17001_MOVED_TO_MSI", "moved_to_msi")
    assert job is not None
    assert job.job_id == "Pgram_Job_42"
    assert job.su_string == "SU17001"


def test_parse_msi_suffix_case_insensitive():
    job = _parse_job_dir("Pgram_Job_10_moved_to_msi", "moved_to_msi")
    assert job is not None
    assert job.job_id == "Pgram_Job_10"


def test_parse_job_non_match_returns_none():
    assert _parse_job_dir("PreSU17001", "raw_images") is None
    assert _parse_job_dir("random_folder", "aligned") is None
    assert _parse_job_dir(".hidden", "aligned") is None


def test_parse_trench_folder_itself_returns_none():
    assert _parse_job_dir("Trench 17000", "raw_images") is None


def test_numeric_id():
    job = _parse_job_dir("Pgram_Job_99", "raw_images")
    assert job.numeric_id == 99


# ---------------------------------------------------------------------------
# scan_ignored_folders — integration test using a tmp directory + config patch
# ---------------------------------------------------------------------------

def _make_stage_dir(base: Path, stage_name: str, folders: list[str]) -> None:
    stage = base / stage_name
    stage.mkdir(parents=True)
    for f in folders:
        (stage / f).mkdir()


def _patch_config(monkeypatch, tmp_path):
    from backend import config as cfg_module
    cfg = cfg_module.Config.__new__(cfg_module.Config)
    cfg.base_path = str(tmp_path)
    cfg.stage_folders = {
        "raw_images": "Raw Images",
        "aligned": "Aligned",
        "moved_to_msi": "Moved to MSI",
    }
    cfg.gsheets_spreadsheet_id = ""
    cfg.host = "127.0.0.1"
    cfg.port = 8000
    monkeypatch.setattr(cfg_module, "_instance", cfg)


def test_scan_ignored_folders_detects_misnamed(monkeypatch, tmp_path):
    """Misnamed folders (non-Pgram_Job) should appear in ignored list."""
    _make_stage_dir(tmp_path, "Raw Images", [
        "Pgram_Job_1",
        "PreSU17001",   # misnamed — should be flagged
        "Pgram_Job_2_SU17001",
    ])
    _patch_config(monkeypatch, tmp_path)

    from backend.services.filesystem import scan_ignored_folders
    ignored = scan_ignored_folders()
    names = [f.name for f in ignored]
    assert "PreSU17001" in names
    assert "Pgram_Job_1" not in names
    assert "Pgram_Job_2_SU17001" not in names


def test_scan_ignored_folders_trench_child(monkeypatch, tmp_path):
    """Misnamed folders nested inside a Trench folder should be flagged with parent."""
    stage = tmp_path / "Raw Images"
    trench = stage / "Trench 17000"
    trench.mkdir(parents=True)
    (trench / "Pgram_Job_5_SU17001").mkdir()
    (trench / "BadName").mkdir()  # should be flagged
    _patch_config(monkeypatch, tmp_path)

    from backend.services.filesystem import scan_ignored_folders
    ignored = scan_ignored_folders()
    assert any(f.name == "BadName" and f.parent == "Trench 17000" for f in ignored)
    assert not any(f.name == "Pgram_Job_5_SU17001" for f in ignored)
    assert len([f for f in ignored if f.parent == "Trench 17000"]) == 1


def test_scan_ignored_folders_hidden_not_flagged(monkeypatch, tmp_path):
    """Hidden folders (starting with '.') must not appear."""
    stage = tmp_path / "Raw Images"
    stage.mkdir(parents=True)
    (stage / ".DS_Store_dir").mkdir()
    _patch_config(monkeypatch, tmp_path)

    from backend.services.filesystem import scan_ignored_folders
    ignored = scan_ignored_folders()
    assert not any(f.name.startswith(".") for f in ignored)


def test_scan_ignored_folders_hidden_trench_child_not_flagged(monkeypatch, tmp_path):
    """Hidden folders nested inside a Trench folder must not be flagged."""
    stage = tmp_path / "Raw Images"
    trench = stage / "Trench 17000"
    trench.mkdir(parents=True)
    (trench / ".hidden_child").mkdir()
    _patch_config(monkeypatch, tmp_path)

    from backend.services.filesystem import scan_ignored_folders
    ignored = scan_ignored_folders()
    assert not any(f.name.startswith(".") for f in ignored)


def test_scan_ignored_folders_nonexistent_stage_skipped(monkeypatch, tmp_path):
    """Stages whose directories don't exist on disk should be silently skipped."""
    # Only create Raw Images; Aligned and Moved to MSI are absent.
    stage = tmp_path / "Raw Images"
    stage.mkdir(parents=True)
    (stage / "NotAJob").mkdir()
    _patch_config(monkeypatch, tmp_path)

    from backend.services.filesystem import scan_ignored_folders
    ignored = scan_ignored_folders()
    # Only one ignored folder — from Raw Images
    assert len(ignored) == 1
    assert ignored[0].name == "NotAJob"
    assert ignored[0].stage == "raw_images"


def test_scan_ignored_folders_stage_field_correct(monkeypatch, tmp_path):
    """Ignored folder records should carry the correct stage key, not the folder name."""
    _make_stage_dir(tmp_path, "Aligned", ["Weird_Folder"])
    _patch_config(monkeypatch, tmp_path)

    from backend.services.filesystem import scan_ignored_folders
    ignored = scan_ignored_folders()
    assert any(f.name == "Weird_Folder" and f.stage == "aligned" for f in ignored)


def test_scan_ignored_folders_file_not_flagged(monkeypatch, tmp_path):
    """Plain files inside a stage directory must not be flagged as ignored folders."""
    stage = tmp_path / "Raw Images"
    stage.mkdir(parents=True)
    (stage / "some_file.txt").write_text("data")
    _patch_config(monkeypatch, tmp_path)

    from backend.services.filesystem import scan_ignored_folders
    ignored = scan_ignored_folders()
    assert len(ignored) == 0


# ---------------------------------------------------------------------------
# IgnoredFolder model — field validation
# ---------------------------------------------------------------------------

def test_ignored_folder_model_defaults():
    """IgnoredFolder.parent defaults to empty string."""
    from backend.models import IgnoredFolder
    f = IgnoredFolder(name="BadFolder", stage="aligned")
    assert f.parent == ""


def test_ignored_folder_model_with_parent():
    """IgnoredFolder records parent when set."""
    from backend.models import IgnoredFolder
    f = IgnoredFolder(name="BadFolder", stage="raw_images", parent="Trench 17000")
    assert f.parent == "Trench 17000"


# ---------------------------------------------------------------------------
# FieldJob.stage_label — classmethod coverage
# ---------------------------------------------------------------------------

def test_stage_label_known_stages():
    from backend.models import FieldJob
    assert FieldJob.stage_label("raw_images") == "Raw Images"
    assert FieldJob.stage_label("aligned") == "Aligned"
    assert FieldJob.stage_label("moved_to_msi") == "Moved to MSI"


def test_stage_label_unknown_falls_through():
    """Unknown stage keys are returned as-is."""
    from backend.models import FieldJob
    assert FieldJob.stage_label("custom_stage") == "custom_stage"


# ---------------------------------------------------------------------------
# /api/field/ignored-folders endpoint — HTTP integration test
# ---------------------------------------------------------------------------

def test_ignored_folders_endpoint_returns_list(monkeypatch, tmp_path):
    """GET /api/field/ignored-folders returns a JSON list via the FastAPI router."""
    _make_stage_dir(tmp_path, "Raw Images", ["BadFolder", "Pgram_Job_1"])
    _patch_config(monkeypatch, tmp_path)

    from fastapi.testclient import TestClient
    from backend.main import app
    client = TestClient(app)
    response = client.get("/api/field/ignored-folders")
    assert response.status_code == 200
    data = response.json()
    names = [f["name"] for f in data]
    assert "BadFolder" in names
    assert "Pgram_Job_1" not in names


def test_ignored_folders_endpoint_empty_when_all_valid(monkeypatch, tmp_path):
    """GET /api/field/ignored-folders returns [] when every folder is well-named."""
    _make_stage_dir(tmp_path, "Raw Images", ["Pgram_Job_1", "Pgram_Job_2_SU17001"])
    _patch_config(monkeypatch, tmp_path)

    from fastapi.testclient import TestClient
    from backend.main import app
    client = TestClient(app)
    response = client.get("/api/field/ignored-folders")
    assert response.status_code == 200
    assert response.json() == []
