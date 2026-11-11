"""UserPromptSubmit: record the turn's time and keep the day's first prompts."""

import os
import sys
from datetime import datetime

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "scripts"))

import activity  # noqa: E402
import hook_runtime  # noqa: E402
import timelog_store as s  # noqa: E402


def run(payload: dict, now=None) -> None:
    state = hook_runtime.load_session(payload)
    s.write_session(activity.on_prompt(state, payload.get("prompt", ""), now or datetime.now()))


if __name__ == "__main__":
    hook_runtime.main(run)
