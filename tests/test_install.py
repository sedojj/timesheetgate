import json
import os
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OLD_MANIFEST = "Library/Application Support/Google/Chrome/NativeMessagingHosts/com.timelog.host.json"


def install(home: Path, **env) -> subprocess.CompletedProcess:
    return subprocess.run(["sh", str(ROOT / "host" / "install.sh")], capture_output=True, text=True,
                          env={"HOME": str(home), "PATH": os.environ["PATH"], **env})


def test_install_puts_the_command_and_guide_in_place_and_drops_the_old_host(tmp_path):
    (tmp_path / ".timelog").mkdir()
    (tmp_path / ".timelog" / "entries.csv").write_text("x", encoding="utf-8")
    old = tmp_path / OLD_MANIFEST
    old.parent.mkdir(parents=True)
    old.write_text("{}")
    r = install(tmp_path)
    assert r.returncode == 0, r.stderr
    assert not old.exists()
    data = tmp_path / "Timesheetgate"
    assert (data / "entries.csv").read_text(encoding="utf-8") == "x"  # moved, not shadowed by a new folder
    guide = (data / "AGENTS.md").read_text()
    assert "{{CLI}}" not in guide and "timelog add" in guide
    r = subprocess.run([str(tmp_path / ".local" / "bin" / "timelog"), "alias", "list"], capture_output=True, text=True,
                       env={"HOME": str(tmp_path), "PATH": os.environ["PATH"]})
    assert r.returncode == 0 and json.loads(r.stdout) == {}


def test_install_respects_timelog_home(tmp_path):
    r = install(tmp_path, TIMELOG_HOME=str(tmp_path / "elsewhere"))
    assert r.returncode == 0, r.stderr
    assert (tmp_path / "elsewhere" / "AGENTS.md").exists()
    assert not (tmp_path / "Timesheetgate").exists()
