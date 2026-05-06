"""
Field filesystem service — scans and moves Pgram_Job_### folders between
three stage directories: Not Started, Aligned, Move to MSI.

Moving to move_to_msi renames the folder with the _MOVED_TO_MSI suffix so
the Lab machine can identify it on the shared drive.
"""

import re
from pathlib import Path
from typing import Optional

from backend.config import get_config
from backend.models import FieldJob, JOB_PATTERN_RE, _MSI_SUFFIX

_JOB_RE = re.compile(JOB_PATTERN_RE, re.IGNORECASE)


def _parse_job_dir(name: str, stage: str) -> Optional[FieldJob]:
    clean = name
    if clean.upper().endswith(_MSI_SUFFIX.upper()):
        clean = clean[: -len(_MSI_SUFFIX)]

    m = _JOB_RE.match(clean)
    if not m:
        return None

    job_id = f"Pgram_Job_{m.group(1)}"
    su_string = m.group(2) or ""

    trench = ""
    su_m = re.search(r"SU\s*(\d+)", su_string, re.IGNORECASE)
    if su_m:
        su_num = int(su_m.group(1))
        trench = f"Trench {(su_num // 1000) * 1000}"

    return FieldJob(job_id=job_id, su_string=su_string, trench=trench, stage=stage)


def scan_all_jobs() -> list[FieldJob]:
    cfg = get_config()
    base = Path(cfg.base_path)
    jobs: list[FieldJob] = []

    for stage_key, folder_name in cfg.stage_folders.items():
        stage_dir = base / folder_name
        if not stage_dir.exists():
            continue
        for entry in sorted(stage_dir.iterdir()):
            if not entry.is_dir():
                continue
            job = _parse_job_dir(entry.name, stage_key)
            if job:
                jobs.append(job)

    return jobs


def get_job(job_id: str) -> Optional[FieldJob]:
    for job in scan_all_jobs():
        if job.job_id == job_id:
            return job
    return None


def _find_job_path(job_id: str) -> Optional[tuple[Path, str]]:
    """Return (path, stage_key) for the first matching folder."""
    cfg = get_config()
    base = Path(cfg.base_path)
    for stage_key, folder_name in cfg.stage_folders.items():
        stage_dir = base / folder_name
        if not stage_dir.exists():
            continue
        for entry in sorted(stage_dir.iterdir()):
            if not entry.is_dir():
                continue
            parsed = _parse_job_dir(entry.name, stage_key)
            if parsed and parsed.job_id == job_id:
                return entry, stage_key
    return None


def create_job(job_id: str, su_string: str = "") -> FieldJob:
    cfg = get_config()
    base = Path(cfg.base_path)
    stage_key = "not_started"
    stage_dir = base / cfg.stage_folders[stage_key]
    stage_dir.mkdir(parents=True, exist_ok=True)

    folder_name = job_id if not su_string else f"{job_id}_{su_string}"
    dest = stage_dir / folder_name
    if dest.exists():
        raise FileExistsError(f"{dest} already exists")
    dest.mkdir()

    job = _parse_job_dir(folder_name, stage_key)
    if job is None:
        raise ValueError(f"Could not parse folder name: {folder_name}")
    return job


def move_job(job_id: str, target_stage: str) -> FieldJob:
    """Move a job folder to target_stage. Moving to move_to_msi appends _MOVED_TO_MSI."""
    cfg = get_config()
    base = Path(cfg.base_path)

    result = _find_job_path(job_id)
    if result is None:
        raise FileNotFoundError(f"No folder found for {job_id}")
    src_path, current_stage = result

    dest_dir = base / cfg.stage_folders[target_stage]
    dest_dir.mkdir(parents=True, exist_ok=True)

    # Strip any existing MSI suffix before constructing new name
    clean_name = src_path.name
    if clean_name.upper().endswith(_MSI_SUFFIX.upper()):
        clean_name = clean_name[: -len(_MSI_SUFFIX)]

    new_name = clean_name + (_MSI_SUFFIX if target_stage == "move_to_msi" else "")
    dest = dest_dir / new_name

    if dest.exists():
        raise FileExistsError(f"Destination already exists: {dest}")

    src_path.rename(dest)

    job = _parse_job_dir(dest.name, target_stage)
    if job is None:
        raise ValueError(f"Could not parse moved folder: {dest.name}")
    return job
