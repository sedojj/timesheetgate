import json
from datetime import datetime

import activity as a

MAPPING = {"aliases": {}, "client_roots": ["/w/clients"], "folders": {"/w/other": "internal"}}


def at(day, hm):
    h, m = map(int, hm.split(":"))
    return datetime(2026, 10, day, h, m)


def assistant(cwd, *tool_inputs):
    return json.dumps({
        "type": "assistant",
        "cwd": cwd,
        "message": {"content": [{"type": "tool_use", "name": n, "input": i} for n, i in tool_inputs]},
    }) + "\n"


def test_client_of_path():
    assert a.client_of_path("/w/clients/Acme/x.py", "/w", MAPPING) == "acme"
    assert a.client_of_path("clients/acme/x", "/w", MAPPING) == "acme"
    assert a.client_of_path("../clients/acme", "/w/other", MAPPING) == "acme"
    assert a.client_of_path("/w/other/tool/a", "/w", MAPPING) == "internal"
    assert a.client_of_path("/w/clients", "/w", MAPPING) is None
    assert a.client_of_path("/tmp/x", "/w", MAPPING) is None
    assert a.client_of_path("~/x", "/w", MAPPING) is None


def test_read_new_lines_partial_and_shrunk(tmp_path):
    f = tmp_path / "t.jsonl"
    f.write_text("a\nb\nc")
    assert a.read_new_lines(str(f), 0) == (["a\n", "b\n"], 4)
    with f.open("a") as fh:
        fh.write("\n")
    assert a.read_new_lines(str(f), 4) == (["c\n"], 6)
    assert a.read_new_lines(str(f), 100) == ([], 6)
    assert a.read_new_lines(str(tmp_path / "missing"), 7) == ([], 7)


def test_turn_clients_from_tool_inputs():
    lines = [
        assistant("/w", ("Read", {"file_path": "/w/clients/acme/a"}),
                  ("Bash", {"command": "cd /w/clients/example && ls"})),
        json.dumps({"type": "ai-title", "aiTitle": "old"}) + "\n",
        "{bad\n",
        json.dumps({"type": "ai-title", "aiTitle": "Acme export fix"}) + "\n",
    ]
    assert a.turn_clients(lines, MAPPING) == ({"acme", "example"}, "Acme export fix")


def test_turn_clients_nested_inputs():
    lines = [assistant("/w", ("Edit", {"edits": [{"path": "clients/acme/b"}]}))]
    assert a.turn_clients(lines, MAPPING) == ({"acme"}, None)


def test_minutes_hint_rules():
    st = a.new_session("s", "/w")
    st = a.on_prompt(st, "go", at(12, "10:00"))
    st = a.on_stop(st, set(), None, None, at(12, "10:50"))
    assert st["days"]["2026-10-12"]["minutes"] == 50
    st = a.on_prompt(st, "more", at(12, "12:00"))
    assert st["days"]["2026-10-12"]["minutes"] == 65
    st = a.on_stop(st, set(), None, None, at(12, "12:02"))
    day = st["days"]["2026-10-12"]
    assert day["minutes"] == 67
    assert (day["first"], day["last"], day["turns"]) == ("10:00", "12:02", 2)


def test_midnight_split():
    st = a.new_session("s", "/w")
    st = a.on_prompt(st, "late", at(12, "23:55"))
    st = a.on_stop(st, {"acme"}, None, None, at(13, "00:10"))
    d1, d2 = st["days"]["2026-10-12"], st["days"]["2026-10-13"]
    assert d1["turns"] == 0 and d1["prompts"] == ["late"]
    assert d2["turns"] == 1 and d2["minutes"] == 15 and d2["clients"] == {"acme": 1}


def test_unassigned_and_carry_over():
    st = a.new_session("s", "/w")
    st = a.on_stop(st, set(), None, None, at(12, "10:00"))
    assert st["days"]["2026-10-12"]["clients"] == {"unassigned": 1}
    assert st["current_clients"] == []
    st = a.on_stop(st, {"acme"}, "T", None, at(12, "10:05"))
    st = a.on_stop(st, set(), None, "internal", at(12, "10:10"))
    assert st["days"]["2026-10-12"]["clients"] == {"unassigned": 1, "acme": 2}
    assert st["title"] == "T"


def test_cwd_client_used_when_nothing_else():
    st = a.new_session("s", "/w/other")
    st = a.on_stop(st, set(), None, "internal", at(12, "10:00"))
    assert st["days"]["2026-10-12"]["clients"] == {"internal": 1}
    assert st["current_clients"] == ["internal"]


def test_prompts_kept():
    st = a.new_session("s", "/w")
    st = a.on_prompt(st, "<ide_opened_file>x</ide_opened_file>", at(12, "09:00"))
    st = a.on_prompt(st, "fix   acme\nexport", at(12, "09:01"))
    for i in range(6):
        st = a.on_prompt(st, f"p{i}", at(12, "09:02"))
    prompts = st["days"]["2026-10-12"]["prompts"]
    assert prompts[0] == "fix acme export"
    assert len(prompts) == 5


def test_client_of_path_through_symlink(tmp_path):
    real = tmp_path / "real"
    (real / "clients" / "acme").mkdir(parents=True)
    link = tmp_path / "link"
    link.symlink_to(real)
    mapping = {"client_roots": [str(link / "clients")], "folders": {str(link / "other"): "internal"}}
    assert a.client_of_path(str(real / "clients" / "acme" / "x"), "/", mapping) == "acme"
    assert a.client_of_path(str(real / "other" / "y"), "/", mapping) == "internal"
