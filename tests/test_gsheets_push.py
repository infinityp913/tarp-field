"""Regression tests for the batched Sheets push (gsheets.push_all).

Bug: the old push called upsert_pgram once per job, and each call issued ~3 read
requests against the Sheets API. A push covering more than ~20 jobs tripped the
60-reads/min/user quota and failed with HTTP 429. push_all must keep the number
of API calls bounded regardless of how many jobs are pushed.
"""
from types import SimpleNamespace

import pytest

from backend.services import gsheets
from backend.models import FieldJob


class _FakeExecutable:
    def __init__(self, counter, name, result=None):
        self._counter = counter
        self._name = name
        self._result = result or {}

    def execute(self, num_retries=0):
        self._counter[self._name] = self._counter.get(self._name, 0) + 1
        return self._result


class _FakeValues:
    def __init__(self, counter):
        self._counter = counter

    def batchUpdate(self, **kwargs):
        return _FakeExecutable(self._counter, "values.batchUpdate")

    def append(self, **kwargs):
        # Pretend the appended rows landed at A100:F<100+n-1>.
        n = len(kwargs["body"]["values"])
        return _FakeExecutable(
            self._counter, "values.append",
            {"updates": {"updatedRange": f"X!A100:F{100 + n - 1}"}},
        )


class _FakeSpreadsheets:
    def __init__(self, counter):
        self._counter = counter

    def values(self):
        return _FakeValues(self._counter)

    def get(self, **kwargs):
        return _FakeExecutable(
            self._counter, "spreadsheets.get",
            {"sheets": [{"properties": {"title": gsheets._FIELD_SHEET, "sheetId": 7}}]},
        )

    def batchUpdate(self, **kwargs):
        return _FakeExecutable(self._counter, "spreadsheets.batchUpdate")


class _FakeService:
    def __init__(self, counter):
        self._counter = counter

    def spreadsheets(self):
        return _FakeSpreadsheets(self._counter)


@pytest.fixture
def fake_sheets(monkeypatch):
    """Wire gsheets to a fake service and count API reads instead of hitting Google."""
    counter: dict[str, int] = {}
    monkeypatch.setattr(gsheets, "is_available", lambda: True)
    monkeypatch.setattr(gsheets, "_ensure_field_sheet", lambda: counter.__setitem__(
        "ensure", counter.get("ensure", 0) + 1))
    monkeypatch.setattr(gsheets, "_get_service", lambda: _FakeService(counter))
    # Existing sheet: header row only, so every job is an append.
    monkeypatch.setattr(gsheets, "_read_range", lambda r: (
        counter.__setitem__("read_range", counter.get("read_range", 0) + 1),
        [["Pgram Number"]],
    )[1])
    monkeypatch.setattr(gsheets, "get_config",
                        lambda: SimpleNamespace(gsheets_spreadsheet_id="sheet123"))
    return counter


def _jobs(n):
    return [FieldJob(job_id=f"Pgram_Job_{i}", su_string="", stage="raw_images") for i in range(n)]


def test_push_all_returns_no_errors(fake_sheets):
    assert gsheets.push_all(_jobs(5)) == []


def test_read_calls_are_bounded_regardless_of_job_count(fake_sheets):
    """The whole point of the fix: reads do not scale with the number of jobs."""
    gsheets.push_all(_jobs(100))
    # One ensure-sheet, one full-range read, one metadata get for the background reset.
    assert fake_sheets.get("read_range", 0) == 1
    assert fake_sheets.get("spreadsheets.get", 0) == 1
    assert fake_sheets.get("ensure", 0) == 1


def test_appends_are_collapsed_into_a_single_call(fake_sheets):
    gsheets.push_all(_jobs(50))
    assert fake_sheets.get("values.append", 0) == 1


def test_existing_rows_updated_in_one_batch(monkeypatch, fake_sheets):
    # Sheet already has rows for jobs 0 and 1.
    monkeypatch.setattr(gsheets, "_read_range", lambda r: [
        ["Pgram Number"], ["0"], ["1"],
    ])
    gsheets.push_all(_jobs(3))
    assert fake_sheets.get("values.batchUpdate", 0) == 1   # rows 0 and 1 updated together
    assert fake_sheets.get("values.append", 0) == 1        # row 2 appended


def test_empty_job_list_makes_no_calls(fake_sheets):
    assert gsheets.push_all([]) == []
    assert fake_sheets == {}


# ---------------------------------------------------------------------------
# _execute — 429 backoff/retry
# ---------------------------------------------------------------------------

class _FakeResp:
    def __init__(self, status):
        self.status = status


class _FakeHttpError(Exception):
    def __init__(self, status):
        self.resp = _FakeResp(status)
        super().__init__(f"HTTP {status}")


class _FlakyRequest:
    """Raises a given exception for the first `fail_times` execute() calls, then succeeds."""
    def __init__(self, exc, fail_times):
        self._exc = exc
        self._fail_times = fail_times
        self.calls = 0

    def execute(self, num_retries=0):
        self.calls += 1
        if self.calls <= self._fail_times:
            raise self._exc
        return {"ok": True}


@pytest.fixture(autouse=True)
def no_real_sleep(monkeypatch):
    """Record backoff waits instead of actually sleeping."""
    waits = []
    monkeypatch.setattr(gsheets.time, "sleep", lambda s: waits.append(s))
    return waits


def test_execute_retries_on_429_then_succeeds(no_real_sleep):
    req = _FlakyRequest(_FakeHttpError(429), fail_times=2)
    assert gsheets._execute(req, "test") == {"ok": True}
    assert req.calls == 3            # two 429s, third succeeds
    assert len(no_real_sleep) == 2   # backed off once per failure


def test_execute_does_not_retry_non_429(no_real_sleep):
    req = _FlakyRequest(_FakeHttpError(500), fail_times=1)
    with pytest.raises(_FakeHttpError):
        gsheets._execute(req, "test")
    assert req.calls == 1            # 500 propagates immediately, no retry
    assert no_real_sleep == []


def test_execute_gives_up_after_exhausting_backoff(no_real_sleep):
    req = _FlakyRequest(_FakeHttpError(429), fail_times=99)  # never recovers
    with pytest.raises(_FakeHttpError):
        gsheets._execute(req, "test")
    # One attempt per backoff delay, plus one final attempt.
    assert req.calls == len(gsheets._BACKOFF_DELAYS) + 1


def test_is_rate_limit_detection():
    assert gsheets._is_rate_limit(_FakeHttpError(429)) is True
    assert gsheets._is_rate_limit(_FakeHttpError(500)) is False
    assert gsheets._is_rate_limit(ValueError("nope")) is False
