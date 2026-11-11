"""Activity tracking for one Claude chat: session-state updates and client detection.

Pure functions over the session dict, plus read_new_lines() for the transcript.
The hooks own the IO around them. Minutes are a hint only, never billed hours.
"""

from __future__ import annotations

import json
import os
import re
from datetime import datetime

PROMPT_GAP_CAP = 15  # minutes counted from Claude's reply to the user's next prompt
WORK_GAP_CAP = 240  # minutes counted from the user's prompt to Claude's reply
MAX_PROMPTS = 5
TOKEN_SPLIT = re.compile(r"[\s'\"`=;|&()<>]+")


def new_session(session_id: str, cwd: str) -> dict:
    return {
        "session_id": session_id,
        "cwd": cwd,
        "title": "",
        "transcript_offset": 0,
        "last_event": None,
        "current_clients": [],
        "days": {},
    }


# ── client detection ──────────────────────────────────────
def _inside(path: str, root: str) -> str | None:
    """Relative path of `path` below `root`, or None when it is not strictly inside."""
    rel = os.path.relpath(path, root)
    if rel == "." or rel == ".." or rel.startswith(".." + os.sep):
        return None
    return rel


def client_of_path(path: str, cwd: str, mapping: dict) -> str | None:
    p = os.path.expanduser(path)
    if not os.path.isabs(p):
        if not cwd:
            return None
        p = os.path.join(cwd, p)
    p = os.path.realpath(p)  # symlinks: /tmp vs /private/tmp on macOS
    for root in mapping.get("client_roots", []):
        rel = _inside(p, os.path.realpath(root))
        if rel:
            return rel.split(os.sep)[0].lower()
    best = None
    for prefix, alias in mapping.get("folders", {}).items():
        prefix = os.path.realpath(prefix)
        if (p == prefix or _inside(p, prefix)) and (best is None or len(prefix) > len(best[0])):
            best = (prefix, alias)
    return best[1] if best else None


def _strings(value):
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for v in value.values():
            yield from _strings(v)
    elif isinstance(value, list):
        for v in value:
            yield from _strings(v)


def turn_clients(lines: list[str], mapping: dict) -> tuple[set[str], str | None]:
    clients: set[str] = set()
    title = None
    for line in lines:
        try:
            rec = json.loads(line)
        except ValueError:
            continue
        if not isinstance(rec, dict):
            continue
        if rec.get("type") == "ai-title" and rec.get("aiTitle"):
            title = rec["aiTitle"]
        if rec.get("type") != "assistant":
            continue
        content = (rec.get("message") or {}).get("content")
        if not isinstance(content, list):
            continue
        cwd = rec.get("cwd") or ""
        for item in content:
            if not isinstance(item, dict) or item.get("type") != "tool_use":
                continue
            for text in _strings(item.get("input")):
                for token in TOKEN_SPLIT.split(text):
                    if "/" in token:
                        c = client_of_path(token, cwd, mapping)
                        if c:
                            clients.add(c)
    return clients, title


# ── transcript reading ────────────────────────────────────
def read_new_lines(path: str, offset: int) -> tuple[list[str], int]:
    try:
        with open(path, "rb") as f:
            size = f.seek(0, os.SEEK_END)
            if offset > size:
                return [], size
            f.seek(offset)
            data = f.read()
    except FileNotFoundError:
        return [], offset
    end = data.rfind(b"\n") + 1  # complete lines only; a line still being written waits
    lines = data[:end].decode("utf-8", errors="replace").splitlines(keepends=True)
    return lines, offset + end


# ── state updates ─────────────────────────────────────────
def _day(state: dict, now: datetime) -> dict:
    hm = now.strftime("%H:%M")
    day = state["days"].setdefault(
        now.date().isoformat(),
        {"first": hm, "last": hm, "turns": 0, "minutes": 0.0, "clients": {}, "prompts": []},
    )
    day["last"] = hm
    return day


def _gap_minutes(state: dict, kind: str, now: datetime) -> float:
    last = state.get("last_event")
    if not last or last.get("kind") != kind:
        return 0.0
    gap = (now - datetime.fromisoformat(last["at"])).total_seconds() / 60
    return max(gap, 0.0)


def on_prompt(state: dict, prompt: str, now: datetime) -> dict:
    day = _day(state, now)
    day["minutes"] += min(_gap_minutes(state, "stop", now), PROMPT_GAP_CAP)
    text = " ".join((prompt or "").split())[:200]
    if text and not text.startswith("<") and len(day["prompts"]) < MAX_PROMPTS:
        day["prompts"].append(text)
    state["last_event"] = {"kind": "prompt", "at": now.isoformat()}
    return state


def on_stop(state: dict, clients: set[str], title: str | None, cwd_client: str | None, now: datetime) -> dict:
    day = _day(state, now)
    day["turns"] += 1
    day["minutes"] += min(_gap_minutes(state, "prompt", now), WORK_GAP_CAP)
    turn = set(clients) or set(state["current_clients"]) or ({cwd_client} if cwd_client else {"unassigned"})
    for c in turn:
        day["clients"][c] = day["clients"].get(c, 0) + 1
    if turn != {"unassigned"}:
        state["current_clients"] = sorted(turn)
    if title:
        state["title"] = title
    state["last_event"] = {"kind": "stop", "at": now.isoformat()}
    return state
