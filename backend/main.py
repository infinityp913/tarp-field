import logging
import sys
import webbrowser
from pathlib import Path

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from backend.config import CREDENTIALS_PATH, LOG_PATH, STATIC_DIR, get_config, init_config
from backend.routers import field
from backend.services import gsheets

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler(str(LOG_PATH), encoding="utf-8"),
    ],
)
logger = logging.getLogger(__name__)

app = FastAPI(title="TARP Field Dashboard", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(field.router)


@app.get("/api/health")
def health():
    return {"status": "ok", "sheets": gsheets.is_available()}


# Serve built React app
if STATIC_DIR.exists():
    app.mount("/assets", StaticFiles(directory=str(STATIC_DIR / "assets")), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def serve_spa(full_path: str):
        index = STATIC_DIR / "index.html"
        if index.exists():
            return FileResponse(str(index))
        return {"error": "Frontend not built. Run: cd frontend && npm run build"}


@app.on_event("startup")
def on_startup():
    cfg = get_config()
    logger.info(f"TARP Field Dashboard starting. Base path: {cfg.base_path}")
    if not CREDENTIALS_PATH.exists():
        logger.warning("credentials.json not found — Google Sheets disabled.")
    else:
        try:
            gsheets.init()
            logger.info("Google Sheets initialized.")
        except Exception as e:
            logger.error(f"Google Sheets init failed: {e}")


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--dev", action="store_true")
    args = parser.parse_args()

    cfg = init_config(dev=args.dev)
    url = f"http://{cfg.host}:{cfg.port}"

    if CREDENTIALS_PATH.exists():
        from backend.config import TOKEN_PATH
        if not TOKEN_PATH.exists():
            print()
            print("=" * 62)
            print("  GOOGLE SHEETS — FIRST-TIME AUTHORISATION REQUIRED")
            print()
            print("  A browser window will open asking you to sign in to")
            print("  Google and grant access to your spreadsheet.")
            print("=" * 62)
            print()
            try:
                gsheets.run_auth_flow()
                print("  Authorisation complete — starting dashboard...\n")
            except Exception as _e:
                print(f"  Authorisation failed: {_e}")
                print("  Dashboard will start without Google Sheets.\n")

    logger.info(f"Starting server at {url}")

    import threading

    def _open_browser():
        import time
        time.sleep(1.5)
        webbrowser.open(url)

    threading.Thread(target=_open_browser, daemon=True).start()

    uvicorn.run(
        "backend.main:app",
        host=cfg.host,
        port=cfg.port,
        reload=False,
        log_level="info",
    )
