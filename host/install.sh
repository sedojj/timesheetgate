#!/bin/sh
# Optional: installs the `timelog` command and puts AGENTS.md into the data folder (macOS, Linux).
# The extension does not need it. Safe to re-run.
set -eu
HERE="$(cd "$(dirname "$0")" && pwd -P)"
PY="$(command -v python3)"
CLI_DIR="$(cd "$HERE/../cli" && pwd -P)"

# The native host of older versions is not used any more.
rm -f "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.timelog.host.json"

# The `timelog` command: the one interface for agents, scripts and the Claude plugin.
BIN="$HOME/.local/bin"
mkdir -p "$BIN"
printf '#!/bin/sh\nexec "%s" "%s" "$@"\n' "$PY" "$CLI_DIR/timelog.py" > "$BIN/timelog"
chmod +x "$BIN/timelog"

# The data folder as the CLI sees it ($TIMELOG_HOME or ~/Timesheetgate; moves ~/.timelog once).
DATA="$("$PY" -I -c 'import sys; sys.path.insert(0, sys.argv[1]); import timelog_store; print(timelog_store.home())' "$CLI_DIR")"

# A tool-neutral guide for AI agents (Gemini CLI, Codex, …) and people, next to the data.
sed "s#{{CLI}}#$BIN/timelog#g" "$HERE/AGENTS.md" > "$DATA/AGENTS.md"

echo "$BIN/timelog"
echo "$DATA/AGENTS.md"
case ":$PATH:" in *":$BIN:"*) ;; *) echo "Note: add $BIN to your PATH to run 'timelog' by name." ;; esac
