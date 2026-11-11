"""Stop: read the transcript lines added since the last run and credit the turn to its clients."""

import os
import sys
from datetime import datetime

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scripts"))

import activity  # noqa: E402
import hook_runtime  # noqa: E402
import timelog_store as s  # noqa: E402


def run(payload: dict, now=None) -> None:
    state = hook_runtime.load_session(payload)
    mapping = s.read_mapping()
    lines, state["transcript_offset"] = activity.read_new_lines(payload["transcript_path"], state["transcript_offset"])
    clients, title = activity.turn_clients(lines, mapping)
    cwd = payload.get("cwd", "")
    cwd_client = activity.client_of_path(cwd, cwd, mapping) if cwd else None
    s.write_session(activity.on_stop(state, clients, title, cwd_client, now or datetime.now()))


if __name__ == "__main__":
    hook_runtime.main(run)
