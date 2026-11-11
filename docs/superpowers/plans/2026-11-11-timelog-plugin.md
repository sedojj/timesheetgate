# Timelog Claude Plugin Implementation Plan (phase 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Claude Code plugin that silently logs which clients each chat worked on, runs the daily review where the user decides the hours, and writes `entries.csv` for the Chrome extension (phase 3).

**Architecture:** One stdlib-only store module owns every file format. Three hooks (`SessionStart`, `UserPromptSubmit`, `Stop`) keep one activity file per chat; the `Stop` hook reads only new transcript lines to find the client folders a turn touched. A CLI (`timelog.py`) is the only thing the skill calls, so Claude never edits the data files by hand.

**Tech Stack:** Python 3.11+ stdlib only (runtime), pytest (tests), Claude Code plugin format (`.claude-plugin/plugin.json`, `hooks/hooks.json`, `skills/`).

**Spec:** `docs/design.md` — sections "Data", "Capture (Claude side)", "SPP page facts".

## Global Constraints

- Runtime code imports only the Python standard library. Hooks run as `python3 ${CLAUDE_PLUGIN_ROOT}/hooks/<file>.py` and add `plugin/scripts` to `sys.path` from their own location.
- Data directory: `$TIMELOG_HOME` if set, else `~/.timelog/`; created on first write. Tests always set `TIMELOG_HOME` to a tmp dir.
- `entries.csv` columns, in order: `id,date,project,task,time_type,hours,description,note`. UTF-8, `csv` module, atomic replace (`tmp` + `os.replace`). All JSON files are also written atomically.
- `mapping.json`: `{"aliases": {"<name>": {"project": str, "task": str?, "time_type": str?}}, "client_roots": ["<abs dir>"], "folders": {"<abs dir>": "<alias>"}}`. Alias names are stored lower-case and matched case-insensitively. Paths are stored with `~` expanded and without a trailing `/`.
- `config.json` (optional): defaults `{"hours_per_day": 8, "workdays": [0, 1, 2, 3, 4]}` (Python weekday, Monday = 0).
- `reviewed.json`: JSON list of reviewed dates (`YYYY-MM-DD`).
- Dates are local `YYYY-MM-DD`, times local `HH:MM`. CLI `--date` accepts `today`, `yesterday`, or ISO; default `today`. Weeks are Sunday–Saturday (SPP).
- An entry must have non-empty project, task, time_type, description and note, and `0 < hours <= 24`. Error text for an empty description or note: `description and note are required (SPP rejects the save otherwise)`. CLI validation errors exit 2 with the message on stderr.
- Hooks never disturb the session: they print nothing to stdout, always exit 0, and append any exception to `$TIMELOG_HOME/hook-errors.log`.
- Hooks never decide billed hours; `minutes` is a hint only.
- No customer names in the repo: fixtures use `acme`, `example`.
- Git: `other/timelog` is not a prd2 tree; commits are allowed. `.gitignore` excludes `timelog-recording-*.json` (they hold a session id and real project names).

## Review Focus

1. The transcript's last line is still being written when `Stop` runs (no trailing newline) → that line is not consumed; the next `Stop` reads it. (Task 3)
2. The transcript is shorter than the stored offset (file replaced) → offset resets to the file size, nothing is read, no crash. (Task 3)
3. Paths given as `~/…`, relative (`clients/acme/x`), or with `..` (`../clients/acme`) → resolved against the turn's `cwd` before matching. (Task 3)
4. A chat that runs past midnight → each turn and its minutes land on the local date of the event. (Task 3)
5. Descriptions and notes with commas, quotes, newlines and Czech diacritics → unchanged after a round trip through `entries.csv`. (Task 1)

---

## File Structure

```
other/timelog/
  .gitignore
  pyproject.toml                  # pytest config only
  plugin/
    .claude-plugin/plugin.json
    hooks/hooks.json
    hooks/session_start.py  hooks/user_prompt.py  hooks/stop.py
    scripts/timelog_store.py      # data model, all file IO, dates, validation
    scripts/activity.py           # session-state updates and client detection (pure, plus one reader)
    scripts/timelog.py            # CLI used by the skill
    skills/timelog/SKILL.md
  tests/
    test_store.py  test_cli_entries.py  test_activity.py  test_hooks.py  test_cli_day_week.py
```

