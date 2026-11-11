# Timelog — design

Goal: stop typing timesheets by hand in NetSuite SuiteProjects Pro (SPP).
Time is captured while working with Claude Code, reviewed at the end of each day,
and filled into SPP by a Chrome extension. The user always checks the SPP page and
clicks Submit by hand.

Audience: internal employees who fill SPP timesheets. Not part of the Rossum SA
extension (that one is also used by clients and partners).

## Components

| Component | What it does |
|---|---|
| Recorder extension (`recorder/`) | Throwaway. Records one manual timesheet session in SPP so we learn how the page works. |
| `timelog` Claude plugin (`plugin/`) | Skill + `SessionStart` / `UserPromptSubmit` / `Stop` hooks + stdlib-only Python CLI. Logs activity per client, runs the daily review, answers "what is missing". |
| Native host (`host/`) | Small Python script. The only bridge between the extension and `~/.timelog/`. |
| Timesheet extension (`extension/`) | Shows the week as an editable grid, reads the SPP timesheet, fills the differences. |

Code lives in this repo. Each user's data lives outside it, in `~/.timelog/`, so the
repo can be shared without anyone's hours in it.

SPP host: `https://*.netsuitesuiteprojectspro.com/`.

## Data (`~/.timelog/`)

SPP model: one timesheet per week. A timesheet has lines; a line is
project + task + time type. Each line has one hour entry per day, and each hour entry
has hours, a description and a note.

- `entries.csv` — one row per hour entry, exact SPP names:
  `id,date,project,task,time_type,hours,description,note`. Description and note are
  both required (SPP rejects a save with an empty note).
  Two rows for the same line and day are merged on sync: hours are summed, descriptions
  and notes are joined.
- `sessions/<session_id>.json` — activity log of one Claude chat, written by the hooks:
  per date the first and last time, number of turns, the clients worked on (with turn
  counts), the first prompts, and a minutes **hint**. Never hours to bill.
- `mapping.json` — aliases ("acme", "nn", a client folder name) → exact SPP
  project / task / time type; `client_roots` (folders whose sub-folders are clients,
  e.g. `~/GitHub/clients`); `folders` (fixed folder → alias, e.g.
  `~/GitHub/other` → the internal non-billable project).
- `reviewed.json` — dates whose daily review is done.
- `projects.json` — copy of the user's SPP projects with their tasks and allowed time
  types. Written by the extension on every timesheet visit (dropdown + `find.pl`); the
  CLI refuses entry and alias names that are not in it. Seeded once from a recording.
- `spp-state.json` — per week: what SPP held at the last sync (lines, hour entries
  with description and note), timesheet status (open / submitted / approved), and the
  time of the last sync. It is the common base for conflict detection.

## Capture (Claude side)

Principle: the hooks record **what** was worked on and **for whom**, never how long to
bill. Billed time is the user's whole effort (context switch, prompting, working the
result with the client), so the user decides the hours in the daily review. Measured
minutes are only a hint.

1. **Hooks log activity, silently.** No questions during work, no tokens.
   - `SessionStart` creates `sessions/<session_id>.json`.
   - `UserPromptSubmit` records the turn's time and keeps the first prompts of each day.
   - `Stop` reads only the transcript lines added since its last run, finds the client
     folders that turn touched (paths under a `client_roots` folder, or a `folders`
     rule), and adds the turn to those clients. A turn that touches none goes to the
     clients of the chat's previous turn. It also stores the chat title.
2. **Direct command.** "log 1.5 h to Acme": the skill resolves the alias (asks once
   if unknown and saves it), drafts description and note from the chat, and writes the
   entry to `entries.csv`.
3. **Daily review** ("review today"). Claude lists each client with its chats, times,
   titles and prompts, plus entries already logged; suggests hours as a starting point
   (at least 0.5 h per client per day); asks about work outside Claude (calls, emails,
   meetings); and picks the task from the project's task list. The user corrects, Claude
   writes the entries with description and note, and the date is marked reviewed.
   Unknown clients are resolved here, once, into an alias.
4. **Week** ("what is missing this week"): hours per line and day from `entries.csv`,
   missing hours against the expected hours per day, and days not yet reviewed.
   After phase 3 also the differences against `spp-state.json`.

