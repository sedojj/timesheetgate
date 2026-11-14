# Side Panel Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fill a day from the side panel: one-direction Sync with one week-level question, lines added per project, a day view with the day's meetings, and meetings dragged onto lines; agents mark meetings the same way through the CLI.

**Architecture:** Pure logic in `extension/src/core/` (planner, meetings, free lines) with vitest tests; the panel's store answers new fields in the existing host messages; new Preact components in their own files keep `App.tsx` from growing. The Python CLI mirrors the meeting rules in `cli/timelog_store.py`; a cross-language test keeps both sides equal.

**Tech Stack:** TypeScript, Preact, vitest + jsdom (extension); Python 3 stdlib, pytest (CLI).

**Spec:** `docs/superpowers/specs/2026-11-14-panel-overhaul-design.md`

## Global Constraints

- The extension never submits (`extension/test/boundary.test.ts` must stay green and unchanged).
- `entries.csv` format and its one-file-for-all-weeks layout do not change.
- `calendar/used.json` = `{"<event id>|<YYYY-MM-DD>": {"project": …, "task": …, "time_type": …}}`, append-only; "used" = record exists **and** `entries.csv` has hours on that line that day.
- Meeting hours = length rounded **up** to `config.json` `hour_step` (default 0.5).
- Day view hides declined meetings (`my_status` "NO"), all-day events and holiday entries.
- Every write keeps `expected_ids` / `loaded_ids` checks; a refused write records nothing in `used.json`.
- Public repo: no customer names, company hosts, personal paths in code, tests or docs.
- TDD; commit only when all suites pass, checking exit codes (not `| grep`):
  `cd extension && npm test; echo $?` · `npx tsc --noEmit` · `npm run build` · `cd .. && python3 -m pytest -q`.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. A meeting from 23:30 to 00:30 local belongs to the day it **starts** (local date), on both sides.
2. A recurring meeting (same id) used on Tuesday stays free on Wednesday.
3. A drop whose new cell total exceeds 24 h is refused; the box shows the reason and the meeting stays free.
4. `entries.csv` changed by the CLI between load and drop (`expected_ids` stale): refusal shown, nothing recorded.
5. First Sync of a week filled in SPP by hand (no base, no local): every SPP cell is "SPP changed"; the question says how many SPP entries "Overwrite" would remove.

Each has a test in the owning task (marked **RF n**).

---

### Task 1: One-direction Sync (planner and panel)

**Files:**
- Modify: `extension/src/core/plan.ts`, `extension/src/core/types.ts` (`CellState`), `extension/src/sidepanel/App.tsx`, `extension/src/sidepanel/sidepanel.css`
- Test: `extension/test/plan.test.ts`, `extension/test/App.test.tsx`

**Interfaces:**
- Produces: `type CellState = "same" | "toSpp" | "sppChanged" | "invalid"`;
  `plan(spp: SppWeek, local: LocalEntry[], base: BaseWeek | null): CellPlan[]` (signature unchanged);
  `resolve(plans: CellPlan[], decision: "overwrite" | "keep" | null, local: LocalEntry[], newId: () => string): { writes: Write[]; localWeek: LocalEntry[] }`.
  `cellKey`, `baseOf`, `round2` unchanged.

Planner rules, in order: duplicate SPP lines → `invalid` (reason "duplicate SPP lines"); `equal(spp, local)` → `same`; `equal(spp, base)` → `toSpp`; else → `sppChanged`; then `toSpp` with local lacking description or note → `invalid`. Locked weeks are not a plan state any more (the panel blocks Sync on `week.locked`).

Panel: Remove: `choices` state, `choosable`, "Use SPP"/"Use local", the `≠` label and the `conflict`/`toLocal` legend lines. `sppChanged` cells show SPP's value with class `sppChanged` (orange) and the legend line "SPP changed since your last Sync — Sync will ask". Totals count local values. Sync with `sppChanged` cells shows a box (class `spp-question`) listing them (`line / date: SPP x h, timelog y h`) and, if any would be removed, "Overwrite removes N entries from SPP"; buttons **Overwrite with my timelog** / **Keep SPP's (copy to my timelog)** run the Sync with that decision; **Cancel** closes it. Sync stays disabled for locked weeks, unsaved SPP typing and `invalid` cells.

