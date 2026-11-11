# Timesheet Extension + Native Host Implementation Plan (phase 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Chrome extension whose side panel shows the open SPP week next to `entries.csv`, and on one **Sync** click writes the differences into SPP (never submitting), copies hand-typed SPP hours back to `entries.csv`, and keeps `projects.json` current. Usable before mandatory submission starts on 2026-11-20.

**Architecture:** Pure TypeScript core (parse the page model, three-way plan, build the save body, build the catalog) with thin glue: an isolated content script reads the DOM and POSTs the save; a MAIN-world script calls the page's own `project_tasks` / `pt_to_timetype`; the side panel (Preact) talks to the content script and, through Native Messaging, to a Python host that reads and writes `~/.timelog/` with the plugin's `timelog_store`.

**Tech Stack:** TypeScript, esbuild, Preact, vitest + jsdom (extension); Python 3 stdlib + pytest (host).

**Spec:** `docs/design.md` — "Bridge: Native Messaging", "Timesheet extension: sync on click", "SPP page facts", "Data".

## Global Constraints

- SPP host: `https://*.netsuitesuiteprojectspro.com`. Content scripts match `https://*.netsuitesuiteprojectspro.com/timesheet.pl*`.
- The extension **never submits**: no source file may contain `save_grid_submit` or `Save & Submit`, and no save body may contain a key with `submit` in it. Enforced by a test.
- Save = `POST` to `timesheet_main_form`'s `action`, `Content-Type: application/x-www-form-urlencoded`, `credentials: "same-origin"`, body = the form's own fields plus the dialog fields (see Task 4), `_form_has_changed=1`, `_save_grid=Save`.
- Page model: `JSON.parse(document.getElementById("oa_model_timesheet").textContent)`. Locked week = no `#timesheet_savebutton` on the page.
- SPP validation is all-or-nothing: every cell with hours needs a non-empty description and note.
- Cell key = `[project, task, timeType, date].join("\u001f")`, names exactly as SPP shows them.
- Native host name: `com.timelog.host`. One JSON message in, one JSON reply out (4-byte little-endian length prefix). Replies are `{"ok": true, ...}` or `{"ok": false, "error": "<text>"}`.
- The host imports `plugin/scripts/timelog_store.py`; it never duplicates file formats.
- Extension ID is fixed by `"key"` in `manifest.json`; the ID is stored in `extension/EXTENSION_ID` and used by `host/install.sh`.
- No customer names in the repo: fixtures are generated from the recording with names replaced by `Acme …` / `Example …`; the recording itself stays git-ignored.
- Never commit anything from `~/.timelog/` or the recordings.

## Review Focus

1. A local entry and an SPP cell for the same key with equal hours but different note text → `conflict` (description/note are part of the value), not `same`. (Task 3)
2. Two local entries for the same key and day → merged (hours summed, texts joined with `"; "`), and after Sync they are left untouched when SPP already matches the merged value. (Task 3)
3. A local entry deleted after a sync (base has it, SPP unchanged) → SPP cell cleared (`""`), not re-imported. (Task 3)
4. A locked week (submitted/approved) → every planned SPP write becomes `conflict` with reason `locked`; Sync is disabled. (Tasks 3, 7)
5. A new line whose project or task is missing from the catalog → save is refused before any POST, with the missing name in the message. (Task 4)

---

## File Structure

```
other/timelog/
  extension/
    package.json  tsconfig.json  build.js  vitest.config.mjs  manifest.json  EXTENSION_ID
    src/core/types.ts         # shared types (below)
    src/core/parseModel.ts    # page model → SppWeek
    src/core/plan.ts          # three-way plan + resolve
    src/core/saveBody.ts      # form fields + writes → POST body
    src/core/catalog.ts       # page lists → projects.json shape
    src/page.ts               # MAIN world: project_tasks / pt_to_timetype bridge
    src/content.ts            # isolated: read week, load catalog, save
    src/background.ts         # side panel opens on action click
    src/sidepanel/index.tsx  src/sidepanel/App.tsx  src/sidepanel/sidepanel.html  src/sidepanel/sidepanel.css
    test/fixtures/model.json  test/fixtures/form-fields.json
    test/*.test.ts(x)
  host/
    timelog_host.py  install.sh
  tests/test_host.py
```

