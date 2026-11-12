"""Data model and all file IO for Timesheetgate's ~/.timelog. Standard library only.

Every file lives in home(): $TIMELOG_HOME, or ~/.timelog.
"""

from __future__ import annotations

import csv
import io
import json
import os
import secrets
from dataclasses import asdict, dataclass
from datetime import date, timedelta
from pathlib import Path

ENTRY_FIELDS = ["id", "date", "project", "task", "time_type", "hours", "description", "note"]
NOTE_REQUIRED = "description and note are required (SPP rejects the save otherwise)"
DEFAULT_CONFIG = {"hours_per_day": 8, "workdays": [0, 1, 2, 3, 4], "hour_step": 0.5}  # SPP rounds to half hours


@dataclass
class Entry:
    id: str
    date: str
    project: str
    task: str
    time_type: str
    hours: float
    description: str
    note: str


def home() -> Path:
    p = Path(os.environ.get("TIMELOG_HOME") or Path.home() / ".timelog")
    p.mkdir(parents=True, exist_ok=True)
    return p


def _write_atomic(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, path)


def _read_json(path: Path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return default


def _write_json(path: Path, data) -> None:
    _write_atomic(path, json.dumps(data, ensure_ascii=False, indent=2) + "\n")


# ── entries.csv ───────────────────────────────────────────
def read_entries() -> list[Entry]:
    path = home() / "entries.csv"
    if not path.exists():
        return []
    with path.open(encoding="utf-8", newline="") as f:
        return [Entry(**{**row, "hours": float(row["hours"])}) for row in csv.DictReader(f)]


def write_entries(entries: list[Entry]) -> None:
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=ENTRY_FIELDS)
    w.writeheader()
    for e in entries:
        w.writerow(asdict(e))
    _write_atomic(home() / "entries.csv", buf.getvalue())


# ── mapping and config ────────────────────────────────────
def read_mapping() -> dict:
    """Aliases only; keys of the old shared layout (client_roots, folders) are dropped on write."""
    return {"aliases": _read_json(home() / "mapping.json", {}).get("aliases", {})}


def write_mapping(m: dict) -> None:
    _write_json(home() / "mapping.json", m)


def read_config() -> dict:
    return {**DEFAULT_CONFIG, **_read_json(home() / "config.json", {})}


# ── projects.json (copy of the SPP project / task list) ──
def read_projects() -> dict:
    return {"updated": None, "source": None, "projects": [], **_read_json(home() / "projects.json", {})}


def write_projects(catalog: dict) -> None:
    _write_json(home() / "projects.json", catalog)


# ── spp-state.json (per timesheet: SPP cells at the last sync) ──
def read_state() -> dict:
    return _read_json(home() / "spp-state.json", {})


def write_state(state: dict) -> None:
    _write_json(home() / "spp-state.json", state)


# ── helpers ───────────────────────────────────────────────
def new_id() -> str:
    return secrets.token_hex(4)


def parse_date(s: str, today: date | None = None) -> date:
    today = today or date.today()
    if s == "today":
        return today
    if s == "yesterday":
        return today - timedelta(days=1)
    return date.fromisoformat(s)


def week_range(d: date) -> tuple[date, date]:
    start = d - timedelta(days=(d.weekday() + 1) % 7)  # Sunday
    return start, start + timedelta(days=6)


def validate_entry(e: Entry) -> None:
    for name in ("project", "task", "time_type"):
        if not str(getattr(e, name) or "").strip():
            raise ValueError(f"{name} is required")
    if not e.description.strip() or not e.note.strip():
        raise ValueError(NOTE_REQUIRED)
    if not 0 < e.hours <= 24:
        raise ValueError("hours must be more than 0 and at most 24")
