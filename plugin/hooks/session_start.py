"""SessionStart: create this chat's activity file (kept as is on resume)."""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scripts"))

import activity  # noqa: E402
import hook_runtime  # noqa: E402
import timelog_store as s  # noqa: E402


def run(payload: dict, now=None) -> None:
    if s.read_session(payload["session_id"]) is None:
        s.write_session(activity.new_session(payload["session_id"], payload.get("cwd", "")))


if __name__ == "__main__":
    hook_runtime.main(run)