`pyproject.toml`:
```toml
[tool.pytest.ini_options]
testpaths = ["tests"]
pythonpath = ["plugin/scripts", "plugin/hooks"]
```

CLI tests call `timelog.main(argv: list[str]) -> int` in-process with `capsys`.

Session file `sessions/<session_id>.json` (owned by Task 3, stored by Task 1):
```json
{
  "session_id": "…", "cwd": "/abs", "title": "", "transcript_offset": 0,
  "last_event": {"kind": "prompt|stop", "at": "<ISO local datetime>"} ,
  "current_clients": ["acme"],
  "days": {
    "2026-11-11": {"first": "09:02", "last": "11:40", "turns": 7, "minutes": 64.0,
                   "clients": {"acme": 5, "internal": 2}, "prompts": ["…"]}
  }
}
```
`last_event` is `null` in a new session.

---

### Task 1: Repo scaffold and store module

**Files:**
- Create: `.gitignore`, `pyproject.toml`, `plugin/scripts/timelog_store.py`
- Test: `tests/test_store.py`

**Interfaces:**
- Produces (`timelog_store`):
  - `home() -> Path`
  - `ENTRY_FIELDS: list[str]`
  - `@dataclass Entry: id: str, date: str, project: str, task: str, time_type: str, hours: float, description: str, note: str`
  - `read_entries() -> list[Entry]`, `write_entries(entries: list[Entry]) -> None`
  - `read_mapping() -> dict` (missing → `{"aliases": {}, "client_roots": [], "folders": {}}`), `write_mapping(m: dict) -> None`
  - `read_config() -> dict`
  - `read_reviewed() -> list[str]`, `mark_reviewed(d: str) -> None` (no duplicates, sorted)
  - `read_session(session_id: str) -> dict | None`, `write_session(state: dict) -> None`, `list_sessions() -> list[dict]` (unreadable files skipped)
  - `new_id() -> str` (8 lowercase hex chars)
  - `parse_date(s: str, today: date | None = None) -> date` (`ValueError` on anything else)
  - `week_range(d: date) -> tuple[date, date]` (Sunday, Saturday)
  - `validate_entry(e: Entry) -> None` (`ValueError`)

- [ ] **Step 1:** `git init`; write `.gitignore` (`timelog-recording-*.json`, `__pycache__/`, `.pytest_cache/`) and `pyproject.toml`; commit `chore: scaffold timelog repo` together with `docs/` and `recorder/`.
- [ ] **Step 2: Write failing tests** (fixture sets `TIMELOG_HOME` to `tmp_path`):
  - `test_entries_round_trip_special_chars` (Review Focus 5): `description='a, "b"\nc'`, `note="čeština — ok"` → read back equal; file's first line is `id,date,project,task,time_type,hours,description,note`.
  - `test_missing_files_defaults`: `read_entries() == []`, `read_mapping() == {"aliases": {}, "client_roots": [], "folders": {}}`, `read_config() == {"hours_per_day": 8, "workdays": [0,1,2,3,4]}`, `read_reviewed() == []`, `read_session("x") is None`, `list_sessions() == []`.
  - `test_session_round_trip_and_list`: write two session dicts → `read_session` equal; `list_sessions()` has 2; a garbage file `sessions/bad.json` is skipped.
  - `test_mark_reviewed_dedup`: mark `2026-10-13`, `2026-10-12`, `2026-10-13` → `["2026-10-12", "2026-10-13"]`.
  - `test_week_range_sunday_to_saturday`: `week_range(date(2026,10,14)) == (date(2026,10,11), date(2026,10,17))`; Sunday and Saturday map to their own week.
  - `test_parse_date`: with `today=date(2026,11,11)`: `today`, `yesterday` → 2026-11-10, ISO, `"monday"` raises.
  - `test_validate_entry`: empty note → `ValueError` with the exact Global Constraints text; `hours=0`, `hours=25`, empty task raise.
