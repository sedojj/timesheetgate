import json
from datetime import date

import timelog
import timelog_store as s

D = "2026-10-12"


def entry(d, project, hours):
    return s.Entry(id=s.new_id(), date=d, project=project, task="T", time_type="Y",
                   hours=hours, description="d", note="n")




def test_week_table_totals_and_missing():
    entries = [entry(D, "A", 3), entry(D, "B", 5), entry("2026-10-13", "A", 2), entry(D, "A", 0.5)]
    text = timelog.week_table(entries, date(2026, 10, 11), s.read_config())
    lines = text.splitlines()
    assert lines[0] == "Week 2026-10-11 – 2026-10-17"
    row = next(l for l in lines if l.startswith("A / T / Y"))
    assert row.split()[-8:] == [".", "3.5", "2", ".", ".", ".", ".", "5.5"]
    assert next(l for l in lines if l.startswith("Total")).split()[-8:][1] == "8.5"
    assert next(l for l in lines if l.startswith("Missing")).split()[-7:][:3] == ["-", "0", "6"]
    assert lines[-1].startswith("Missing")  # chat reviews belong to the Claude plugin now
