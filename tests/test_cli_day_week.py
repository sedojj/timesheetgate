import json
from datetime import date

import timelog
import timelog_store as s

D = "2026-10-12"


def session(sid, first, last, clients, d=D, turns=None, title="", minutes=10.0):
    return {
        "session_id": sid,
        "title": title,
        "days": {d: {"first": first, "last": last, "turns": turns or sum(clients.values()),
                     "minutes": minutes, "clients": clients, "prompts": ["p"]}},
    }


def entry(d, project, hours):
    return s.Entry(id=s.new_id(), date=d, project=project, task="T", time_type="Y",
                   hours=hours, description="d", note="n")


MAPPING = {"aliases": {"internal": {"project": "Co : Admin", "task": "Tools", "time_type": "Non-Billable"}},
           "client_roots": [], "folders": {}}


def test_day_summary_groups_by_client():
    sessions = [
        session("a", "09:00", "10:00", {"acme": 3, "internal": 1}, title="A"),
        session("b", "11:00", "12:00", {"acme": 2}, title="B"),
        session("c", "09:00", "10:00", {"acme": 1}, d="2026-10-13"),
    ]
    out = timelog.day_summary(sessions, [entry(D, "P", 1)], MAPPING, [], D)
    assert out["date"] == D and out["reviewed"] is False
    acme, internal = out["clients"]
    assert (acme["key"], acme["turns"], acme["alias"]) == ("acme", 5, None)
    assert [x["session_id"] for x in acme["sessions"]] == ["a", "b"]
    assert acme["sessions"][0]["client_turns"] == 3 and acme["sessions"][0]["turns"] == 4
    assert (internal["alias"], internal["project"], internal["task"], internal["time_type"]) == (
        "internal", "Co : Admin", "Tools", "Non-Billable")
    assert len(out["entries"]) == 1


def test_day_summary_overlaps():
    sessions = [
        session("a", "09:00", "10:00", {"acme": 1}),
        session("b", "09:30", "11:00", {"example": 1}),
        session("c", "12:00", "13:00", {"acme": 1}),
    ]
    out = timelog.day_summary(sessions, [], MAPPING, [], D)
    assert out["overlaps"] == [{"sessions": ["a", "b"], "from": "09:30", "to": "10:00"}]


def test_reviewed_flag(capsys):
    s.write_session(session("a", "09:00", "10:00", {"acme": 1}))
    assert timelog.main(["reviewed", D]) == 0
    assert timelog.main(["day", "--date", D]) == 0
    out = json.loads(capsys.readouterr().out)
    assert out["reviewed"] is True


def test_week_table_totals_missing_and_not_reviewed():
    entries = [entry(D, "A", 3), entry(D, "B", 5), entry("2026-10-13", "A", 2), entry(D, "A", 0.5)]
    sessions = [session("a", "09:00", "10:00", {"acme": 1}),
                session("b", "09:00", "10:00", {"acme": 1}, d="2026-10-13")]
    text = timelog.week_table(entries, sessions, [D], date(2026, 10, 11), date(2026, 10, 14), s.read_config())
    lines = text.splitlines()
    assert lines[0] == "Week 2026-10-11 – 2026-10-17"
    row = next(l for l in lines if l.startswith("A / T / Y"))
    cells = row.split()[-8:]
    assert cells == [".", "3.5", "2", ".", ".", ".", ".", "5.5"]
    total = next(l for l in lines if l.startswith("Total")).split()[-8:]
    assert total[1] == "8.5"
    missing = next(l for l in lines if l.startswith("Missing")).split()[-7:]
    assert missing[:3] == ["-", "0", "6"]
    assert lines[-1] == "Not reviewed: Tue"


def test_week_table_nothing_to_review():
    text = timelog.week_table([], [], [], date(2026, 10, 11), date(2026, 10, 14), s.read_config())
    assert text.splitlines()[-1] == "Not reviewed: none"
