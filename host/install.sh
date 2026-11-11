#!/bin/sh
# Registers the timelog native messaging host with Chrome (macOS). Safe to re-run.
set -eu
HERE="$(cd "$(dirname "$0")" && pwd -P)"
ID="$(cat "$HERE/../extension/EXTENSION_ID")"
PY="$(command -v python3)"
WRAPPER="$HERE/timelog-host"
DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"

# Chrome started from the Dock has a minimal PATH, so the wrapper uses absolute paths.
printf '#!/bin/sh\nexec "%s" "%s"\n' "$PY" "$HERE/timelog_host.py" > "$WRAPPER"
chmod +x "$WRAPPER"

mkdir -p "$DIR"
cat > "$DIR/com.timelog.host.json" <<JSON
{
  "name": "com.timelog.host",
  "description": "timelog: reads and writes ~/.timelog for the Timelog extension",
  "path": "$WRAPPER",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://$ID/"]
}
JSON
# A tool-neutral guide for AI agents (Gemini CLI, Codex, …) and people, next to the data.
mkdir -p "$HOME/.timelog"
CLI="$(cd "$HERE/../plugin/scripts" && pwd -P)/timelog.py"
sed "s#{{CLI}}#$CLI#g" "$HERE/AGENTS.md" > "$HOME/.timelog/AGENTS.md"

echo "$DIR/com.timelog.host.json"
echo "$HOME/.timelog/AGENTS.md"
