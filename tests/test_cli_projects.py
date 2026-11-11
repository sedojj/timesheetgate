import json

import timelog
import timelog_store as s

CATALOG = {
    "updated": "2026-11-11T17:30:00",
    "source": "test",
    "projects": [
        {"name": "Acme : Impl", "id": "1:2", "time_types": ["Billable"],
         "tasks": [{"name": "9: Kickoff", "id": "9"}, {"name": "13: Config", "id": "13"}]},
        {"name": "Co : Admin", "id": "3:4", "time_types": ["Non-Billable"],
         "tasks": [{"name": "14: Tools", "id": "14"}]},
    ],
}


def run(capsys, *argv):
    code = timelog.main(list(argv))
    out, err = capsys.readouterr()
    return code, out, err


def add(capsys, project, task, time_type):
    return run(capsys, "add", "--project", project, "--task", task, "--time-type", time_type,
               "--hours", "1", "--description", "d", "--note", "n", "--date", "2026-10-12")


def test_add_checked_against_catalog(capsys):
    s.write_projects(CATALOG)
    code, _, err = add(capsys, "Acme : Nope", "9: Kickoff", "Billable")
    assert code == 2 and "unknown project: Acme : Nope" in err
    code, _, err = add(capsys, "Acme : Impl", "14: Tools", "Billable")
    assert code == 2 and "unknown task for Acme : Impl: 14: Tools" in err
    code, _, err = add(capsys, "Acme : Impl", "9: Kickoff", "Non-Billable")
    assert code == 2 and "time type Non-Billable is not allowed for Acme : Impl" in err
    assert s.read_entries() == []
    assert add(capsys, "Acme : Impl", "9: Kickoff", "Billable")[0] == 0


def test_no_catalog_no_check(capsys):
    assert add(capsys, "Anything", "Any task", "Any type")[0] == 0


def test_alias_and_edit_checked_against_catalog(capsys):
    s.write_projects(CATALOG)
    code, _, err = run(capsys, "alias", "set", "x", "--project", "Acme : Impl", "--task", "14: Tools")
    assert code == 2 and "unknown task" in err
    assert s.read_mapping()["aliases"] == {}
    assert run(capsys, "alias", "set", "acme", "--project", "Acme : Impl", "--time-type", "Billable")[0] == 0
    add(capsys, "Acme : Impl", "9: Kickoff", "Billable")
    eid = s.read_entries()[0].id
    assert run(capsys, "edit", eid, "--task", "14: Tools")[0] == 2
    assert run(capsys, "edit", eid, "--task", "13: Config")[0] == 0
