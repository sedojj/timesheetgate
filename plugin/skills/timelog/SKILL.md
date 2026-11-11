---
name: timelog
description: Timesheet logging for SuiteProjects Pro (SPP). Use when the user says "timesheet", "log time", "log 1.5 h to <client>", "review today", "daily review", "what is missing this week", "set up timelog", or "timelog" — or asks to change or delete a logged entry.
---

# timelog

The plugin's hooks quietly record which clients each Claude chat worked on, in
`~/.timelog/sessions/`. This skill turns that activity, plus what the user tells you, into
timesheet entries in `~/.timelog/entries.csv`. A Chrome extension later syncs them to SPP.

Run every command as:

```bash
python3 "<base directory of this skill>/../../scripts/timelog.py" <subcommand> ...
```

`--help` on any subcommand shows its flags. Dates take `today`, `yesterday` or `YYYY-MM-DD`.

## Rules

- Never edit files in `~/.timelog/` directly. Use the CLI.
- Never invent SPP names. Project, task and time type must match SPP's text exactly
  (e.g. `Customer : Project`, `9: Kickoff and Workshops [Mobilize]`, `Billable`). Use an
  alias, or ask the user.
- Never write hours the user has not agreed to. The user bills their whole effort — context
  switch, prompting, working the result with the client — not Claude's run time. Measured
  minutes are only a hint.
- Every entry needs a description and a note (SPP rejects a save without them). Draft both
  from the work; keep them short and client-readable. No internal jargon.
- Hours in quarter hours.

## Direct log — "log 1.5 h to acme"

1. `alias list`. Match the name the user used.
2. Unknown name: ask once for the exact SPP project, task and time type, then
   `alias set <name> --project … [--task …] [--time-type …]`.
3. Draft description and note from this chat, then
   `add --alias <name> [--task …] --hours 1.5 --description "…" --note "…" [--date …]`.
4. Confirm in one line: date, project / task, hours, description.

## Daily review — "review today"

1. `day --date <date>` (JSON). Also note `reviewed`.
2. Show one table: per client — chats (title, time range, `client_turns` of `turns`), the
   minutes hint, entries already logged that day. Mention `overlaps` (parallel chats count
   in full for each client; the user decides).
3. Suggest hours per client as a starting point: at least 0.5 h per client per day. Ask
   about work outside Claude: calls, emails, meetings.
4. A key with `"alias": null` (a client folder name or `unassigned`): ask which SPP project
   it is once, then `alias set <key> …` so it resolves from now on. `unassigned` turns are
   assigned per review, not aliased.
5. Pick the task from what the chats did; ask if unsure.
6. After the user agrees: `add` per line, then `reviewed <date>`, then show `week`.

## Edits — "change yesterday's acme to 3 h"

`entries --date <date>` (or `--week <date>`) → find the id → `edit <id> --hours 3`
(also `--alias`, `--task`, `--description`, `--note`, `--date`). `delete <id>` removes one.

## Week — "what is missing this week"

`week [--date <date>]`. Summarise the `Missing` row and the `Not reviewed` line; offer to
review those days.

## Setup — "set up timelog" (first use)

- `root add <folder>` for each folder whose sub-folders are clients
  (e.g. `~/GitHub/clients`).
- `alias set <name> …` for internal, non-billable work, then `folder set <folder> <name>`
  for folders that are always that work (e.g. internal tools).
- Defaults: 8 h per day, Monday–Friday. Other values go in `~/.timelog/config.json`
  (`{"hours_per_day": 8, "workdays": [0, 1, 2, 3, 4]}`, Monday = 0) — tell the user.