- [ ] **Step 1: Planner tests** — rewrite `plan.test.ts` (replace the conflict/locked cases; keep merge, float, week-filter cases):
  - `"local change goes to SPP"`: base = SPP 2, local 3 → `toSpp`; `resolve(…, null)` writes `{value.hours: 3}`.
  - `"SPP change since last Sync is sppChanged"`: base 2, SPP 3, local 2 → `sppChanged`.
  - `"SPP-only hours without base are sppChanged"` (**RF 5**): base null, SPP 8, no local → `sppChanged`.
  - `"SPP deletion since last Sync is sppChanged"`: base 2, SPP none, local 2 → `sppChanged`.
  - `"sppChanged needs a decision"`: `resolve(plans, null, …)` throws `"SPP changed since the last Sync: decide first"`.
  - `"overwrite writes local, also deleting SPP-only hours"`: SPP-only 8 h + overwrite → one write with `value: null`; local unchanged.
  - `"keep copies SPP into the timelog"`: SPP 3 vs local 2 + keep → no write; `localWeek` has one 3 h entry with SPP's description and note; SPP deletion + keep → local entry removed.
  - `"duplicate SPP lines are invalid"`; `"invalid when note missing"`.
- [ ] **Step 2: Panel tests** in `App.test.tsx` (replace "a conflict needs a chosen side" and the conflict-keeping parts of the live-update test):
  - `"no question when SPP did not change"`: Sync writes directly.
  - `"SPP change: Sync asks once; Overwrite writes the timelog"`: base 2, SPP 3, local 2 → Sync shows `.spp-question`; Overwrite → `api.save` called with hours 2.
  - `"Keep copies SPP's value into entries.csv and writes nothing to SPP"`.
  - `"hand-filled week: the question counts removals"` (**RF 5**): no base, SPP 8 h on 2 cells, no local → text contains `"removes 2 entries from SPP"`.
  - `"locked week: Sync disabled, no question"`.
- [ ] **Step 3:** `cd extension && npx vitest run test/plan.test.ts test/App.test.tsx` → FAIL.
- [ ] **Step 4: Implement** the planner (drop `UNRESOLVABLE`, the `choices` parameter, `conflict`/`toLocal`) and the panel changes above.
- [ ] **Step 5:** full suite: `npm test; echo $?` → 0, `npx tsc --noEmit` → 0.
- [ ] **Step 6:** Commit `feat: one-direction Sync with one question when SPP changed`.

### Task 2: Meetings and used.json in the CLI (Python)

**Files:**
- Modify: `cli/timelog_store.py`, `cli/timelog.py`
- Test: `tests/test_meetings.py` (new)

**Interfaces:**
- Produces (Python): `timelog_store.read_used() -> dict`, `record_used(event_id: str, day: str, project: str, task: str, time_type: str) -> None`,
  `round_up(hours: float, step: float) -> float`,
  `meetings_of(calendar: dict | None, used: dict, entries: list[Entry], step: float) -> list[dict]` — each dict:
  `{"id", "date", "start", "end", "title", "hours", "attendees" (count), "recurring", "used": {"project","task","time_type"} | None}`, sorted by `start`.
  CLI: `timelog meetings --date D` / `--week D` (JSON list, same dicts); `timelog add … --meeting <event id>`.
- A meeting's `date` = local date of `start` (`datetime.fromisoformat(...).astimezone().date()`); the calendar file for date D is `calendar/<Sunday of D>.json` (`week_range`).

- [ ] **Step 1: Write `tests/test_meetings.py`** with a helper writing `calendar/2026-11-15.json` (events: a 45-min meeting Tue, a declined one, an all-day one, a holiday entry, a recurring id on Tue and Wed, one 23:30–00:30 local):
  - `test_meetings_lists_only_real_meetings_with_rounded_up_hours`: 45 min → `hours == 1.0`; 20 min → 0.5; declined, all-day and holiday absent.
  - `test_late_meeting_belongs_to_its_start_day` (**RF 1**): the 23:30 meeting has `date == "2026-11-17"`.
  - `test_add_with_meeting_records_it_and_meetings_shows_it_used`: `add … --date 2026-11-17 --meeting m1` → `read_used()["m1|2026-11-17"] == {"project": "P", "task": "T", "time_type": "Y"}`; `meetings --date 2026-11-17` shows `used` with that line.
  - `test_recurring_meeting_used_on_one_day_only` (**RF 2**): id `r1` added on Tue → Wed's `r1` has `used is None`.
  - `test_meeting_is_free_again_when_its_cell_has_no_hours`: delete the entry → `used is None`; the record stays in `used.json`.
  - `test_add_with_unknown_meeting_fails`: exit code 2, message contains `"no meeting r9 on 2026-11-17"`, nothing written.