`src/core/types.ts` (Task 2 creates it; every later task uses these names):
```ts
export type Cell = { hours: number; description: string; note: string };
export type SppCell = Cell & { col: number; origId: number | null };
export type SppLine = {
  row: number; projectId: string; project: string; taskId: string; task: string;
  timeTypeId: string; timeType: string; cells: Record<string, SppCell>; // by ISO date
};
export type SppWeek = {
  timesheetId: number; days: string[]; /* 7 ISO dates, Sun..Sat */ dayCols: Record<string, number>;
  lines: SppLine[]; emptyRow: number | null; locked: boolean; message: string | null; errors: string[];
};
export type LocalEntry = {
  id: string; date: string; project: string; task: string; time_type: string;
  hours: number; description: string; note: string;
};
export type BaseWeek = { week_start: string; synced_at: string; cells: Record<string, Cell> };
export type CellState = "same" | "toSpp" | "toLocal" | "conflict" | "invalid";
export type CellPlan = {
  key: string; project: string; task: string; timeType: string; date: string;
  state: CellState; reason?: string; spp: Cell | null; local: Cell | null; base: Cell | null;
};
export type Write = { project: string; task: string; timeType: string; date: string; value: Cell | null };
export type Catalog = {
  updated: string; source: "extension";
  projects: { name: string; id: string; time_types: string[];
              tasks: { name: string; id: string; time_types: string[] }[] }[];
  time_type_ids: Record<string, string>;
};
```

---

### Task 1: Extension scaffold, fixed ID, fixtures, never-submit test

**Files:**
- Create: `extension/package.json`, `tsconfig.json`, `build.js`, `vitest.config.mjs`, `manifest.json`, `EXTENSION_ID`, `test/fixtures/model.json`, `test/fixtures/form-fields.json`, `test/boundary.test.ts`
- Modify: `.gitignore` (add `extension/node_modules/`, `extension/dist/`)

**Interfaces:**
- `npm run build` → `extension/dist/` with `manifest.json`, `content.js`, `page.js`, `background.js`, `sidepanel/{index.js,sidepanel.html,sidepanel.css}`. `build.js` copies the manifest and sets `version` = `0.<git commit count>`; `--watch` for dev.
- `npm test` → vitest (jsdom environment).
- `manifest.json`: MV3; `key`; `permissions: ["nativeMessaging", "sidePanel", "storage"]`; `host_permissions: ["https://*.netsuitesuiteprojectspro.com/*"]`; `background.service_worker: "background.js"`; `side_panel.default_path: "sidepanel/sidepanel.html"`; `action: {}`; content scripts on `https://*.netsuitesuiteprojectspro.com/timesheet.pl*`: `page.js` with `"world": "MAIN"`, `"run_at": "document_idle"`; `content.js` (isolated), `"run_at": "document_idle"`.
- Fixed ID: generate once with
  `openssl genrsa 2048 2>/dev/null | openssl rsa -pubout -outform DER 2>/dev/null > /tmp/pub.der`;
  `key` = `base64 < /tmp/pub.der | tr -d '\n'`; ID = first 32 hex chars of `shasum -a 256 /tmp/pub.der`, each `0-9a-f` mapped to `a-p`. Write the ID to `EXTENSION_ID`. Delete `/tmp/pub.der`; no private key is kept (unpacked loading needs none).
- Fixtures: a one-off script (not committed, kept in `/tmp`) reads `timelog-recording-2026-11-11-17-31.json`, takes the last snapshot's `oa_model_timesheet` and `forms[0].fields`, and replaces every customer/project/task name, description, note, `uid` and `r=` token with placeholders (`Acme Corp : Acme Impl`, `Example Co : Admin`, `9: Kickoff`, `desc`, `note`, `UID`, `TOKEN`). Ids, dates, columns, rows stay as recorded.

- [ ] **Step 1:** Write `test/boundary.test.ts`: `test_no_submit_in_sources` reads every file under `src/` and asserts none contains `save_grid_submit` or `Save & Submit`. (Its `saveBody` half is added in Task 4.)
- [ ] **Step 2:** `cd extension && npm test` → FAIL (no `src/` yet → the test asserts `src/` has at least one file).
- [ ] **Step 3:** Create the scaffold files, an empty `src/background.ts` that calls `chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })`, the key and ID, and the fixtures.
- [ ] **Step 4:** `npm test` → PASS; `npm run build` → `dist/manifest.json` exists and has the `key`; `grep -ril "<customer names>\|<session id>" test/fixtures` → no output.
- [ ] **Step 5:** Commit `feat(extension): scaffold, fixed ID, sanitized fixtures`.

### Task 2: Parse the page model

