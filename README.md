# TARP Field Dashboard

Light-mode kanban dashboard for field archaeologists on the Alienware machine. Tracks photogrammetry jobs through three stages, syncs to Google Sheets so the Lab machine stays up to date.

**Companion repo:** [tarp-photogrammetry-volumetrics-dashboard](https://github.com/infinityp913/tarp-photogrammetry-volumetrics-dashboard) (Lab, dark mode)

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
# Backend
uvicorn backend.main:app --reload --port 8001

# Frontend (separate terminal)
cd frontend && npm run dev

# Build frontend static assets
cd frontend && npm run build
```

On non-Windows, the backend auto-uses `dev_base_path` from `config.yaml`.

---

## First-time setup

1. Get `credentials.json` from Ananth and place it in the repo root (never commit this file).
2. Run the server — a browser window will open for Google OAuth. Sign in with the account that has edit access to the TARP sheet.
3. The token is saved to `token.json` automatically.

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

## Deployment (Alienware)

Double-click `start.bat`. It starts the FastAPI server and opens the browser. The built frontend is served as static files from `backend/static/` — no Node.js needed on the field machine.

---

## Sync behaviour

- **Auto-push every 5 minutes** — writes pgram job data to the Google Sheet automatically.
- **Manual push** — click the Push button in the top-right.
- Only `upsert_pgram()` is called (never `full_sync`) — the Field machine doesn't hold SU volume data, so a full sync would blank the SU sheet.

---

## Field workflow

1. Capture drone footage → create a new job card (New Job button).
2. Run **preliminary low-resolution alignment** in Metashape.
3. Drag the card to **Aligned (Preliminary)**.
4. **Copy** the job folder to the hard disk (for transport to the Lab).
5. Only after the copy is confirmed complete: drag the card to **Moved to MSI**. This renames the folder with `_MOVED_TO_MSI` and moves it to the `Moved to MSI/` directory.

See `FIELD_HOWTO.md` for the full end-user guide.
