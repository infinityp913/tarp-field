# Changelog

All notable changes to this project will be documented in this file.

## [1.1.0.0] - 2026-05-24

### Added
- **Ignored folders warning banner** — the board now surfaces folders inside stage directories
  whose names don't match `Pgram_Job_###`. Users see an amber banner listing misnamed folders
  (e.g. `PreSU17001`) instead of silently missing them from the board. The banner re-appears
  if new misnamed folders are detected on refresh, and can be dismissed until then.
- **`GET /api/field/ignored-folders` endpoint** — backend scans Raw Images, Aligned, and
  Moved to MSI directories (including one level inside `Trench XXX` subfolders) and returns
  a typed list of non-conforming folder names with their stage and parent context.
- **Test framework** — pytest (backend) and vitest (frontend) with 31 tests covering
  the new filesystem parsing logic, endpoint integration, and offline queue behaviour.
  See `TESTING.md` for conventions.
- **`CLAUDE.md`** and **`TESTING.md`** — project documentation and test runbook.

### Changed
- `fetchIgnoredFolders` is offline-safe: returns an empty list on network errors so the
  warning banner never blocks the main board.
- `folderSetKey` uses collision-resistant JSON serialization to decide when to re-show a
  dismissed banner after a folder set change.
- `IgnoredFoldersBanner` extracted as a standalone component for independent testability.

### Fixed
- Trench subdirectory `iterdir()` now wrapped in `try/except OSError` — a locked or
  permission-restricted subfolder no longer crashes the entire ignored-folders scan.
- `GET /api/field/ignored-folders` now declares `response_model=list[IgnoredFolder]`
  for schema validation and OpenAPI documentation.
- Banner uses stable `stage|parent|name` React keys instead of array indices to prevent
  incorrect DOM reuse when folder list order changes.
