import io
import json
import struct
import subprocess
import sys
from pathlib import Path

import timelog_host as h
import timelog_store as s

HOST = Path(__file__).resolve().parent.parent / "host" / "timelog_host.py"


def entry(d, note="n"):
    return s.Entry(id=s.new_id(), date=d, project="P", task="T", time_type="Y", hours=1.0, description="d", note=note)


def test_week_returns_entries_and_base():
    s.write_entries([entry("2026-10-10"), entry("2026-10-12"), entry("2026-10-18")])
    base = {"week_start": "2026-10-11", "synced_at": "x", "cells": {}}
    s.write_state({"126795": base})
    r = h.handle({"cmd": "week", "start": "2026-10-11", "timesheet_id": 126795})
    assert r["ok"] is True
    assert [e["date"] for e in r["entries"]] == ["2026-10-12"]
    assert r["base"] == base
    assert r["projects"]["updated"] is None


def test_week_without_base():
    r = h.handle({"cmd": "week", "start": "2026-10-11", "timesheet_id": 1})
    assert r == {"ok": True, "entries": [], "base": None,
                 "projects": {"updated": None, "source": None, "projects": []}}


def test_save_week_replaces_only_that_week():
    s.write_entries([entry("2026-10-10"), entry("2026-10-12")])
    new = {"id": "n1", "date": "2026-10-13", "project": "P", "task": "T", "time_type": "Y",
           "hours": 2, "description": "d", "note": "n"}
    base = {"week_start": "2026-10-11", "synced_at": "x", "cells": {"k": {"hours": 2, "description": "d", "note": "n"}}}
    r = h.handle({"cmd": "save_week", "start": "2026-10-11", "timesheet_id": 126795, "entries": [new], "base": base})
    assert r == {"ok": True}
    assert sorted(e.date for e in s.read_entries()) == ["2026-10-10", "2026-10-13"]
    assert s.read_state()["126795"] == base


def test_save_week_invalid_writes_nothing():
    s.write_entries([entry("2026-10-12")])
    bad = {"id": "n1", "date": "2026-10-13", "project": "P", "task": "T", "time_type": "Y",
           "hours": 2, "description": "d", "note": ""}
    r = h.handle({"cmd": "save_week", "start": "2026-10-11", "timesheet_id": 1, "entries": [bad], "base": {}})
    assert r["ok"] is False and "description and note are required" in r["error"]
    assert [e.date for e in s.read_entries()] == ["2026-10-12"]
    assert s.read_state() == {}


def test_save_projects():
    cat = {"updated": "2026-11-11T20:00:00Z", "source": "extension", "projects": [], "time_type_ids": {}}
    assert h.handle({"cmd": "save_projects", "catalog": cat}) == {"ok": True}
    assert s.read_projects()["updated"] == "2026-11-11T20:00:00Z"
    r = h.handle({"cmd": "week", "start": "2026-10-11", "timesheet_id": 1})
    assert r["projects"] == cat


def test_unknown_command():
    assert h.handle({"cmd": "nope"}) == {"ok": False, "error": "unknown command: nope"}


def test_protocol_round_trip():
    buf = io.BytesIO()
    h.write_message(buf, {"a": "č"})
    raw = buf.getvalue()
    assert struct.unpack("<I", raw[:4])[0] == len(raw) - 4
    buf.seek(0)
    assert h.read_message(buf) == {"a": "č"}


def test_main_over_stdio(timelog_home):
    msg = json.dumps({"cmd": "nope"}).encode()
    r = subprocess.run([sys.executable, str(HOST)], input=struct.pack("<I", len(msg)) + msg, capture_output=True)
    assert r.returncode == 0
    n = struct.unpack("<I", r.stdout[:4])[0]
    assert json.loads(r.stdout[4:4 + n]) == {"ok": False, "error": "unknown command: nope"}
