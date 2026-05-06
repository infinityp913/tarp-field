import os
import sys
from pathlib import Path
from typing import Optional

import yaml

ROOT_DIR = Path(__file__).parent.parent
CONFIG_PATH = ROOT_DIR / "config.yaml"
CREDENTIALS_PATH = ROOT_DIR / "credentials.json"
TOKEN_DIR = Path(os.environ.get("APPDATA", Path.home() / "AppData" / "Roaming")) / "tarp-field"
TOKEN_PATH = TOKEN_DIR / "token.json"
LOG_PATH = ROOT_DIR / "tarp-field.log"
STATIC_DIR = ROOT_DIR / "backend" / "static"


def _load_raw() -> dict:
    if not CONFIG_PATH.exists():
        return {}
    with open(CONFIG_PATH) as f:
        return yaml.safe_load(f) or {}


class Config:
    def __init__(self, dev: bool = False):
        raw = _load_raw()
        if not dev and sys.platform != "win32" and raw.get("dev_base_path", ""):
            dev = True
        default_path = raw.get("dev_base_path", "") if dev else raw.get("base_path", "C:\\Users\\Field")
        self.base_path: str = default_path or raw.get("base_path", "C:\\Users\\Field")
        stage_cfg = raw.get("stage_folders", {})
        self.stage_folders = {
            "not_started": stage_cfg.get("not_started", "Not Started"),
            "aligned": stage_cfg.get("aligned", "Aligned"),
            "move_to_msi": stage_cfg.get("move_to_msi", "Move to MSI"),
        }
        self.gsheets_spreadsheet_id: str = raw.get("gsheets_spreadsheet_id", "")
        self.host: str = raw.get("host", "127.0.0.1")
        self.port: int = int(raw.get("port", 8000))

    def has_credentials(self) -> bool:
        return CREDENTIALS_PATH.exists()

    def has_token(self) -> bool:
        return TOKEN_PATH.exists()


_instance: Optional[Config] = None


def init_config(dev: bool = False) -> Config:
    global _instance
    _instance = Config(dev=dev)
    return _instance


def get_config() -> Config:
    global _instance
    if _instance is None:
        _instance = Config()
    return _instance
