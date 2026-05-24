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


def test_scan_ignored_folders_hidden_not_flagged(monkeypatch, tmp_path):
    """Hidden folders (starting with '.') must not appear."""
    stage = tmp_path / "Raw Images"
    stage.mkdir(parents=True)
    (stage / ".DS_Store_dir").mkdir()
    _patch_config(monkeypatch, tmp_path)

    from backend.services.filesystem import scan_ignored_folders
    ignored = scan_ignored_folders()
    assert not any(f.name.startswith(".") for f in ignored)
