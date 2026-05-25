# TARP Field

Kanban-style job tracker for photogrammetry field work. Tracks `Pgram_Job_###` folders
moving between three filesystem stages: Raw Images → Aligned → Moved to MSI.

**Stack:** FastAPI (Python) + React/Vite (TypeScript)

## Testing

**Python backend:** `python3 -m pytest` — tests in `tests/`
**Frontend:** `cd frontend && npm test` — tests in `frontend/src/__tests__/`

See TESTING.md for full conventions.

Test expectations:
- 100% coverage is the goal — tests make vibe coding safe
- When writing new functions, write a corresponding test
- When fixing a bug, write a regression test
- When adding error handling, write a test that triggers the error
- When adding a conditional (if/else, switch), write tests for BOTH paths
- Never commit code that makes existing tests fail

## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool. When in doubt, invoke the skill.

Key routing rules:
- Product ideas/brainstorming → invoke /office-hours
- Strategy/scope → invoke /plan-ceo-review
- Architecture → invoke /plan-eng-review
- Design system/plan review → invoke /design-consultation or /plan-design-review
- Full review pipeline → invoke /autoplan
- Bugs/errors → invoke /investigate
- QA/testing site behavior → invoke /qa or /qa-only
- Code review/diff check → invoke /review
- Visual polish → invoke /design-review
- Ship/deploy/PR → invoke /ship or /land-and-deploy
- Save progress → invoke /context-save
- Resume context → invoke /context-restore
