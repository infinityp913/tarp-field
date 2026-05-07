# TARP Field — Architecture

## Stack

| Layer | Technology |
|---|---|
| Backend | Python, FastAPI, uvicorn |
| Frontend | React 18, TypeScript, Vite, dnd-kit |
| Persistence | Filesystem (stage folders) + Google Sheets |
| Packaging | Single process — FastAPI serves both API and built frontend |

---

## How one port serves everything (production)

In production, there is only **one process on port 8001**.

FastAPI handles every incoming request by matching its URL:

- `/api/*` → Python route handlers (business logic, filesystem ops, Sheets writes)
- Anything else → serves `backend/static/index.html`

`backend/static/` is the output of `npm run build`. Vite compiles all the React source into a handful of plain HTML/JS/CSS files and drops them there. FastAPI treats them like any other static file — it just sends bytes to the browser.

The browser loads `index.html`, which loads the compiled JS bundle, which boots React. When React needs data it makes fetch calls to `/api/*` — same host, same port, no cross-origin issues.

```
Browser
  │
  └─► FastAPI :8001
          ├─ /api/field/jobs        → filesystem scan
          ├─ /api/field/jobs/{id}/stage  → folder move + _MOVED_TO_MSI rename
          ├─ /api/field/jobs/{id}/notes  → in-memory notes store
          ├─ /api/field/push        → upsert_pgram() per job to Sheets
          └─ /*                     → backend/static/index.html (React app)
```

---

## Why there are two ports in development

`npm run build` is slow and produces a non-debuggable minified bundle — you don't want to run it after every edit.

**Vite** is a development-only tool that solves this. It runs a second server on **port 5174** that:

1. Serves your React source files directly with **hot module replacement** — edit a `.tsx` file and the browser updates in under a second, no full page reload
2. **Proxies `/api/*` to port 8001** — so the React app at 5174 can reach FastAPI transparently, as if they were the same server

You open **5174** in the browser during development. Port 8001 still needs to be running (it's the API), but you never open it directly.

```
Development

Browser :5174
  │
  └─► Vite dev server :5174
          ├─ *.tsx, *.ts, *.css  → served from source with hot reload
          └─ /api/*              → proxied to FastAPI :8001
                                        │
                                        └─► FastAPI :8001 (API only)
```

In production there is no Vite process — the browser talks directly to FastAPI on 8001 for everything.

---

## Development vs production summary

| | Development | Production (Windows) |
|---|---|---|
| Start command | `python3 -m backend.main --dev` + `npm run dev` | `start.bat` (`python -m backend.main`) |
| Backend port | 8001 | 8001 |
| Frontend served by | Vite :5174 | FastAPI :8001 (built bundle) |
| Open in browser | http://127.0.0.1:5174 | http://127.0.0.1:8001 |
| Hot reload | Yes (Vite) | No |
| Rebuild needed | No | Yes — `npm run build` after frontend changes |

---

## Filesystem model

Jobs live as folders on disk inside stage directories:

```
base_path/
├── Not Started/
│   └── Pgram_Job_696_SU16014/
├── Aligned/
└── Move to MSI/
    └── Pgram_Job_695_SU16013_MOVED_TO_MSI/
```

Dragging a card to a new column **physically moves the folder** on disk. The board is reconstructed by scanning the filesystem on every `/api/field/jobs` request — the filesystem is the source of truth for stage.

`dev_base_path` in `config.yaml` points to a local test folder on Mac; `base_path` is the Windows path used in production.

### Folder naming

Folders must match `Pgram_Job_###` or `Pgram_Job_###_<anything>`. Moving a card to **Move to MSI** appends `_MOVED_TO_MSI` to the folder name. The Lab machine's filesystem scanner strips this suffix before parsing, so it can identify and pick up the job.

---

## Google Sheets model

Sheets is the **sync ledger** between the Field machine and the Lab machine. The Field machine only ever writes — it never reads SU data and never calls `full_sync`.

### Field → Sheets (`/api/field/push`)

Triggered manually via the **↑ Push to Sheet** button. For each job:

1. Reads the existing row for that job (by pgram number) — **read-before-write**
2. Updates only the fields the field machine knows about: trench, notes, Photos checkbox
3. Preserves Lab-controlled columns (Alignment, Overnight, Uploaded to AIR, SUs Closed) unchanged
4. Appends a new row if the job doesn't exist in the sheet yet

The field machine never calls `full_sync` because it has no SU data — doing so would blank the SU Tracking sheet that only the Lab machine populates.

### Notes persistence

Notes are stored **in-memory** in the backend process (a plain dict keyed by `job_id`). They survive as long as the server is running and are included in every push to Sheets. They do not survive a server restart — the authoritative copy is in Sheets after a push.

### Offline queue

If the Alienware loses WiFi, the frontend queues all actions (stage moves, notes, creates) in **localStorage**. When connectivity returns, the queue is replayed in order against the API and then flushed. The board stays fully interactive while offline.

---

## Request flow — drag a card

```
User drags Pgram_Job_696 from "Not Started" to "Aligned"
  │
  ├─ React: optimistic UI update (card moves instantly)
  │
  └─► PUT /api/field/jobs/Pgram_Job_696/stage  { target_stage: "aligned" }
          │
          ├─ filesystem.move_job() → moves folder to Aligned/ on disk
          └─ Returns updated FieldJob
                │
                └─ React: replaces optimistic state with server response
```

Push to Sheet is a separate explicit action — stage moves do **not** auto-push.

---

## Key differences from tarp-lab

| | tarp-lab | tarp-field |
|---|---|---|
| Port | 8000 | 8001 |
| Stages | 5 (full processing pipeline) | 3 (field capture pipeline) |
| Sheets sync | `full_sync` every 5 min (lab is source of truth) | `upsert_pgram` on demand (targeted, read-before-write) |
| SU tracking | Yes (separate tab) | No |
| Offline queue | No | Yes (localStorage) |
| Theme | Dark | Light |
| MSI suffix | Stripped on read | Appended on Move to MSI |

---

## Key files

| File | Purpose |
|---|---|
| `backend/main.py` | FastAPI app, static file serving, startup hooks |
| `backend/config.py` | Reads `config.yaml`, resolves paths |
| `backend/models.py` | Pydantic models, `cet_now()`, stage constants |
| `backend/services/filesystem.py` | Scan, move, create job folders, `_MOVED_TO_MSI` logic |
| `backend/services/gsheets.py` | Auth, `upsert_pgram` with read-before-write, cache |
| `backend/routers/field.py` | All field endpoints (jobs, stage, notes, push) |
| `frontend/src/tokens.ts` | Light mode colour palette |
| `frontend/src/App.tsx` | Root component, board, toolbar, push button, offline detection |
| `frontend/src/api/field.ts` | API calls + localStorage offline queue + replay logic |
| `frontend/vite.config.ts` | Dev proxy (:5174 → :8001), build output path |
| `config.yaml` | Base paths, stage folder names, Sheets ID, host/port |