- [ ] **Step 2:** `python3 -m pytest -q tests/test_meetings.py` → FAIL.
- [ ] **Step 3: Implement** the store functions and the two CLI changes (`add` checks the meeting exists in that day's calendar file before writing).
- [ ] **Step 4:** `python3 -m pytest -q` → all PASS.
- [ ] **Step 5:** Commit `feat(cli): timelog meetings and add --meeting (calendar/used.json)`.

### Task 3: Meetings in the panel's store (TypeScript)

**Files:**
- Create: `extension/src/core/meetings.ts`
- Modify: `extension/src/core/store.ts`
- Test: `extension/test/meetings.test.ts` (new), `extension/test/store.test.ts`

**Interfaces:**
- Consumes: the file formats of Task 2.
- Produces: `type Meeting = { id: string; date: string; start: string; end: string; title: string; hours: number; attendees: number; recurring: boolean; used: { project: string; task: string; time_type: string } | null }`;
  `roundUp(hours: number, step: number): number`;
  `meetingsOf(calendar: { events: any[] } | null, used: Record<string, any>, entries: LocalEntry[], step: number): Meeting[]`.
  `week` reply gains `meetings: Meeting[]` (the week's), `last_notes: Record<string, string>` (key `project␟task␟time_type`, note of the latest-dated entry on that line in **all** of `entries.csv`, empty notes skipped), `hour_step: number`.
  `set_cell` accepts optional `meeting: { id: string; date: string }`; after a successful write with hours it appends the `used.json` record.

- [ ] **Step 1: Tests.** `meetings.test.ts`: the same cases as Task 2's first four, against `meetingsOf` (**RF 1**, **RF 2**). `store.test.ts`:
  - `"week reply carries the week's meetings, last notes and hour step"`.
  - `"set_cell with a meeting records it; a refused set_cell records nothing"` (**RF 4**: stale `expected_ids` → `ok: false`, no `calendar/used.json`).
  - Extend the Python cross-language test: the panel writes an entry with `meeting`, then `python3 cli/timelog.py meetings --date 2026-11-17` (with `TIMELOG_HOME`) reports `used` for it.
- [ ] **Step 2:** `npx vitest run test/meetings.test.ts test/store.test.ts` → FAIL.
- [ ] **Step 3: Implement** `meetings.ts` and the store changes (read `calendar/used.json` with `readJson`; write it with `writeJson`).
- [ ] **Step 4:** same command → PASS.
- [ ] **Step 5:** Commit `feat(store): meetings, last notes and used meetings in the panel's store`.

### Task 4: Grouped view only; (+) and Add project

**Files:**
- Create: `extension/src/core/lines.ts`, `extension/src/sidepanel/LinePicker.tsx`
- Modify: `extension/src/sidepanel/App.tsx`, `extension/src/sidepanel/sidepanel.css`
- Test: `extension/test/lines.test.ts` (new), `extension/test/App.test.tsx`

**Interfaces:**
- Produces: `type LineRef = { project: string; task: string; timeType: string }`;
  `freeLines(catalog: Catalog, project: string, taken: LineRef[]): { task: string; timeType: string }[]` (catalog order; a task's `time_types`, falling back to the project's; never an empty time type);
  `<LinePicker catalog project={string | null} taken onPick={(l: LineRef) => void} onCancel />` — with `project` null it first shows a filter field + list of catalog projects not in the grid.
  Panel state `extraLines: LineRef[]`: added lines without hours, rendered as empty rows; kept across automatic reloads, gone when the panel reopens.

Remove the "Group by project" checkbox and `GROUP_KEY`; rows always grouped. Each group row gets a `+` button; **+ Add project** sits under the grid.

- [ ] **Step 1: Tests.** `lines.test.ts`: `"offers only lines the project does not have"`, `"a task with two time types gives two choices; one type gives one"`, `"never an empty time type"`. `App.test.tsx`: `"rows are always grouped by project"` (replaces the toggle test); `"(+) adds an empty line to that project and it survives an automatic reload"`; `"Add project offers only projects not in the grid, filtered by typing"`; `"an added line can be filled like any cell"` (click its cell → Editor → `set_cell` with that line).
- [ ] **Step 2:** `npx vitest run test/lines.test.ts test/App.test.tsx` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** full suite + `tsc` → 0.
- [ ] **Step 5:** Commit `feat(extension): grouped view only; add lines per project and new projects`.

### Task 5: Day view

**Files:**
- Create: `extension/src/sidepanel/DayView.tsx`
- Modify: `extension/src/sidepanel/App.tsx`, `extension/src/sidepanel/sidepanel.css`
- Test: `extension/test/App.test.tsx`

**Interfaces:**
- Consumes: Task 3 `Meeting`, the `week` reply's `meetings`; existing `Holiday`, `enterHoliday`.
- Produces: `<DayView date holiday={Holiday | undefined} meetings={Meeting[]} holidayTip onEnterHoliday onAdd={(m: Meeting) => void} onDragStart={(m: Meeting) => void} />`; panel state `dayOpen: string | null`.

Clicking a day header (every day, not only holidays) opens the day view under the grid; clicking it again closes it; the day view, the cell editor and the PTO form exclude each other. Holiday: "🇨🇿🎉 Public holiday" row with **Enter 8 h** (the behaviour `enterHoliday` has today). Meetings: time range, title, `hours` h, attendee count, "recurring"; used ones greyed with "on <task> ✓", without Add, not draggable.

- [ ] **Step 1: Tests** (update the two holiday tests: the header click opens the day; **Enter 8 h** writes):
  - `"clicking a day header shows that day's meetings; again closes it"`.
  - `"used meetings are greyed with their line and cannot be added"`.
  - `"holiday: the header opens the day; Enter 8 h writes the holiday line"` (same `set_cell` as today's test).
  - `"day view, cell editor and PTO form exclude each other"`.
- [ ] **Step 2:** `npx vitest run test/App.test.tsx` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** full suite + `tsc` → 0.
- [ ] **Step 5:** Commit `feat(extension): day view with the day's meetings and holiday`.

### Task 6: Drag a meeting; the drop box

**Files:**
- Create: `extension/src/sidepanel/DropBox.tsx`
- Modify: `extension/src/sidepanel/App.tsx`, `extension/src/sidepanel/sidepanel.css`
- Test: `extension/test/App.test.tsx`

**Interfaces:**
- Consumes: Task 3 (`last_notes`, `hour_step` for validating typed hours, `set_cell` with `meeting`), Task 4 (`LinePicker`, `LineRef`, `extraLines`), Task 5 (`DayView` `onAdd` / `onDragStart`).
- Produces: `<DropBox meeting target={{ line: LineRef } | { project: string } | { newProject: true }} catalog taken lastNotes hourStep onSave={(line: LineRef, hours: number, description: string, note: string) => void} onCancel />`.

The dragged meeting is kept in a ref set by `onDragStart` (jsdom has no `DataTransfer`); drop targets (`dragover` prevents default, `drop` opens the box): line rows, project group rows, **+ Add project**. **Add** in the day view opens the box with the first line selected. The box: line select (or `LinePicker` for a project/new project), hours (`meeting.hours`, already rounded up by `meetingsOf`), description (title), note (`lastNotes[line]` or empty, required); Enter saves, Esc cancels. Save: existing cell → `hours = round2(existing + new)`, description `existing; title`, note from the box; `set_cell` with `expected_ids` and `meeting: {id, date}`; a refusal shows in the box and keeps it open.

- [ ] **Step 1: Tests** (fire `dragstart` on the meeting, then `dragover` + `drop` on the target as plain `Event`s):
  - `"dropping on a line opens the box pre-filled; Enter writes the cell and marks the meeting"`: 45-min meeting → hours field `"1"`, description = title, note from `last_notes`; `set_cell` has `meeting: {id, date}`.
  - `"dropping into a cell with hours adds them and joins the descriptions"`: existing 2 h "a" + 1 h "B" → `hours: 3`, `description: "a; B"`.
  - `"the note is required: an empty note keeps the box open"`.
  - `"dropping on a project row asks for the new line first"`; `"dropping on Add project asks for the project, then the line"`.
  - `"over 24 h is refused: the box shows why, the meeting stays free"` (**RF 3**).
  - `"Esc closes the box without writing"`.
- [ ] **Step 2:** `npx vitest run test/App.test.tsx` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** full suite + `tsc` + `npm run build` → 0.
- [ ] **Step 5:** Commit `feat(extension): drag meetings onto lines; the drop box`.

### Task 7: Docs and the plugin's skill

**Files:**
- Modify: `README.md` (Daily use: grouped view, +, Add project, day view, drag, the Sync question; data table row `calendar/used.json`), `host/AGENTS.md` (files row `calendar/used.json`; CLI block: `timelog meetings --date …`, `add … --meeting <id>`; rule "pass `--meeting` for entries from meetings; use `timelog meetings`, never apply the used rule yourself"), `docs/design.md` (Sync section: one direction + the week question replacing per-cell conflicts; the used rule).
- Modify (the separate `timelog-claude` repo, branch `feat/meetings`): `plugin/skills/timelog/SKILL.md` — review uses `timelog meetings --date <day>`, skips `used`, logs with `--meeting`.

- [ ] **Step 1:** Write the docs; check `grep -n "Group by project\|Use SPP\|Use local\|conflict" README.md host/AGENTS.md` returns nothing stale.
- [ ] **Step 2:** All suites green in both repos (`python3 -m pytest -q` in `timelog-claude` too).
- [ ] **Step 3:** Scan the branch diff for customer names, hosts and personal paths; commit in each repo (`docs: panel overhaul — day view, drag, one-direction Sync`; plugin: `feat: review uses timelog meetings and --meeting`).
