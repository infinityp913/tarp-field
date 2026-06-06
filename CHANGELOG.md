# Changelog

All notable changes to this project will be documented in this file.

## [1.1.0.1] - 2026-06-06

### Fixed
- **Drag into a non-empty column now works** — dragging a card from Raw Images onto any
  existing card in the Aligned or Moved to MSI column correctly moves the job. Previously,
  once a column had ~4 cards filling the visible area, dropping onto an existing card was
  silently discarded because dnd-kit reports the nearest card's id (not the column's stage
  key) as the drop target. `resolveDropStage()` now resolves the target stage from whichever
  is found: the column droppable or the card under the pointer.
- **Column hover highlight now tracks correctly when dragging over cards** — the column
  background colour updates correctly regardless of whether the cursor is over a card or
  the empty space below the last card.

### Changed
- `onDragOver` handler memoized with `useCallback` to avoid closure recreation on every
  pointer-move event.

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
