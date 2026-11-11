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
    assert r == {"ok": True, "entries": [], "base": None, "stamp": "none", "aliases": {},
                 "projects": {"updated": None, "source": None, "projects": []}}


def test_save_week_replaces_only_that_week():
    old = [entry("2026-10-10"), entry("2026-10-12")]
    s.write_entries(old)
    new = {"id": "n1", "date": "2026-10-13", "project": "P", "task": "T", "time_type": "Y",
           "hours": 2, "description": "d", "note": "n"}
    base = {"week_start": "2026-10-11", "synced_at": "x", "cells": {"k": {"hours": 2, "description": "d", "note": "n"}}}
    r = h.handle({"cmd": "save_week", "start": "2026-10-11", "timesheet_id": 126795, "entries": [new], "base": base,
                  "loaded_ids": [old[1].id]})
    assert r == {"ok": True}
    assert sorted(e.date for e in s.read_entries()) == ["2026-10-10", "2026-10-13"]
    assert s.read_state()["126795"] == base


def test_save_week_invalid_writes_nothing():
    e = entry("2026-10-12")
    s.write_entries([e])
    bad = {"id": "n1", "date": "2026-10-13", "project": "P", "task": "T", "time_type": "Y",
           "hours": 0, "description": "d", "note": "n"}
    r = h.handle({"cmd": "save_week", "start": "2026-10-11", "timesheet_id": 1, "entries": [bad], "base": {},
                  "loaded_ids": [e.id]})
    assert r["ok"] is False and "hours" in r["error"]
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


def test_save_week_refuses_when_entries_changed_meanwhile():
    e = entry("2026-10-12")
    s.write_entries([e])
    later = entry("2026-10-13")  # logged by the CLI while the panel was open
    s.write_entries([e, later])
    r = h.handle({"cmd": "save_week", "start": "2026-10-11", "timesheet_id": 1, "entries": [], "base": {},
                  "loaded_ids": [e.id]})
    assert r == {"ok": False, "error": "entries.csv changed since the panel loaded; reload the panel"}
    assert len(s.read_entries()) == 2


def test_save_week_accepts_imported_cells_without_note():
    imported = {"id": "n1", "date": "2026-10-13", "project": "P", "task": "T", "time_type": "Y",
                "hours": 1.5, "description": "", "note": ""}
    r = h.handle({"cmd": "save_week", "start": "2026-10-11", "timesheet_id": 1, "entries": [imported], "base": {},
                  "loaded_ids": []})
    assert r == {"ok": True}
    assert s.read_entries()[0].note == ""


def test_stamp_changes_when_entries_change():
    first = h.handle({"cmd": "stamp"})
    assert first == {"ok": True, "stamp": "none"}
    s.write_entries([entry("2026-10-12")])
    second = h.handle({"cmd": "stamp"})["stamp"]
    assert second != "none"
    s.write_entries([entry("2026-10-12"), entry("2026-10-13")])
    assert h.handle({"cmd": "stamp"})["stamp"] != second


def test_week_reply_carries_the_stamp():
    s.write_entries([entry("2026-10-12")])
    r = h.handle({"cmd": "week", "start": "2026-10-11", "timesheet_id": 1})
    assert r["stamp"] == h.handle({"cmd": "stamp"})["stamp"]


def test_install_writes_host_manifest_and_agent_guide(tmp_path):
    import os
    home = tmp_path / "home"
    home.mkdir()
    root = HOST.parent.parent
    r = subprocess.run(["sh", str(root / "host" / "install.sh")], capture_output=True, text=True,
                       env={"HOME": str(home), "PATH": os.environ["PATH"]})
    assert r.returncode == 0, r.stderr
    manifest = home / "Library/Application Support/Google/Chrome/NativeMessagingHosts/com.timelog.host.json"
    assert json.loads(manifest.read_text())["name"] == "com.timelog.host"
    guide = (home / ".timelog" / "AGENTS.md").read_text()
    assert str(root / "plugin" / "scripts" / "timelog.py") in guide
    assert "{{CLI}}" not in guide


KEY = {"date": "2026-10-12", "project": "P", "task": "T", "time_type": "Y"}


def test_set_cell_replaces_that_cells_entries():
    a, b, other = entry("2026-10-12"), entry("2026-10-12"), entry("2026-10-13")
    s.write_entries([a, b, other])
    r = h.handle({"cmd": "set_cell", **KEY, "hours": 2.5, "description": "new", "note": "nn",
                  "expected_ids": [a.id, b.id]})
    assert r["ok"] is True
    rows = s.read_entries()
    assert sorted(e.date for e in rows) == ["2026-10-12", "2026-10-13"]
    new = next(e for e in rows if e.date == "2026-10-12")
    assert (new.hours, new.description, new.note) == (2.5, "new", "nn")
    assert new.id == r["entry"]["id"]


def test_set_cell_creates_and_removes():
    r = h.handle({"cmd": "set_cell", **KEY, "hours": 1, "description": "d", "note": "n", "expected_ids": []})
    assert r["ok"] is True
    eid = s.read_entries()[0].id
    r = h.handle({"cmd": "set_cell", **KEY, "hours": None, "description": "", "note": "", "expected_ids": [eid]})
    assert r == {"ok": True, "entry": None}
    assert s.read_entries() == []


def test_set_cell_checks_the_rules():
    for bad, text in [({"note": ""}, "description and note are required"),
                      ({"hours": 0.25}, "multiple of 0.5")]:
        msg = {"cmd": "set_cell", **KEY, "hours": 1, "description": "d", "note": "n", "expected_ids": [], **bad}
        r = h.handle(msg)
        assert r["ok"] is False and text in r["error"]
    s.write_projects({"updated": "x", "source": "extension", "time_type_ids": {},
                      "projects": [{"name": "Q", "id": "1:2", "time_types": ["Y"], "tasks": [{"name": "T", "id": "9"}]}]})
    r = h.handle({"cmd": "set_cell", **KEY, "hours": 1, "description": "d", "note": "n", "expected_ids": []})
    assert r["ok"] is False and "unknown project: P" in r["error"]
    assert s.read_entries() == []


def test_set_cell_refuses_when_the_cell_changed_meanwhile():
    a = entry("2026-10-12")
    s.write_entries([a])
    r = h.handle({"cmd": "set_cell", **KEY, "hours": 1, "description": "d", "note": "n", "expected_ids": []})
    assert r == {"ok": False, "error": "this entry changed in entries.csv meanwhile; check the panel and try again"}
    assert s.read_entries() == [a]


def test_week_reply_carries_the_aliases():
    s.write_mapping({"aliases": {"pto": {"project": "Co : Time Off", "task": "1: PTO", "time_type": "Non-Billable"}},
                     "client_roots": [], "folders": {}})
    r = h.handle({"cmd": "week", "start": "2026-10-11", "timesheet_id": 1})
    assert r["aliases"]["pto"]["task"] == "1: PTO"
