# TARP Field Dashboard — How-To Guide

*For field archaeologists using the Alienware machine*

---

## Starting the dashboard

1. Open the `tarp-field` folder on your Desktop.
2. Double-click **`start.bat`**.
3. A black command window will appear — leave it open. The dashboard will open in your browser automatically at **http://127.0.0.1:8001**.

To close the dashboard, close the black command window.

---

## First-time setup

You only need to do this once.

### Step 0 — Get the code onto this machine

**Install Python** (if not already installed):
1. Go to [python.org/downloads](https://www.python.org/downloads/) and download the latest Python 3 installer.
2. Run the installer. On the first screen, **tick "Add Python to PATH"** before clicking Install Now.

**Download the dashboard:**
1. Go to [github.com/infinityp913/tarp-field](https://github.com/infinityp913/tarp-field)
2. Click the green **Code** button → **Download ZIP**
3. Open your Downloads folder, right-click the ZIP → **Extract All…** and extract to your Desktop

**Install dependencies:**
4. Open the extracted folder on your Desktop — it will be called `tarp-field-main`. Rename it to **`tarp-field`** (right-click → Rename)
5. Open the `tarp-field` folder and double-click **`setup.bat`** — a window will appear, wait for **"Setup complete"** then close it

You're ready. Proceed to Step 1.

### Step 1 — Get access to the Google Sheet

Ask **Ananth** to share the [TARP tracking Google Sheet](https://docs.google.com/spreadsheets/d/1r6TMtVEl6wIAAO8FNEXW1qkkFeAxumyyRsFSE4vHIwI/edit?gid=1174152009#gid=1174152009) for the current season with your Google account. You need edit access.

### Step 2 — Get the credentials file

Ask **Ananth** for the `credentials.json` file and place it inside the `tarp-field` folder (the same folder where `start.bat` is). Do not rename the file.

### Step 3 — Authorise the app

The next time you double-click `start.bat`, a browser window will open asking you to sign in to Google and grant access. Use the Google account that Ananth shared the sheet with, then click **Allow**.

That's it. The authorisation is saved — you won't be asked again on this machine.

---

## The board

The board shows all photogrammetry jobs as cards in three columns:

| Column | Meaning |
|---|---|
| **Raw Images** | Job folder created; raw images captured but not yet aligned |
| **Aligned (Preliminary)** | Preliminary low alignment has been run in Metashape |
| **Moved to MSI** | Folder has been copied to the hard disk and handed off to the Lab — when you drag the Pgram card to this column,the folder is renamed automatically with a `_MOVED_TO_MSI` suffix and moved to the Moved to MSI folder on the Field Laptop|

**Moving a job:** click and drag a card to the next column. You can only move one step forward at a time (or any step backward).

---

## Standard workflow per job

### 1. Capture raw images
Images are captured and placed in the job folder inside **Raw Images**. The card appears on the board automatically.

### 2. Run preliminary low alignment in Metashape
Open the job in Metashape and run a preliminary low-quality alignment to verify the capture is usable.

After the alignment runs successfully, **drag the job card from Raw Images to Aligned** on the dashboard. This moves the folder on disk from `Raw Images/` to `Aligned/`.

### 3. Copy the folder to the hard disk
Copy the aligned job folder (from the `Aligned/` directory on the Alienware) to the hard disk that will be taken to the Lab (MSI machine). Do this **before** marking it as Moved to MSI.

### 4. Mark as Moved to MSI
Once the folder is safely on the hard disk, **drag the card from Aligned to Moved to MSI** on the dashboard.

This renames the folder on the Alienware with a `_MOVED_TO_MSI` suffix (e.g. `Pgram_Job_696_SU016_MOVED_TO_MSI`) and moves it to the `Moved to MSI/` directory. The Lab machine uses this suffix to identify which jobs to pick up.

> **Important:** only drag to Moved to MSI after the copy to the hard disk is complete. Once you drag it, the folder is renamed and the Lab considers it handed off.

---

## Adding notes to a job

Click any job card to open it. A notes area will appear — type anything relevant:

- Which SUs are open or closed
- Drone vs. handheld capture
- Anything unusual about the conditions

Click anywhere outside the card when you're done. Notes save automatically and are pushed to Google Sheets within 5 minutes (or immediately if you click **Push to Sheet**).

---

## Push button

The **Push to Sheet** button in the header sends all current job states to Google Sheets immediately. The dashboard also auto-pushes every 5 minutes — you don't usually need to click it. Use it when you want the Lab to see your latest changes right away.

---

## Re-authentication

If a red warning banner appears at the top saying the Google Sheets token was revoked, click **Re-authenticate**. A browser window will open — sign in with the same Google account and click Allow. The connection will restore automatically.

---

## Offline use

If the Alienware loses WiFi:

- A **"queued" badge** appears next to the title — the app keeps working normally
- Any moves you make are saved locally and queued
- When the connection returns, everything syncs automatically

---

## Troubleshooting

| Problem | What to check |
|---|---|
| Dashboard doesn't open | Make sure the black command window is still open. Try going to http://127.0.0.1:8001 manually. |
| No jobs showing on the board | The stage folders may not be found. Check that `Raw Images`, `Aligned`, and `Moved to MSI` folders exist in the configured base path (ask Ananth). |
| "queued" badge — offline | Check WiFi; the app will retry automatically. |
| "Authorisation failed" on first run | Make sure `credentials.json` is in the right place and try again. |
| Red auth banner | Click **Re-authenticate** and sign in again. |
| Notes not appearing on Lab | Click Push to Sheet, or wait for the next 5-minute auto-push. |
| Moved to MSI fails | Check the folder isn't open in Metashape or Explorer. Close it and try again. |

---

## For developers (Mac setup)

```bash
# Clone the repo and navigate to the folder
git clone <repo-url> && cd tarp-field

# Create and activate a virtual environment
python3 -m venv .venv
source .venv/bin/activate  

# Install dependencies
pip install -r requirements.txt

# Run the backend with hot reload (reads dev_base_path and port 8001 from config.yaml)
python3 -m backend.main --dev

# Run the frontend dev server in a second terminal
cd frontend && npm run dev
```

Set `dev_base_path` in `config.yaml` to a local test folder that mirrors the stage-folder structure (`Raw Images/`, `Aligned/`, `Moved to MSI/`).
