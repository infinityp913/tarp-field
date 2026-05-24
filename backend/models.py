from datetime import datetime
from zoneinfo import ZoneInfo
from pydantic import BaseModel

FIELD_STAGES = ["raw_images", "aligned", "moved_to_msi"]

JOB_PATTERN_RE = r"^Pgram_Job_(\d+)(?:_(.+))?$"

_MSI_SUFFIX = "_MOVED_TO_MSI"


class FieldJob(BaseModel):
    job_id: str
    su_string: str = ""
    trench: str = ""
    stage: str
    notes: str = ""
    su_opened: str = ""
    su_closed: str = ""
    last_updated: str = ""

    @property
    def numeric_id(self) -> int:
        for p in self.job_id.split("_"):
            if p.isdigit():
                return int(p)
        return 0

    @classmethod
    def stage_label(cls, stage: str) -> str:
        return {
            "raw_images": "Raw Images",
            "aligned": "Aligned",
            "moved_to_msi": "Moved to MSI",
        }.get(stage, stage)


class MoveStageRequest(BaseModel):
    target_stage: str


class UpdateNotesRequest(BaseModel):
    notes: str


class UpdateSURequest(BaseModel):
    su_opened: str = ""
    su_closed: str = ""


class CreateJobRequest(BaseModel):
    job_id: str
    su_string: str = ""
    trench: str = ""


class IgnoredFolder(BaseModel):
    """A folder found in a stage directory that does not match the
    Pgram_Job_### naming convention and is therefore not shown on the
    board. Surfaced in the UI so users notice misnamed folders instead
    of wondering why a folder they expected is missing.
    """
    name: str
    stage: str
    parent: str = ""  # empty for top-level; "Trench XXX" if nested


def cet_now() -> str:
    dt = datetime.now(ZoneInfo("Europe/Rome"))
    return f"{dt.day} {dt.strftime('%b %Y, %H:%M')}"