- [ ] **Step 3:** `python3 -m pytest tests/test_store.py -v` → FAIL (module missing).
- [ ] **Step 4:** Implement `timelog_store.py`.
- [ ] **Step 5:** `python3 -m pytest tests/test_store.py -v` → PASS.
- [ ] **Step 6:** Commit `feat(store): data files, dates and validation`.

### Task 2: CLI — entries and mapping

**Files:**
- Create: `plugin/scripts/timelog.py`
- Test: `tests/test_cli_entries.py`

**Interfaces:**
- Consumes: Task 1.
- Produces:
  - `main(argv: list[str]) -> int`; `__main__` → `sys.exit(main(sys.argv[1:]))`.
  - `resolve(mapping: dict, alias: str | None, project: str | None, task: str | None, time_type: str | None) -> dict` — keys `project, task, time_type`; explicit arguments override the alias; unknown alias → `ValueError("unknown alias: <name>")`.
  - Subcommands:
    - `add [--alias A] [--project P] [--task T] [--time-type Y] --hours H --description D --note N [--date D]` → appends; prints the entry as JSON.
    - `entries [--week D] [--date D]` → JSON list for the Sun–Sat week of `--week`, or one day with `--date` (default: this week), sorted by date, project.
    - `edit ID [--date] [--project] [--task] [--time-type] [--hours] [--description] [--note]` → re-validates; prints JSON.
    - `delete ID`
    - `alias set NAME --project P [--task T] [--time-type Y]`; `alias list` (JSON)
    - `root add PATH` (appends to `client_roots`, no duplicates)
    - `folder set PATH ALIAS` (alias must exist)
  - Unknown id → exit 2, `no entry with id <ID>`.

- [ ] **Step 1: Write failing tests:**
  - `test_add_with_alias_and_override`: `alias set acme --project "Acme : Impl" --time-type Billable`; `add --alias ACME --task Build --hours 2 --description d --note n --date 2026-10-12` → exit 0; stored entry has project `Acme : Impl`, task `Build`, time_type `Billable`, hours `2.0`.
  - `test_add_missing_task_refused`: exit 2, stderr contains `task`, nothing stored.
  - `test_add_empty_note_refused`: `--note ""` → exit 2, stderr contains `description and note are required`.
  - `test_unknown_alias`: exit 2, stderr `unknown alias: nope`.
  - `test_entries_week_and_date_filters`: entries on 10-10, 10-11, 10-17, 10-18 → `--week 2026-10-14` returns 10-11 and 10-17; `--date 2026-10-18` returns one.
  - `test_edit_and_delete`: `edit <id> --hours 3` → 3.0; `delete <id>` → empty; `delete zzz` → exit 2.
  - `test_root_and_folder`: `root add ~/w/clients` twice → one expanded entry; `folder set ~/w/other internal` without alias → exit 2; after `alias set internal …` → stored expanded.
