from datetime import datetime
from zoneinfo import ZoneInfo
from pydantic import BaseModel

FIELD_STAGES = ["not_started", "aligned", "move_to_msi"]

JOB_PATTERN_RE = r"^Pgram_Job_(\d+)(?:_(.+))?$"

_MSI_SUFFIX = "_MOVED_TO_MSI"


class FieldJob(BaseModel):
    job_id: str
    su_string: str = ""
    trench: str = ""
    stage: str
    notes: str = ""
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
            "not_started": "Not Started",
            "aligned": "Aligned",
            "move_to_msi": "Move to MSI",
        }.get(stage, stage)


class MoveStageRequest(BaseModel):
    target_stage: str


class UpdateNotesRequest(BaseModel):
    notes: str


class CreateJobRequest(BaseModel):
    job_id: str
    su_string: str = ""
    trench: str = ""


def cet_now() -> str:
    dt = datetime.now(ZoneInfo("Europe/Rome"))
    return f"{dt.day} {dt.strftime('%b %Y, %H:%M')}"
