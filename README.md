# TARP Field Dashboard

Light-mode kanban dashboard for field archaeologists on the Alienware machine. Tracks photogrammetry jobs through three stages, syncs to Google Sheets so the Lab machine stays up to date.

**Version:** 1.1.0.0

---

## Stack

- **Backend** — Python / FastAPI, Google Sheets API (OAuth2)
- **Frontend** — React + TypeScript (Vite), dnd-kit drag-and-drop
- **Sync** — Google Sheets as the shared ledger between Field and Lab

---

## Stages

| Column | Folder on disk | Meaning |
|---|---|---|
| Raw Images | `Raw Images/` | Job just created; raw drone footage |
| Aligned (Preliminary) | `Aligned/` | Low-res Metashape alignment done |
| Moved to MSI | `Moved to MSI/` | Copied to hard disk; folder renamed with `_MOVED_TO_MSI` suffix |

---

## Running locally (dev)

```bash
# Activate venv (Mac/Linux)
source .venv/bin/activate

# Backend (handles config, auth, and port automatically)
python -m backend.main --dev

# Frontend (separate terminal)
cd frontend && npm run dev

# Build frontend static assets
cd frontend && npm run build
```

`--dev` makes the backend use `dev_base_path` from `config.yaml` instead of the Windows path.

---

## Running the built app (production)

```bash
# 1. Activate venv (Mac/Linux — Windows uses start.bat instead)
source .venv/bin/activate

# 2. Build frontend into backend/static/
cd frontend && npm run build

# 3. Start the backend — serves the built React app as static files
python -m backend.main
```

No separate frontend process needed. The backend opens a browser window automatically and serves the app at `http://127.0.0.1:8001`.

---

## Config (`config.yaml`)

```yaml
base_path: "C:\\Users\\Field"        # Windows path to stage folder root
dev_base_path: "/path/to/test"       # Mac/Linux dev path (auto-used on non-Windows)
stage_folders:
  raw_images:   Raw Images
  aligned:      Aligned
  moved_to_msi: Moved to MSI
gsheets_spreadsheet_id: "<sheet-id>"
host: 127.0.0.1
port: 8001
```

---

## First-time setup

1. Get `credentials.json` from Ananth and place it in the repo root (never commit this file).
2. Double-click `setup.bat` to install Python dependencies (first time only).
3. Double-click `start.bat` — the server starts and a browser window opens automatically.
4. On first run, a Google OAuth prompt will appear. Sign in with the account that has edit access to the TARP sheet. The token is saved to `token.json` and this step won't repeat.

The built frontend is served as static files from `backend/static/` — no Node.js needed on the field machine.

---

## Sync behaviour

- **Auto-push every 5 minutes** — writes pgram job data to the Google Sheet automatically.
- **Manual push** — click the Push button in the top-right.
- Only `upsert_pgram()` is called (never `full_sync`) — the Field machine doesn't hold SU volume data, so a full sync would blank the SU sheet.

---

## Ignored folders warning

Folders inside stage directories whose names don't match `Pgram_Job_###` are surfaced as an amber warning banner at the top of the board. This catches misnamed folders (e.g. `PreSU17001`) that would otherwise silently not appear as job cards. The banner can be dismissed and will reappear if new misnamed folders are detected on refresh.

---

## Field workflow

1. Capture drone footage → create a new job card (New Job button).
2. Run **preliminary low-resolution alignment** in Metashape.
3. Drag the card to **Aligned (Preliminary)**.
4. **Copy** the job folder to the hard disk (for transport to the Lab).
5. Only after the copy is confirmed complete: drag the card to **Moved to MSI**. This renames the folder with `_MOVED_TO_MSI` and moves it to the `Moved to MSI/` directory.

See `FIELD_HOWTO.md` for the full end-user guide.

---

## Testing

```bash
# Backend (pytest)
python3 -m pytest

# Frontend (vitest)
cd frontend && npm test
```

See `TESTING.md` for full conventions.
