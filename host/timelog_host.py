"""Chrome Native Messaging host for the timelog extension.

Chrome starts it, sends one JSON message (4-byte little-endian length + UTF-8 JSON) on stdin,
reads one reply on stdout, and the process exits. All file formats live in timelog_store.
"""

from __future__ import annotations

import json
import os
import struct
import sys
from datetime import date, timedelta

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "plugin", "scripts"))

import timelog_store as s  # noqa: E402


def _week(start: str) -> tuple[str, str]:
    d = date.fromisoformat(start)
    return d.isoformat(), (d + timedelta(days=6)).isoformat()


def _entry(d: dict) -> s.Entry:
    return s.Entry(**{k: d[k] for k in s.ENTRY_FIELDS if k != "hours"}, hours=float(d["hours"]))


def handle(msg: dict) -> dict:
    try:
        cmd = msg.get("cmd")
        if cmd == "week":
            lo, hi = _week(msg["start"])
            entries = [vars(e) for e in s.read_entries() if lo <= e.date <= hi]
            return {
                "ok": True,
                "entries": entries,
                "base": s.read_state().get(str(msg["timesheet_id"])),
                "projects_updated": s.read_projects()["updated"],
            }
        if cmd == "save_week":
            lo, hi = _week(msg["start"])
            new = [_entry(d) for d in msg["entries"]]
            for e in new:
                s.validate_entry(e)
            keep = [e for e in s.read_entries() if not lo <= e.date <= hi]
            s.write_entries(keep + new)
            state = s.read_state()
            state[str(msg["timesheet_id"])] = msg["base"]
            s.write_state(state)
            return {"ok": True}
        if cmd == "save_projects":
            s.write_projects(msg["catalog"])
            return {"ok": True}
        return {"ok": False, "error": f"unknown command: {cmd}"}
    except Exception as e:  # reply with the error instead of dying silently
        return {"ok": False, "error": str(e)}


def read_message(stream) -> dict:
    (n,) = struct.unpack("<I", stream.read(4))
    return json.loads(stream.read(n).decode("utf-8"))


def write_message(stream, obj) -> None:
    data = json.dumps(obj, ensure_ascii=False).encode("utf-8")
    stream.write(struct.pack("<I", len(data)) + data)
    stream.flush()


if __name__ == "__main__":
    write_message(sys.stdout.buffer, handle(read_message(sys.stdin.buffer)))
