import pytest


@pytest.fixture(autouse=True)
def timelog_home(tmp_path, monkeypatch):
    home = tmp_path / "timelog-home"
    monkeypatch.setenv("TIMELOG_HOME", str(home))
    return home