**Files:**
- Create: `extension/src/core/types.ts` (above), `extension/src/core/parseModel.ts`
- Test: `extension/test/parseModel.test.ts`

**Interfaces:**
- Produces `parseModel(model: any, hasSaveButton: boolean): SppWeek`:
  - `days`/`dayCols`: from the first row's `type: "day"` fields (date → column number from `name` `_c<col>_r<row>`); `days` sorted.
  - `lines`: one per `rows[]` entry; `projectId`/`project`, `taskId`/`task`, `timeTypeId`/`timeType` from the `selected="selected"` `<option>` in the three `type: "popup"` fields' `html` (HTML entities decoded); `row` from the field names; `cells` only for day fields whose `value` is not `""`/`null`: `hours = Number(value)`, `description`/`note` from `details.data.description`/`notes` (null → `""`), `col`, `origId = orig_id`.
  - `emptyRow`: the row number of `empty_rows[0]`, or `null`.
  - `locked = !hasSaveButton`; `message = model.message?.text ?? null`; `errors = model.errors ?? []`; `timesheetId = model.timesheet_id`.

- [ ] **Step 1: Write failing tests** against `test/fixtures/model.json`:
  - `parses days Sun..Sat`: `days[0] === "2026-10-11"`, `days[6] === "2026-10-17"`, `dayCols["2026-10-11"] === 4`, `dayCols["2026-10-17"] === 10`.
  - `parses lines and cells`: 4 lines; line row 2 has 4 cells; its `2026-10-13` cell is `{hours: 2, col: 6, origId: 2142304, description: "desc", note: "note"}` (placeholders); `projectId` matches `/^\d+:\d+$/`.
  - `empty row and flags`: `emptyRow === 5`; `parseModel(m, false).locked === true`; `errors` is `[]`; `message` is the saved text.
  - `entities decoded`: a model whose option text is `A &amp; B` → `project === "A & B"`.
- [ ] **Step 2:** `npm test -- parseModel` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm test -- parseModel` → PASS.
- [ ] **Step 5:** Commit `feat(core): parse the SPP timesheet model`.

### Task 3: Three-way plan and resolution

**Files:**
- Create: `extension/src/core/plan.ts`
- Test: `extension/test/plan.test.ts`

**Interfaces:**
- `cellKey(project, task, timeType, date): string`
- `plan(spp: SppWeek, local: LocalEntry[], base: BaseWeek | null): CellPlan[]` — one plan per key present in any of SPP / local (dates within `spp.days`) / base; sorted by project, task, timeType, date.
  - Local entries with the same key merge: hours summed; descriptions and notes de-duplicated and joined with `"; "` in entry order.
  - Two SPP lines with the same project/task/timeType → every key of them gets `conflict`, reason `duplicate SPP lines`.
  - Equality of two `Cell | null`: both null, or hours within `1e-9` and trimmed description and note equal.
  - Rule: `S == L` → `same`; else `S == B` → `toSpp`; else `L == B` → `toLocal`; else `conflict`. (Absent equals absent.)
  - `toSpp` with a local value whose description or note is empty → `invalid`, reason `description and note are required`.
  - `spp.locked` → every `toSpp` becomes `conflict`, reason `locked`.
- `resolve(plans: CellPlan[], choices: Record<string, "spp" | "local">, local: LocalEntry[], newId: () => string): { writes: Write[]; localWeek: LocalEntry[] }`:
  - `toSpp`, and `conflict` chosen `local` → a `Write` with the local value (null = clear).
  - `toLocal`, and `conflict` chosen `spp` → the key's local entries are replaced by one entry with the SPP value (`newId()`), or removed when SPP is null.
  - `same`, `toSpp`, unchosen conflicts and `invalid` keep their local entries unchanged.
  - Throws `Error("unresolved conflicts")` if any `conflict` has no choice and is not `locked`; locked conflicts keep both sides.

- [ ] **Step 1: Write failing tests** (build small `SppWeek`s inline with a helper):
  - `same when equal`; `toSpp when only local changed`; `toLocal when only SPP changed`; `conflict when both changed`.
  - `note difference is a conflict` (Review Focus 1): S and L both 2 h, notes `a` vs `b`, base null → `conflict`.
  - `local duplicates merge` (Review Focus 2): two local entries 1 h + 0.5 h, descriptions `x`, `y`; SPP 1.5 h `x; y` with the same note → `same`; `resolve` leaves both entries with their ids.
  - `local delete clears SPP` (Review Focus 3): base 2 h, SPP 2 h, no local → `toSpp`; `resolve` gives a `Write` with `value: null`.
  - `SPP delete removes local`: base 2 h, local 2 h, no SPP → `toLocal`; `resolve` removes the entry.
  - `locked turns writes into conflicts` (Review Focus 4): `locked: true`, a `toSpp` case → `conflict`/`locked`; `resolve` with no choices does not throw.
  - `invalid when note missing`: local note `""` → `invalid`.
  - `unresolved conflict throws`.
- [ ] **Step 2:** `npm test -- plan` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm test -- plan` → PASS.
- [ ] **Step 5:** Commit `feat(core): three-way sync plan`.

