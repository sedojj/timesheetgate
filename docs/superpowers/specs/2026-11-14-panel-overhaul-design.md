# Side panel overhaul: fill a day from the panel — design

Status: draft for review, 2026-11-14. Prototype screens (throwaway) were reviewed with the
user; this document is the source of truth.

## Intent

Until now the panel was meant for checking and syncing what agents and the `timelog` command
wrote. The user now wants to **fill a day in the panel itself**, with simpler controls than
SPP: the week grouped by project, add lines where they belong, turn calendar meetings into
entries by dragging them, and a Sync that is easy to understand. "Everything is better than
SPP" — but no step may change or remove hours in SPP without the user seeing it.

## Goals

1. **Grouped by project is the only view.** The "Group by project" option goes away (and its
   `localStorage` key `timelog.groupByProject` with it); lines are always shown under their
   project's row.
2. **(+) on each project row** adds a line to that project: the user picks a task and time
   type from `projects.json`. Only lines that project does not have yet are offered (same
   task + time type is never offered twice). A task with one allowed time type has it set
   automatically; a task with two shows two choices ("… · Billable", "… · Non-Billable"),
   each its own line. The panel never writes an empty time type.
3. **+ Add project** (below the grid) does the same for a project that is not in the grid
   yet: pick the project (a filter field over the list), then its line. The list is
   `projects.json`, i.e. what SPP's project dropdown offers (filled by SPP's `cp_popular`
   request). SPP also has a search (🔍, `cp_dynamic_search`) for other assigned projects; the
   panel does **not** use it in this version. A project missing from the list is added once in
   SPP through that search; the next "Sync project list" then picks it up (not verified that
   SPP's dropdown then includes it; the user has only 3 projects today).
4. **One-direction Sync with one question.** The local timelog is what goes to SPP. The
   per-cell conflict choices ("Use SPP" / "Use local", "≠" cells) go away. Instead, when SPP
   has changed since the last Sync — hours that exist only in SPP, or a cell whose SPP value
   differs from what SPP held at the last Sync (e.g. a manager's correction) — Sync shows one
   question for the whole week, listing those cells:
   **Overwrite them with my timelog** or **Keep SPP's (copy them to my timelog)**.
   The question appears only when there is at least one such cell.
5. **Day view.** Clicking a day header shows that day under the grid: its public holiday
   (with **Enter 8 h**, as the header click does today) and its meetings from
   `calendar/<Sunday>.json` (time, title, length, attendee count, recurring).
6. **Drag a meeting** from the day view onto:
   - a **line** → that line's cell for that day;
   - a **project row** → a new line in that project (pick task + time type as in goal 2);
   - **+ Add project** → pick a project not in the grid, then its line.
   **Add** on a meeting does the same without dragging (the box offers the lines).
7. **The drop box.** Every drop opens a small box, pre-filled only from the user's own data:
   hours = the meeting's length **rounded up** to the next `hour_step` (default 0.5: 20 min →
   0.5 h, 40 min → 1 h, 45 min → 1 h), description = the meeting title, note = the note of the
   latest entry on that line in `entries.csv`, any week (empty if the line has none; SPP needs
   one, so the box insists). No separate drop history.
   Enter saves, Esc cancels. Dropping into a cell that already has hours adds the hours and
   joins the descriptions with "; "; the note becomes the one in the box. Each meeting is
   rounded on its own before it is added.
8. **Used meetings.** `calendar/used.json` records each meeting turned into hours:
   `{"<event id>|<YYYY-MM-DD>": {"project", "task", "time_type"}}` (recurring meetings share
   an id, so the date tells instances apart). A meeting counts as used while that cell still
   has hours; used meetings show greyed out with the line they went to, and cannot be
   dragged. Removing the cell's hours frees the meeting again.
   **"Used" is computed when read** (record exists and that cell has hours in `entries.csv`).
   **Changed 2026-11-16 (user's decision):** every write of `entries.csv` (panel or CLI) also
   drops the records whose cell has no hours left, so new hours in an emptied cell do not bring
   an old meeting back.
9. **Agents mark meetings the same way.** `timelog add … --meeting <event id>` (the entry's
   `--date` is the meeting's date) writes the entry and the `used.json` record in one step.
   `host/AGENTS.md` and the Claude plugin's skill say: when an entry comes from a meeting,
   pass `--meeting`. Agents do not apply the "used" rule themselves: a new read-only command
   `timelog meetings --date <day>` (or `--week`) lists that day's meetings from `calendar/`
   with `used: true/false` and the line, computed by the same rule.
   The Claude plugin's skill lives in the separate `timelog-claude` repo
   (`plugin/skills/timelog/SKILL.md`); its update is part of this work, in that repo.

## Non-goals

- No automatic entries: nothing is written without a user click or an agent the user asked.
- No guessing which line a meeting belongs to (that is the plugin's later job, not the panel's).
- No change to `entries.csv` (format, one file for all weeks) or to "never submit".
- No editing of the calendar.

## Anti-goals (a failure even if it works)

- Any change or removal of SPP hours that the user did not see before clicking.
- A second, panel-only rule for what "used" means: the panel and the CLI read and write the
  same `used.json` with the same rule.

## Constraints (from the existing system; see `docs/design.md`)

- SPP takes **one new line per save**; Sync already splits and says "Sync again". Lines added
  in the panel are subject to this.
- A line added with (+) but no hours yet exists only in the panel (an entry needs hours); it
  disappears on reload. This is accepted.
- Hours in steps of `config.json` `hour_step` (default 0.5); description and note required;
  names exactly as in `projects.json`. The panel's store (`src/core/store.ts`) and the CLI
  (`cli/timelog_store.py`) must keep identical files and rules; the cross-language test in
  `extension/test/store.test.ts` covers `entries.csv` and must also cover `used.json`.
- Every write keeps the existing concurrency checks (`expected_ids` / `loaded_ids`).
- The side panel is narrow (~380 px); drag and drop happens inside it (HTML5 drag events),
  so the day view sits under the grid.
- Public repo: no customer names or company hosts in code, tests, fixtures or docs.

## Decided with the user

- Grouped by project as the only view (no toggle); (+) per project; "Add project" for new
  projects, from the dropdown list only.
- A meeting's hours round **up** to the next `hour_step`.
- No duplicate lines (same task + time type) within a project.
- Single allowed time type is set automatically.
- One-direction Sync, but never silent: one week-level question, only when needed.
- Day view by clicking the day header; drag and drop onto line, project row or Add project.
- Drop box with hours / description / note pre-filled from the user's own data; note from the
  last one used on that line, no derived defaults ("don't make too many assumptions").
- `used.json` linked to the cell, freed when the cell has no hours.
- Agents use `timelog add --meeting`.

## My calls (the user saw them in the prototypes but did not decide them explicitly)

- The holiday header click opens the day view instead of writing 8 h directly, so a header
  click always does the same thing; **Enter 8 h** sits in the day view.
- The week-level question also covers cells SPP changed (not only SPP-only hours), using the
  existing last-Sync state (`spp-state.json`), because "a manager's correction must not be
  removed silently".
- Declined meetings (`my_status` "NO") are not shown in the day view; all-day events that are
  not public holidays are not shown either.

## Left to the builder

- Exact visuals (colours, spacing), drag feedback, keyboard handling beyond Enter / Esc.
- How the existing cell editor, PTO form and legend fit around the day view.
- Internal structure of the planner after removing the conflict states.

## Settled after the builder check

- "Used" is computed when read; records go when their cell has no hours (goal 8); agents use
  `timelog meetings` instead of applying the rule themselves (goal 9).
- The drop box's note comes from the line's latest entry in `entries.csv` (goal 7).
- The plugin's skill is updated in the `timelog-claude` repo as part of this work.