Parallel chats on two clients both count in full; the review marks overlapping time so
the user can decide (billing policy is the user's call).

## Bridge: Native Messaging

The extension never touches files. It calls
`chrome.runtime.sendNativeMessage("timelog", {cmd, ...})`. Chrome starts the Python
host, sends one JSON message on stdin, reads one JSON reply on stdout, and the host
exits. Nothing runs in the background.

Commands: `week` (entries + state for a week), `save_entries` (grid edits back to
`entries.csv`), `save_state` (SPP read-back to `spp-state.json`).

Setup, once per user (`install.sh`):
- Writes `timelog.json` into
  `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/`, with the host
  path and the one allowed extension ID.
- The extension ID is fixed by a `key` in `manifest.json`, so it is the same for
  every user who loads it unpacked.
- The host is started through a wrapper with an absolute `python3` path, because
  Chrome started from the Dock has a minimal `PATH`.

## Timesheet extension: sync on click

The extension keeps SPP and `entries.csv` in sync. Nothing is exported by hand.
Writes to SPP happen only when the user clicks **Sync**.

1. **Read.** On an open SPP timesheet, the content script reads the week: lines and
   hour entries with description and note. The popup shows the grid
   (rows = project/task/time type, columns = days) with each cell's state.
2. **Compare** each hour entry three ways: SPP now, `entries.csv`, and the base in
   `spp-state.json` (last sync).
   - Changed only in SPP (typed by hand) → copied to `entries.csv`.
   - Changed only locally → planned write to SPP.
   - Changed on both sides → conflict; the grid shows both values and the user picks.
3. **Sync (click).** Adds missing lines, writes the planned hour entries, and saves the
   timesheet. It never submits. Then it reads SPP again, writes the new base to
   `spp-state.json`, and the local side to `entries.csv` via the host.
4. **Locked weeks.** A submitted or approved timesheet is read-only: local changes for
   that week are shown as conflicts, never written.
5. **History.** Reading past timesheets seeds `mapping.json` with the user's usual
   project / task / time type combinations.

### SPP page facts (from the phase 1 recordings, 2026-11-11)

- **Read-back:** the timesheet page embeds the whole week as JSON in
  `<script type="text/html" id="oa_model_timesheet">`: `rows[].fields[]` holds the
  selected project / task / time type (`type: "popup"`, inside `html`) and one
  `type: "day"` field per day with `date`, `value` (hours), `details.data.description`,
  `details.data.notes`, and `orig_id` (null = not saved yet). `errors` holds the
  server's validation messages after a save; `message` holds "The timesheet was saved.".
- **Week:** Sunday to Saturday. Day columns `_c4` (Sun) … `_c10` (Sat); `_c11` is the
  total column.
- **Line fields:** `_c1_rN` = `customer_id:project_id`, `_c2_rN` = task id,
  `_c3_rN` = time type id (e.g. `7` Non-Billable, `9` Billable). Task options load via
  `POST find.pl action=project_tasks;project=<id>`, allowed time types via
  `action=pt_to_timetype;pt_id=<task>`. The project dropdown only lists recent projects;
  others come from the `cp_dynamic_search` URL in the model.
- **Save** (global "Save" button, and "Close & Save" in the note popup — same request):
  `form.submit()` of `timesheet_main_form` → POST `timesheet.pl` with all
  `_cX_rN` values, `_cX_rN_orig_id` for saved cells,
  `_cX_rN_dialog_description` / `_cX_rN_dialog_notes` / `_cX_rN_dialog_sri` per cell
  (added by page JS at submit), `_ts`, `_total_rows`, `_save_grid=Save`. "OK" in the note
  popup only keeps the values in the page until the next save.
- **Validation is all-or-nothing:** one hour cell without notes rejects the whole save
  ("Notes are required for the … project"); nothing is stored, and the error appears
  in the model's `errors`. So the extension checks description + note on every cell
  before saving, and reads `errors` after.
- **Never used:** "Save & Submit" (sends to the approver; no edits afterwards).

Fill method — **direct POST from the open page**: build the body from the page's own
form plus the model (same fields the page sends), apply the planned changes, POST it,
then parse `oa_model_timesheet` in the response for `errors` and new `orig_id`s, and
reload the tab. Falls back to DOM fill only if this breaks. Still to verify: how more
lines than the page's empty rows are added (`_add_rows`).

## Reuse from the Rossum SA extension

Copied, not imported — the two repos stay independent.

- **Stack:** TypeScript, Preact + `@preact/signals`, esbuild, vitest + jsdom, prettier.
- **`build.js`**, trimmed: git-based versioning (`version` from commit count,
  `version_name` from the hash).
- **`release.yml`** + `docs/chrome-web-store-release.md`, if we publish to the store.
- **Pure core, impure glue:** CSV parsing, the SPP grid parser and the fill plan
  (`plan(entries, sppState) → actions`) are DOM-free and unit-tested; DOM wiring is thin.
- **Content-script lesson:** a MutationObserver sees only added nodes, so `init()` must
  also sweep the current document.
- **Boundary tests:** e.g. a test that the extension can never click Submit.
- **No customer names in the repo:** SPP project names are customer names, so fixtures
  use placeholders (`acme`, `example`).
- **UI:** `DiffView` (SPP vs local), `FilterInput`, `CopyButton`. `Modal` only if needed.

Not reusable: the NetSuite content script — it shows ERP field names, a different
product from SPP.

## Distribution

- Extensions: "Load unpacked" from this repo first. Chrome Web Store private
  (domain-only) listing later, if many colleagues use it.
- Plugin: published in a Claude plugin marketplace; installs the skill, the hook, and
  runs `install.sh` for the native host.

## Phases and risks

1. **Recorder** → user records one manual timesheet → analysis. Biggest risk of the
   project: whether SPP can be read and filled reliably. This phase answers it before
   anything else is built.
2. **`timelog` plugin + data files.** Independent of 1; useful on its own (daily review,
   "what is missing").
3. **Native host + timesheet extension:** read-back first, then grid, then fill.
4. **Package for colleagues.** Windows needs a registry entry instead of the
   `NativeMessagingHosts` folder — only if someone needs it.

## Open questions

- Expected hours per day (for "what is missing"), and the week start day.
- How SPP handles a week split across two months.
