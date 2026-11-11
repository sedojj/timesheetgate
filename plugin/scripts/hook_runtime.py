"""Shared entry point for the timelog hooks: never print, never fail the session."""

from __future__ import annotations

import json
import sys
import traceback
from datetime import datetime

import activity
import timelog_store as s


def main(run) -> None:
    try:
        run(json.loads(sys.stdin.read() or "{}"))
    except Exception:
        try:
            with (s.home() / "hook-errors.log").open("a", encoding="utf-8") as f:
                f.write(f"--- {datetime.now().isoformat()} {sys.argv[0]}\n{traceback.format_exc()}")
        except Exception:
            pass
    sys.exit(0)


def load_session(payload: dict) -> dict:
    return s.read_session(payload["session_id"]) or activity.new_session(payload["session_id"], payload.get("cwd", ""))