- [ ] **Step 2:** `python3 -m pytest tests/test_cli_entries.py -v` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(cli): entries, aliases, client roots, folders`.

### Task 3: Activity tracking core

**Files:**
- Create: `plugin/scripts/activity.py`
- Test: `tests/test_activity.py`

**Interfaces:**
- Transcript facts (measured on a real transcript, 2026-11-11): JSONL; assistant records `{"type": "assistant", "cwd": …, "message": {"content": [ … {"type": "tool_use", "name": …, "input": {…}} ]}}`; `{"type": "ai-title", "aiTitle": "…"}` carries the chat title (last one wins). Other record types are ignored.
- Produces (`activity`):
  - `new_session(session_id: str, cwd: str) -> dict` — the session schema above, empty `days`.
  - `client_of_path(path: str, cwd: str, mapping: dict) -> str | None` — expand `~`; join a relative path with `cwd`; `os.path.normpath`; if it is inside a `client_roots` dir → the first path segment below that root, lower-cased; else the alias of the longest matching `folders` prefix; else `None`. A path equal to a root itself → `None`.
  - `read_new_lines(path: str, offset: int) -> tuple[list[str], int]` — reads from byte `offset`; returns only complete lines (ending in `\n`) and the offset after the last one; if the file is shorter than `offset`, returns `([], size)`; missing file → `([], offset)`.
  - `turn_clients(lines: list[str], mapping: dict) -> tuple[set[str], str | None]` — for every `tool_use` in assistant records, split every string value of `input` (recursively) on `[\s'"`=;|&()<>]+`; each token containing `/` goes through `client_of_path` with that record's `cwd`; returns the clients found and the last `aiTitle` (or `None`). Malformed lines are skipped.
  - `on_prompt(state: dict, prompt: str, now: datetime) -> dict` — day = `now.date()`; updates `first`/`last`; if `last_event` is a `stop`, adds `min(gap_minutes, 15)` to that day's `minutes`; appends the prompt (whitespace collapsed, first 200 chars) to `prompts` if it does not start with `<` and the day has fewer than 5; sets `last_event` to the prompt.
  - `on_stop(state: dict, clients: set[str], title: str | None, cwd_client: str | None, now: datetime) -> dict` — day = `now.date()`; updates `first`/`last`; `turns += 1`; if `last_event` is a `prompt`, adds `min(gap_minutes, 240)` to `minutes`; turn clients = `clients` or else `state["current_clients"]` or else `{cwd_client}` if set or else `{"unassigned"}`; adds 1 per turn client to `clients`; sets `current_clients` (sorted list) to the turn clients unless they are `{"unassigned"}`; stores `title` if given; sets `last_event`.

- [ ] **Step 1: Write failing tests** (mapping fixture: `client_roots: ["/w/clients"]`, `folders: {"/w/other": "internal"}`):
  - `test_client_of_path` (Review Focus 3): `/w/clients/Acme/x.py` → `acme`; `clients/acme/x` with cwd `/w` → `acme`; `../clients/acme` with cwd `/w/other` → `acme`; `/w/other/tool/a` → `internal`; `/w/clients` → `None`; `/tmp/x` → `None`; `~/x` expands without error.
  - `test_read_new_lines_partial_and_shrunk` (Review Focus 1, 2): file `"a\nb\nc"` from 0 → `(["a\n", "b\n"], 4)`; after appending `"\n"`, from 4 → `(["c\n"], 6)`; from 100 → `([], 6)`; missing file → `([], 7)` for offset 7.
  - `test_turn_clients_from_tool_inputs`: one assistant record with a `Read` input `{"file_path": "/w/clients/acme/a"}` and a `Bash` command `cd /w/clients/example && ls` plus an `ai-title` record → `({"acme", "example"}, "<title>")`; a `"{bad"` line is skipped.
  - `test_minutes_hint_rules`: prompt 10:00, stop 10:50 → `minutes == 50`; next prompt 12:00 → `+15` → `65`; stop 12:02 → `67`.
  - `test_midnight_split` (Review Focus 4): prompt 23:55, stop 00:10 next day → the stop's turn and its 15 minutes land on the second date; the first date has `turns == 0` and the prompt.
  - `test_unassigned_and_carry_over`: stop with no clients and no cwd client → `clients == {"unassigned": 1}`, `current_clients == []`; stop with `{"acme"}`; then a stop with no clients → `acme` count 2.
  - `test_prompts_kept`: `"<ide_opened_file>…"` skipped; `"fix   acme\nexport"` stored as `"fix acme export"`; at most 5 per day.
- [ ] **Step 2:** `python3 -m pytest tests/test_activity.py -v` → FAIL.
- [ ] **Step 3:** Implement `activity.py`.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(activity): session state and client detection`.

### Task 4: Hooks and plugin manifest

**Files:**
- Create: `plugin/hooks/session_start.py`, `plugin/hooks/user_prompt.py`, `plugin/hooks/stop.py`, `plugin/hooks/hooks.json`, `plugin/.claude-plugin/plugin.json`
- Test: `tests/test_hooks.py`

**Interfaces:**
- Consumes: Task 1 store, Task 3 `activity`.
- Hook stdin payloads (Claude Code): all have `session_id`, `transcript_path`, `cwd`; `UserPromptSubmit` adds `prompt`; `Stop` adds `stop_hook_active`.
- Each hook file exposes `run(payload: dict, now: datetime | None = None) -> None` and a `__main__` that reads stdin JSON and calls `run` inside the error guard (Global Constraints).
  - `session_start.run`: create the session file with `new_session` if missing; otherwise leave it (resume).
  - `user_prompt.run`: load (create if missing) → `on_prompt` → save.
  - `stop.run`: load (create if missing) → `read_new_lines(transcript_path, transcript_offset)` → `turn_clients` → `on_stop(..., cwd_client=client_of_path(cwd, cwd, mapping), ...)` → store the new offset → save.
- `hooks.json`: `SessionStart`, `UserPromptSubmit`, `Stop`, each `python3 ${CLAUDE_PLUGIN_ROOT}/hooks/<file>.py` with `"timeout": 10`, same shape as the rossum-sa plugin's `hooks/hooks.json`.
- `plugin.json`: `{"name": "timelog", "description": "Log Claude Code work per client for SuiteProjects Pro timesheets", "version": "0.1.0"}`.

- [ ] **Step 1: Write failing tests:**
  - `test_full_chat_flow`: mapping with root `<tmp>/clients`; transcript file with an assistant `Read` of `<tmp>/clients/acme/a`; `session_start.run` → `user_prompt.run(prompt="hi", now=10:00)` → `stop.run(now=10:20)` → session file: `days[<date>].clients == {"acme": 1}`, `minutes == 20`, `prompts == ["hi"]`, `transcript_offset` = file size.
  - `test_stop_reads_only_new_lines`: append a record touching `example` to the transcript, run another prompt + stop → `clients == {"acme": 1, "example": 1}`.
  - `test_stop_without_session_file`: `stop.run` alone creates the file.
  - `test_hooks_silent_on_error`: run `stop.py` with `subprocess`, stdin `{}` → exit code 0, empty stdout, `hook-errors.log` exists.
  - `test_hooks_json_paths_exist`: every command in `hooks.json` names an existing file after replacing `${CLAUDE_PLUGIN_ROOT}` with `plugin/`.
- [ ] **Step 2:** `python3 -m pytest tests/test_hooks.py -v` → FAIL.
- [ ] **Step 3:** Implement the five files.
- [ ] **Step 4:** `python3 -m pytest -v` → all PASS.
- [ ] **Step 5:** Commit `feat(plugin): hooks and manifest`.

### Task 5: CLI — day summary, reviewed, week report

**Files:**
- Modify: `plugin/scripts/timelog.py`
- Test: `tests/test_cli_day_week.py`

**Interfaces:**
- Produces:
  - `day_summary(sessions: list[dict], entries: list[Entry], mapping: dict, reviewed: list[str], d: str) -> dict` (pure), printed as JSON by `day [--date D]`:
    ```
    {"date", "reviewed": bool,
     "clients": [{"key", "alias": str|null, "project": str|null, "task": str|null, "time_type": str|null,
                  "turns": int,
                  "sessions": [{"session_id", "title", "first", "last", "turns", "client_turns", "minutes", "prompts"}]}],
     "overlaps": [{"sessions": [id1, id2], "from": "HH:MM", "to": "HH:MM"}],
     "entries": [<entries of that date>]}
    ```
    `alias`: the key itself if it is an alias name, else `null`. `clients` sorted by `turns` descending. `overlaps`: every pair of sessions on that date whose `first`–`last` ranges overlap.
  - `reviewed DATE` → `mark_reviewed`.
  - `week_table(entries: list[Entry], sessions: list[dict], reviewed: list[str], start: date, today: date, config: dict) -> str` (pure), printed by `week [--date D]`:
    - `Week <Sun ISO> – <Sat ISO>`; one row per `project / task / time_type` with `Sun … Sat` and a total; a `Total` row; a `Missing` row (`max(0, hours_per_day - day total)` on workdays, `-` otherwise); a last line `Not reviewed: <weekday names>` for days `<= today` that have session activity and are not reviewed (`Not reviewed: none` otherwise).
    - Numbers print without trailing zeros (`2`, `1.5`); empty cells print `.`.

- [ ] **Step 1: Write failing tests:**
  - `test_day_summary_groups_by_client`: two sessions on 2026-10-12, one with `{"acme": 3, "internal": 1}`, one with `{"acme": 2}`; mapping has alias `internal` only → `clients[0]` is `acme` with `turns == 5`, `alias is None`, two sessions; `clients[1]` is `internal` with its alias values.
  - `test_day_summary_overlaps`: sessions 09:00–10:00 and 09:30–11:00 → one overlap `09:30`–`10:00`; a 12:00–13:00 session adds none.
  - `test_reviewed_flag`: after `main(["reviewed", "2026-10-12"])`, `day --date 2026-10-12` prints `"reviewed": true`.
  - `test_week_table_totals_missing_and_not_reviewed`: week of 2026-10-11, `today` 2026-10-14; entries Mon `A/T/Y` 3h and `B/T/Y` 5h, Tue `A/T/Y` 2h, Mon another `A/T/Y` 0.5h; sessions active Mon and Tue; Mon reviewed → `A / T / Y` row Mon `3.5`, Tue `2`, total `5.5`; `Missing` Mon `0`, Tue `6`, Sun `-`; last line `Not reviewed: Tue`.
- [ ] **Step 2:** `python3 -m pytest tests/test_cli_day_week.py -v` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `python3 -m pytest -v` → all PASS.
- [ ] **Step 5:** Commit `feat(cli): day summary, reviewed, week report`.

### Task 6: Skill and end-to-end check

**Files:**
- Create: `plugin/skills/timelog/SKILL.md`

**Interfaces:**
- Consumes: every CLI subcommand. The skill runs `python3 <base directory of this skill>/../../scripts/timelog.py <subcommand>` (the harness prints the base directory when the skill loads).

`SKILL.md`: frontmatter `name: timelog`; the `description` names the triggers: "timesheet", "log time", "log 1.5 h to …", "review today", "daily review", "what is missing this week", "timelog". Sections, a few lines each:
1. **Direct log** ("log 1.5 h to acme"): `alias list`; unknown name → ask once for the exact SPP project / task / time type, `alias set`; draft description and note from the chat; `add`; confirm in one line.
2. **Daily review** ("review today"): `day --date …`. Per client show chats (title, time range, turns share) and entries already logged; mark overlaps. Suggest hours as a starting point — the user bills the whole effort, not Claude's time: at least 0.5 h per client per day, quarter hours, minutes only as a hint. Ask about work outside Claude (calls, emails, meetings). Resolve keys without an alias once (`alias set`). Draft description and note per line. After the user agrees: `add` per line, then `reviewed <date>`, then `week`.
3. **Edits** ("change yesterday's acme to 3 h"): `entries --date …` → id → `edit`.
4. **Week** ("what is missing this week"): `week`; summarise the Missing and Not reviewed lines.
5. **Setup** (first use): `root add` for the clients folder; `folder set` for internal work folders.
6. **Rules:** never edit files in `~/.timelog/` directly; never invent SPP names; never log hours the user has not agreed to.

- [ ] **Step 1:** Write `SKILL.md`.
- [ ] **Step 2: End-to-end check (manual, with the user).** Run `claude --plugin-dir ~/GitHub/other/timelog/plugin`:
  - "set up timelog" → `root add ~/GitHub/clients`, `folder set ~/GitHub/other <internal alias>`.
  - Work a few turns on one client folder → `~/.timelog/sessions/<id>.json` lists that client with turns and minutes.
  - New session: "review today" → the client table appears; agree on one line → `entries --date today` shows it; `day` shows `"reviewed": true`.
  - "what is missing this week" → the week table.
  Expected: each step behaves as described. Then delete the test entry.
- [ ] **Step 3:** Commit `feat(skill): timelog skill`.
