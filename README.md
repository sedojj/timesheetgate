# Timesheetgate — Make Minutes Multiply

Stop clicking through SuiteProjects Pro (SPP) timesheets. Keep your hours in a plain local
file, let Claude (or any agent, script or app) maintain it, and sync it into SPP with one
click.

- **Never submits.** It only saves; "Save & Submit" stays yours. A test enforces this.
- **Local first.** Your hours live in `~/.timelog/entries.csv`. No server, no external
  service, no API key.
- **Any SPP account.** Works on whichever `*.netsuitesuiteprojectspro.com` timesheet is open
  in Chrome, with your normal login.

## How it fits together

```
Claude chats ─┐                                   ┌─> SPP timesheet (the open tab)
Gemini/Codex ─┼─> ~/.timelog/entries.csv <──host──┤   read, then Save on your click
you / scripts ┘          (the gate)               └─  Timesheetgate side panel
```

| Part | Folder | What it does |
|---|---|---|
| Chrome extension | `extension/` | Side panel next to the SPP timesheet: shows the week, edits cells, enters PTO, syncs |
| Native host | `host/` | Small Python program Chrome starts to read and write `~/.timelog/` |
| Claude Code plugin (optional) | `plugin/` | Logs which client each chat worked on; "review today", "log 1.5 h to acme" |
| Agent guide | `host/AGENTS.md` | Rules for any AI agent or person editing `entries.csv` |

## Install (macOS)

Needs Google Chrome, Python 3 and Node.js.

1. **Build the extension**
   ```bash
   cd extension && npm ci && npm run build
   ```
2. **Load it:** `chrome://extensions` → turn on *Developer mode* → *Load unpacked* →
   choose `extension/dist`. The ID must be `djgoocbpipjkklhcbpehkhjnaeacjiah`.
3. **Register the host:**
   ```bash
   sh host/install.sh
   ```
   This also copies the agent guide to `~/.timelog/AGENTS.md`.
4. **Optional, for Claude Code users:**
   ```bash
   claude plugin marketplace add "$(pwd)"
   claude plugin install timelog@timelog
   ```
   Then, in a new chat: "set up timelog".

After a code change: `npm run build` in `extension/`, then reload the extension in
`chrome://extensions`.

## Daily use

1. **Log hours** any way you like:
   - in Claude: "log 1.5 h to acme", or "review today" at the end of the day;
   - with the CLI: `python3 plugin/scripts/timelog.py add --alias acme --task "…" --hours 1.5 --description "…" --note "…"`;
   - in the side panel: click a cell and type, or use **Enter PTO**;
   - with another agent: tell it to read `~/.timelog/AGENTS.md` first.
2. **Open the week** in SPP and click the toolbar icon. The panel shows each cell's state and
   "What Sync will do". It updates by itself.
3. **Click Sync.** Your changes go to SPP, hours typed by hand in SPP come back to your file,
   and cells changed on both sides ask you to choose.
4. **Submit in SPP** when the week is complete.

## Rules SPP enforces (the tools check them for you)

- Project, task and time type must match SPP's names exactly. The extension keeps the list in
  `~/.timelog/projects.json` (button *Sync project list*).
- Every hour entry needs a description **and** a note; SPP rejects the whole save otherwise.
- Hours in half-hour steps; SPP rounds anything else.
- A submitted or approved week is locked; the panel shows it and writes nothing.

## Data in `~/.timelog/`

| File | Contents |
|---|---|
| `entries.csv` | Your hour entries: `id,date,project,task,time_type,hours,description,note` |
| `projects.json` | Your SPP projects, tasks and allowed time types |
| `mapping.json` | Aliases ("acme", "pto") and client folders |
| `spp-state.json` | What SPP held at the last Sync |
| `sessions/` | Claude Code activity per chat (plugin only) |
| `AGENTS.md` | The agent guide |

Nothing here is sent anywhere except into your own SPP timesheet.

## Limits

- Sync adds at most one *new* timesheet line per click; the panel says when to click again.
- PTO ranges stay within the open week (SPP keeps one timesheet per week).
- The installer is for macOS; Windows needs a registry entry instead (not done yet).
- The side panel assumes it sits right of the page: ← means "to SPP".

## Development

```bash
cd extension && npm test && npx tsc --noEmit   # extension: vitest + types
python3 -m pytest -q                          # host, CLI, hooks (from the repo root)
node extension/icons/render.js                # re-render the icon PNGs from icon.svg
```

Design and findings about the SPP page: [docs/design.md](docs/design.md).
The `recorder/` extension is the throwaway tool used to learn how SPP saves.