### Task 4: Save body and catalog

**Files:**
- Create: `extension/src/core/saveBody.ts`, `extension/src/core/catalog.ts`
- Test: `extension/test/saveBody.test.ts`, `extension/test/catalog.test.ts`; extend `test/boundary.test.ts`

**Interfaces:**
- `saveBody(formFields: [string, string][], week: SppWeek, writes: Write[], catalog: Catalog): [string, string][]`
  - Start from `formFields` (the form's `FormData` entries) without any `_c*_r*_dialog_*` keys.
  - Existing line (same project/task/timeType in `week.lines`): set `_c<col>_r<row>` to `String(hours)` or `""` for null.
  - New lines: group writes without an SPP line by project/task/timeType; rows `week.emptyRow` (or max row + 1), `+1` per further line; set `_c1_r<n>` = catalog project `id`, `_c2_r<n>` = task `id`, `_c3_r<n>` = `time_type_ids[timeType]`, every day column `""` unless written. Missing name → `throw Error("not in projects list: <name>")` (Review Focus 5).
  - Dialog fields, after applying writes: for every line and day with hours, append `_c<col>_r<row>_dialog_description`, `_dialog_notes`, `_dialog_sri` (from the model's `sri` if known, else `"undefined"`). `_total_rows` is left as the form has it.
  - Set `_form_has_changed` to `"1"`; append `["_save_grid", "Save"]`.
- `buildCatalog(projectOptions: [string, string][] /* [id "cust:proj", name] */, tasks: Record<string, [string, string][]> /* project id → [name, taskId] */, timeTypes: Record<string, [string, string][]> /* taskId → [name, id] */, now: string): Catalog` — task `time_types` from `timeTypes`; project `time_types` = union over its tasks, in first-seen order; `time_type_ids` from all pairs.

- [ ] **Step 1: Write failing tests:**
  - `writes into an existing cell`: fixture form + model, write row 2's 2026-10-15 to 3 h with `d`/`n` → `_c8_r2` is `"3"`, `_c8_r2_dialog_description` is `"d"`, `_c8_r2_dialog_notes` is `"n"`; other cells' dialog fields still present with their model values; last pair is `["_save_grid", "Save"]`; `_form_has_changed` is `"1"`.
  - `clears a cell`: value null → `_c8_r2` is `""` and no dialog fields for it.
  - `adds two new lines`: two writes for two unknown lines → rows 5 and 6 with catalog ids in `_c1`/`_c2`/`_c3`.
  - `refuses unknown names` (Review Focus 5): throws `not in projects list: Nope`.
  - In `boundary.test.ts`: `test_save_body_has_no_submit_key`: no key of any body above matches `/submit/i`.
  - `catalog.test.ts`: two projects, three tasks, task time types `Billable` and `Non-Billable` → project `time_types` union, `time_type_ids` `{"Billable": "9", "Non-Billable": "7"}`.
- [ ] **Step 2:** `npm test -- saveBody catalog boundary` → FAIL.
- [ ] **Step 3:** Implement both modules.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(core): save body and projects catalog`.

### Task 5: Native host and installer

**Files:**
- Create: `host/timelog_host.py`, `host/install.sh`; Modify: `plugin/scripts/timelog_store.py` (add `read_state() -> dict`, `write_state(d: dict) -> None` for `spp-state.json`, default `{}`), `pyproject.toml` (`pythonpath` adds `"host"`)
- Test: `tests/test_host.py`

**Interfaces:**
- `handle(msg: dict) -> dict`:
  - `{"cmd": "week", "start": "YYYY-MM-DD", "timesheet_id": int}` → `{"ok": true, "entries": [<entries dated start..start+6>], "base": state[str(timesheet_id)] or null, "projects_updated": <projects.json updated or null>}`
  - `{"cmd": "save_week", "start", "timesheet_id", "entries": [...], "base": {...}}` → replaces all entries dated in that week by `entries` (each passes `validate_entry`; on error nothing is written), sets `state[str(timesheet_id)] = base`; `{"ok": true}`.
  - `{"cmd": "save_projects", "catalog": {...}}` → `write_projects`; `{"ok": true}`.
  - Unknown cmd or any exception → `{"ok": false, "error": str(e)}`.
- `read_message(stream) -> dict`, `write_message(stream, obj) -> None` (4-byte little-endian length + UTF-8 JSON); `__main__` reads one message from `sys.stdin.buffer`, writes one reply to `sys.stdout.buffer`.
- `install.sh`: writes `host/timelog-host` (executable: `#!/bin/sh` + `exec "<absolute python3 from command -v>" "<abs>/host/timelog_host.py"`), then `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.timelog.host.json` with `name`, `description`, `path` (absolute wrapper), `type: "stdio"`, `allowed_origins: ["chrome-extension://<EXTENSION_ID>/"]`. Prints the manifest path. `host/timelog-host` is git-ignored.

- [ ] **Step 1: Write failing tests:**
  - `test_week_returns_entries_and_base`: entries on 2026-10-10, 10-12, 10-18; state `{"126795": {...}}` → `week` with start 2026-10-11 returns the 10-12 entry and the base.
  - `test_save_week_replaces_only_that_week`: entries 10-10 and 10-12 → `save_week` with one new 10-13 entry → file holds 10-10 and 10-13.
  - `test_save_week_invalid_writes_nothing`: one entry with empty note → `ok: false`, file unchanged.
  - `test_protocol_round_trip`: `write_message` then `read_message` on a `BytesIO` → same dict; the first 4 bytes equal the little-endian length.
  - `test_main_over_stdio`: run `python3 host/timelog_host.py` with a framed `{"cmd": "nope"}` on stdin → framed reply with `ok: false`.
- [ ] **Step 2:** `python3 -m pytest tests/test_host.py -v` → FAIL.
- [ ] **Step 3:** Implement host, store additions and `install.sh`.
- [ ] **Step 4:** `python3 -m pytest -v` → all PASS; `bash -n host/install.sh` → no output.
- [ ] **Step 5:** Commit `feat(host): native messaging host and installer`.

### Task 6: Content script and page bridge

**Files:**
- Create: `extension/src/page.ts`, `extension/src/content.ts`
- Test: `extension/test/content.test.ts`

**Interfaces:**
- `page.ts` (MAIN world): on `document` event `timelog:catalog-request`, for every project option of the empty row's `_c1` select (value `"cust:proj"`, skip `":"`) calls `window.project_tasks(<proj part>)` (returns `[null, [name, id], ...]`) and for every task `window.pt_to_timetype(id)` (returns a sparse array of `[name, id]`); dispatches `timelog:catalog-response` with `detail = JSON.stringify({projectOptions, tasks, timeTypes})`.
- `content.ts` exports, for tests, `readWeek(doc: Document): SppWeek` (uses `parseModel`, `hasSaveButton = !!doc.getElementById("timesheet_savebutton")`) and `formFields(doc: Document): [string, string][]`; and handles `chrome.runtime.onMessage`:
  - `{type: "week"}` → `{week}`
  - `{type: "catalog"}` → dispatches the request event, awaits the response (timeout 60 s) → `{catalog: buildCatalog(..., new Date().toISOString())}`
  - `{type: "save", writes, catalog}` → `saveBody(formFields(document), readWeek(document), writes, catalog)` → `fetch(form.action, {method: "POST", body: new URLSearchParams(body), credentials: "same-origin"})` → parse the response HTML's `oa_model_timesheet` → `{errors, message}`; on no errors, `location.reload()` after replying.

- [ ] **Step 1: Write failing tests** (jsdom document built from the fixtures: a `<script type="text/html" id="oa_model_timesheet">`, a `<form id="timesheet_main_form">` with the fixture fields as hidden inputs, and `<input id="timesheet_savebutton">`):
  - `readWeek reads the fixture`: 4 lines, `locked === false`; without the save button → `locked === true`.
  - `formFields returns the form fields in order`: equals `test/fixtures/form-fields.json`.
- [ ] **Step 2:** `npm test -- content` → FAIL.
- [ ] **Step 3:** Implement `page.ts` and `content.ts`.
- [ ] **Step 4:** `npm test` → all PASS; `npm run build` → no errors.
- [ ] **Step 5:** Commit `feat(extension): content script and page bridge`.

### Task 7: Side panel

**Files:**
- Create: `extension/src/sidepanel/{index.tsx,App.tsx,sidepanel.html,sidepanel.css}`
- Test: `extension/test/App.test.tsx`

**Interfaces:**
- `App` props: `{ api: Api }` with
  `type Api = { week(): Promise<SppWeek | null>; host(msg: object): Promise<any>; catalog(): Promise<Catalog>; save(writes: Write[], catalog: Catalog): Promise<{errors: string[]; message: string | null}>; }`
  — `index.tsx` builds the real `Api` from `chrome.tabs.query` + `chrome.tabs.sendMessage` and `chrome.runtime.sendNativeMessage("com.timelog.host", msg)`; tests pass a fake.
- Load: `week()` → null shows `Open a timesheet in SuiteProjects Pro`. Otherwise `host({cmd: "week", start: days[0], timesheet_id})` → `plan(...)`. If `projects_updated` is null or older than 24 h: `catalog()` → `host({cmd: "save_projects", catalog})`.
- Grid: rows = project / task / time type, columns = 7 days + total. Cell class by state: `same`, `toSpp`, `toLocal`, `conflict`, `invalid`; `title` shows SPP / local / base values. Clicking a `conflict` cell toggles its choice `spp` ↔ `local` (shown in the cell).
- Status line: counts per state; SPP `errors` and `message`; `Locked: submitted or approved` when locked.
- **Sync** button: disabled when locked, any `invalid`, or an unchosen conflict. On click: `resolve` → if writes, `save(writes, catalog)` → errors shown and stop; else re-read `week()` → `host({cmd: "save_week", start, timesheet_id, entries: localWeek, base})` where `base` = all SPP cells of the re-read week keyed by `cellKey` → reload the plan. A **Refresh projects** button forces `catalog()` + `save_projects`.

- [ ] **Step 1: Write failing tests** (render with Preact into jsdom, fake `Api`):
  - `shows hint without a timesheet`: `week()` → null → text `Open a timesheet in SuiteProjects Pro`.
  - `renders states`: fixture week + one local entry differing from SPP + no base → one cell with class `conflict`; Sync disabled; clicking the cell enables Sync.
  - `sync writes then saves the week`: a `toSpp` case → click Sync → fake `save` called once with one write; then `host` called with `cmd: "save_week"`.
  - `locked disables sync`: locked week → Sync disabled and `Locked` shown.
- [ ] **Step 2:** `npm test -- App` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** `npm test` → all PASS; `npm run build` → OK.
- [ ] **Step 5:** Commit `feat(extension): side panel grid and sync`.

### Task 8: Live verification on test timesheet 126795 (with the user)

Target: SPP timesheet `126795` (week 2026-10-11 – 2026-10-17); the user confirmed it is a test week and will not be submitted.

- [ ] **Step 1:** User: `chrome://extensions` → Load unpacked → `extension/dist`; check the shown ID equals `EXTENSION_ID`. Claude: `bash host/install.sh`.
- [ ] **Step 2:** Open timesheet 126795, open the side panel. Expected: the 4 SPP lines appear as `toLocal` (no local entries, no base); `~/.timelog/projects.json` now has `source: "extension"` and per-task time types (the Acme non-billable tasks show `Non-Billable`).
- [ ] **Step 3:** Sync. Expected: no POST (only local updates); `entries --week 2026-10-11` lists the SPP cells; every cell turns `same`.
- [ ] **Step 4:** `add` one entry on 2026-10-16 for an existing line, and two entries for two lines not yet in SPP. Reload the panel → three `toSpp`. Sync. Expected: SPP shows the three cells after reload and `message` is the saved text. **If the two new lines do not both appear, record a ruling:** new lines are saved one per POST (loop: save, reload, re-read, next), implement it with a test, re-run this step.
- [ ] **Step 5:** `delete` one of the new local entries → panel shows `toSpp` (clear) → Sync → the SPP cell is empty.
- [ ] **Step 6:** Type a value by hand in SPP and Save → panel shows `toLocal` → Sync → `entries` has it.
- [ ] **Step 7: Cleanup:** delete all test entries locally, Sync so SPP 126795 is back to its state before Step 4 (or empty if the user prefers), and confirm with the user.
- [ ] **Step 8:** Update `docs/design.md` "SPP page facts" with what Step 4 showed about new lines, and commit `docs: record live sync findings`.
