import json
import os
import re
import subprocess
import sys
from datetime import datetime
from pathlib import Path

import session_start
import stop
import timelog_store as s
import user_prompt

PLUGIN = Path(__file__).resolve().parent.parent / "plugin"


def assistant_line(cwd, path):
    return json.dumps({
        "type": "assistant",
        "cwd": cwd,
        "message": {"content": [{"type": "tool_use", "name": "Read", "input": {"file_path": path}}]},
    }) + "\n"


def setup_chat(tmp_path):
    clients = tmp_path / "clients"
    for name in ("acme", "example"):
        (clients / name).mkdir(parents=True)
    s.write_mapping({"aliases": {}, "client_roots": [str(clients)], "folders": {}})
    transcript = tmp_path / "t.jsonl"
    transcript.write_text(assistant_line(str(tmp_path), str(clients / "acme" / "a")))
    payload = {"session_id": "s1", "transcript_path": str(transcript), "cwd": str(tmp_path)}
    return payload, transcript, clients


def test_full_chat_flow(tmp_path):
    payload, transcript, _ = setup_chat(tmp_path)
    session_start.run(payload)
    user_prompt.run({**payload, "prompt": "hi"}, now=datetime(2026, 10, 12, 10, 0))
    stop.run({**payload, "stop_hook_active": False}, now=datetime(2026, 10, 12, 10, 20))
    st = s.read_session("s1")
    day = st["days"]["2026-10-12"]
    assert day["clients"] == {"acme": 1}
    assert day["minutes"] == 20
    assert day["prompts"] == ["hi"]
    assert st["transcript_offset"] == transcript.stat().st_size


def test_stop_reads_only_new_lines(tmp_path):
    payload, transcript, clients = setup_chat(tmp_path)
    session_start.run(payload)
    stop.run(payload, now=datetime(2026, 10, 12, 10, 20))
    with transcript.open("a") as f:
        f.write(assistant_line(str(tmp_path), str(clients / "example" / "b")))
    user_prompt.run({**payload, "prompt": "next"}, now=datetime(2026, 10, 12, 10, 25))
    stop.run(payload, now=datetime(2026, 10, 12, 10, 30))
    assert s.read_session("s1")["days"]["2026-10-12"]["clients"] == {"acme": 1, "example": 1}


def test_session_start_keeps_existing_file(tmp_path):
    payload, _, _ = setup_chat(tmp_path)
    session_start.run(payload)
    stop.run(payload, now=datetime(2026, 10, 12, 10, 20))
    session_start.run(payload)
    assert s.read_session("s1")["days"]["2026-10-12"]["turns"] == 1


def test_stop_without_session_file(tmp_path):
    payload, _, _ = setup_chat(tmp_path)
    stop.run(payload, now=datetime(2026, 10, 12, 10, 20))
    assert s.read_session("s1")["days"]["2026-10-12"]["turns"] == 1


def test_hooks_silent_on_error(timelog_home):
    for name in ("session_start.py", "user_prompt.py", "stop.py"):
        r = subprocess.run(
            [sys.executable, str(PLUGIN / "hooks" / name)],
            input="{}", capture_output=True, text=True, env={**os.environ},
        )
        assert r.returncode == 0, name
        assert r.stdout == "", name
    assert (timelog_home / "hook-errors.log").exists()


def test_hooks_json_paths_exist():
    config = json.loads((PLUGIN / "hooks" / "hooks.json").read_text())
    events = config["hooks"]
    assert set(events) == {"SessionStart", "UserPromptSubmit", "Stop"}
    for groups in events.values():
        for group in groups:
            for hook in group["hooks"]:
                assert '"${CLAUDE_PLUGIN_ROOT}/' in hook["command"], "quote the plugin root (paths may contain spaces)"
                cmd = hook["command"].replace("${CLAUDE_PLUGIN_ROOT}", str(PLUGIN))
                script = re.search(r'"([^"]+\.py)"', cmd).group(1)
                assert Path(script).exists(), script


def test_plugin_manifest():
    m = json.loads((PLUGIN / ".claude-plugin" / "plugin.json").read_text())
    assert m["name"] == "timelog"
