# Testing

100% test coverage is the key to great vibe coding. Tests let you move fast, trust your instincts, and ship with confidence — without them, vibe coding is just yolo coding. With tests, it's a superpower.

## Python Backend (pytest)

**Framework:** pytest 8.x + pytest-cov + pytest-asyncio

**Run:**
```bash
python3 -m pytest
```

**Test directory:** `tests/`

**Layers:**
- Unit tests: pure parsing logic in `tests/test_filesystem.py` — no disk I/O, fast
- Integration tests: filesystem scan tests using `tmp_path` fixture and config monkeypatching

**Conventions:**
- Use `monkeypatch` + `tmp_path` for any test touching `get_config()` or real directories
- Patch `backend.config._instance` directly with a manually-constructed `Config` object
- Never import secrets or real paths in tests

## Frontend (vitest + @testing-library/react)

**Framework:** vitest 4.x + jsdom + @testing-library/react

**Run:**
```bash
cd frontend && npm test
```

**Test directory:** `frontend/src/__tests__/`

**Layers:**
- Unit tests: offline queue logic in `field-api.test.ts` — mocks `fetch` for network paths
- Component tests (future): use `@testing-library/react`

**Conventions:**
- `localStorage` is polyfilled in `setup.ts` — call `localStorage.clear()` in `beforeEach`
- Use `vi.stubGlobal('fetch', ...)` to mock API calls, `vi.unstubAllGlobals()` after each test
- Assert behavior (what the code does), not implementation (how it does it)

## Test expectations

- When writing new functions, write a corresponding test
- When fixing a bug, write a regression test
- When adding error handling, write a test that triggers the error
- When adding a conditional (if/else), write tests for both paths
- Never commit code that makes existing tests fail
