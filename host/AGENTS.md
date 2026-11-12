# Timelog — instructions for AI agents and people

This folder (`~/.timelog/`) holds your timesheet entries for NetSuite SuiteProjects Pro
(SPP). The **Timesheetgate** Chrome extension syncs them into the SPP timesheet when you click
**Sync** in its side panel. It never submits a timesheet.

If you are an AI agent (Gemini CLI, Codex, Claude, …): read this whole file before you
change anything here.

## Files

| File | What it is | Who changes it |
|---|---|---|
| `entries.csv` | Your hours: one row per hour entry | You, an agent, or the CLI |
| `projects.json` | Your SPP projects, their tasks and allowed time types | The extension only |
| `mapping.json` | Short names (aliases) for projects | `timelog alias set` |
| `spp-state.json` | What SPP held at the last Sync | The extension only |
| `claude/` | Claude Code activity log (timelog-claude plugin) | That plugin only |
| `config.json` | Optional settings (`hours_per_day`, `workdays`, `hour_step`) | You |

## Rules for an entry

An hour entry is one day's hours on one timesheet line. A line is project + task + time type.

1. **Exact SPP names.** `project`, `task` and `time_type` must match the text in
   `projects.json` character for character, e.g. project `Example Co : Example Project`,
   task `9: Kickoff and Workshops [Mobilize]`, time type `Billable`. The time type must be
   one listed for that task. Never invent a name; if the project is missing, the list is
   out of date: open a timesheet in SPP with the extension's side panel to refresh it.
2. **Description and note are both required.** SPP rejects the whole save if one hour entry
   lacks either. Keep them short and readable for the client.
3. **Hours in half-hour steps** (0.5, 1, 1.5 …), more than 0 and at most 24. SPP rounds
   other values.
4. **Dates** as `YYYY-MM-DD`. SPP weeks run Sunday to Saturday.
5. **Only write hours the user agreed to.**

## Preferred: use the CLI

The `timelog` command checks every rule above before it writes. It needs only Python 3.
If it is not on the PATH, use its full path: `{{CLI}}`.

```bash
timelog projects                     # SPP projects, tasks, time types (JSON)
timelog alias list                   # short names
timelog add --project "…" --task "…" --time-type Billable \
  --hours 1.5 --description "…" --note "…" --date 2026-11-12
timelog add --alias acme --task "…" --hours 1 --description "…" --note "…"
timelog entries --week 2026-11-12    # one week (JSON, with ids)
timelog entries --date yesterday     # one day
timelog edit <id> --hours 2          # also --note, --description, --task, --date, --alias
timelog delete <id>
timelog week                         # this week: hours per line and day, missing hours
timelog alias set acme --project "…" [--task "…"] [--time-type Billable]
```

`--date` also accepts `today` and `yesterday`. Errors exit with code 2 and say what is wrong.

## Without a shell: edit `entries.csv` directly

Only if you cannot run the CLI. Keep the header and the column order:

```csv
id,date,project,task,time_type,hours,description,note
3f9a1c2e,2026-11-12,Example Co : Example Project,9: Kickoff and Workshops [Mobilize],Billable,1.5,Workshop prep,Agenda and slides
```

- `id`: any unique text; 8 lowercase hex characters like the CLI writes. Never reuse or
  change an existing id.
- Quote fields that contain commas, quotes or line breaks (standard CSV). UTF-8.
- Two rows for the same line and day are fine: Sync adds the hours and joins the texts.
- Do not touch rows of other weeks unless asked.
- Close the file before the user clicks Sync; while the side panel is open it reloads the
  file by itself.

## What Sync does with your changes

- New or changed rows go to SPP; rows you delete are cleared in SPP.
- Hours typed by hand in SPP come back into `entries.csv`.
- If the same entry changed on both sides, the side panel asks which one to keep.
- A row that breaks a rule is shown, not saved; SPP's own errors appear in the panel.

## Never

- Never edit `projects.json`, `spp-state.json` or anything in `claude/`.
- Never submit a timesheet, or tell the user Sync does — it only saves.
