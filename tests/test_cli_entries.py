import pytest
import json
import os

import timelog
import timelog_store as s


def run(capsys, *argv):
    code = timelog.main(list(argv))
    out, err = capsys.readouterr()
    return code, out, err


ADD = ["--hours", "2", "--description", "d", "--note", "n", "--date", "2026-10-12"]


def test_add_with_alias_and_override(capsys):
    assert run(capsys, "alias", "set", "acme", "--project", "Acme : Impl", "--time-type", "Billable")[0] == 0
    code, out, _ = run(capsys, "add", "--alias", "ACME", "--task", "Build", *ADD)
    assert code == 0
    e = s.read_entries()[0]
    assert (e.project, e.task, e.time_type, e.hours) == ("Acme : Impl", "Build", "Billable", 2.0)
    assert json.loads(out)["id"] == e.id


def _add(capsys, d):
    run(capsys, "add", "--project", "P", "--task", "T", "--time-type", "Y",
        "--hours", "1", "--description", "d", "--note", "n", "--date", d)


def test_entries_week_and_date_filters(capsys):
    for d in ["2026-10-10", "2026-10-11", "2026-10-17", "2026-10-18"]:
        _add(capsys, d)
    code, out, _ = run(capsys, "entries", "--week", "2026-10-14")
    assert code == 0
    assert [e["date"] for e in json.loads(out)] == ["2026-10-11", "2026-10-17"]
    _, out, _ = run(capsys, "entries", "--date", "2026-10-18")
    assert [e["date"] for e in json.loads(out)] == ["2026-10-18"]


def test_edit_and_delete(capsys):
    _add(capsys, "2026-10-12")
    eid = s.read_entries()[0].id
    assert run(capsys, "edit", eid, "--hours", "3")[0] == 0
    assert s.read_entries()[0].hours == 3.0
    assert run(capsys, "edit", eid, "--note", "")[0] == 2
    assert s.read_entries()[0].note == "n"
    assert run(capsys, "delete", eid)[0] == 0
    assert s.read_entries() == []
    code, _, err = run(capsys, "delete", "zzz")
    assert code == 2 and "no entry with id zzz" in err


def test_edit_with_alias_moves_line(capsys):
    _add(capsys, "2026-10-12")
    run(capsys, "alias", "set", "acme", "--project", "Acme : Impl", "--task", "Build", "--time-type", "Billable")
    eid = s.read_entries()[0].id
    assert run(capsys, "edit", eid, "--alias", "acme")[0] == 0
    e = s.read_entries()[0]
    assert (e.project, e.task, e.time_type) == ("Acme : Impl", "Build", "Billable")


def test_hours_must_follow_spp_step(capsys):
    code, _, err = run(capsys, "add", "--project", "P", "--task", "T", "--time-type", "Y",
                       "--hours", "0.25", "--description", "d", "--note", "n", "--date", "2026-10-12")
    assert code == 2 and "multiple of 0.5" in err
    assert s.read_entries() == []
    _add(capsys, "2026-10-12")
    eid = s.read_entries()[0].id
    assert run(capsys, "edit", eid, "--hours", "1.75")[0] == 2
    assert run(capsys, "edit", eid, "--hours", "1.5")[0] == 0


@pytest.mark.parametrize("args, message", [
    (["--alias", "acme"], "task"),                                        # alias without a task, none given
    (["--alias", "nope", "--task", "T"], "unknown alias: nope"),
    (["--project", "P", "--task", "T", "--time-type", "Y", "--note", ""], "description and note are required"),
    (["--project", "P", "--task", "T", "--time-type", "Y", "--hours", "0.25"], "multiple of 0.5"),
])
def test_add_refusals_write_nothing(capsys, args, message):
    run(capsys, "alias", "set", "acme", "--project", "Acme : Impl", "--time-type", "Billable")
    base = {"--hours": "2", "--description": "d", "--note": "n", "--date": "2026-10-12"}
    flags = dict(zip(args[::2], args[1::2]))
    argv = [x for k, v in {**base, **flags}.items() for x in (k, v)]
    code, _, err = run(capsys, "add", *argv)
    assert code == 2 and message in err
    assert s.read_entries() == []


def test_hour_step_is_configurable(capsys, timelog_home):
    timelog_home.mkdir(parents=True, exist_ok=True)
    (timelog_home / "config.json").write_text('{"hour_step": 0.25}')
    code, _, _ = run(capsys, "add", "--project", "P", "--task", "T", "--time-type", "Y",
                     "--hours", "0.25", "--description", "d", "--note", "n", "--date", "2026-10-12")
    assert code == 0


def test_alias_set_drops_keys_of_the_old_shared_layout(capsys, timelog_home):
    timelog_home.mkdir(parents=True, exist_ok=True)
    (timelog_home / "mapping.json").write_text('{"aliases": {}, "client_roots": ["/w"], "folders": {"/w/o": "x"}}')
    run(capsys, "alias", "set", "acme", "--project", "Acme : Impl")
    assert json.loads((timelog_home / "mapping.json").read_text()) == {"aliases": {"acme": {"project": "Acme : Impl"}}}
