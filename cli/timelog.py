"""timelog CLI — the only interface the skill uses to read and change the data folder (~/Timesheetgate).

Run: python3 timelog.py <subcommand> ...   (see --help)
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import asdict, replace
from datetime import date, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import timelog_store as s  # noqa: E402

LINE_FIELDS = ("project", "task", "time_type")


def _print(data) -> None:
    print(json.dumps(data, ensure_ascii=False, indent=2))


def _path(p: str) -> str:
    return os.path.normpath(os.path.expanduser(p))


def resolve(mapping: dict, alias: str | None, project: str | None, task: str | None, time_type: str | None) -> dict:
    base = {}
    if alias:
        base = mapping["aliases"].get(alias.lower())
        if base is None:
            raise ValueError(f"unknown alias: {alias}")
    given = {"project": project, "task": task, "time_type": time_type}
    return {k: given[k] if given[k] is not None else base.get(k) for k in LINE_FIELDS}


def check_catalog(catalog: dict, project: str | None, task: str | None, time_type: str | None) -> None:
    """Names must match SPP exactly. Checked only when projects.json has projects."""
    projects = {p["name"]: p for p in catalog.get("projects", [])}
    if not projects or not project:
        return
    p = projects.get(project)
    if p is None:
        raise ValueError(f"unknown project: {project} (run `projects` for the list)")
    if task and task not in {t["name"] for t in p.get("tasks", [])}:
        raise ValueError(f"unknown task for {project}: {task} (run `projects` for the list)")
    if time_type and time_type not in p.get("time_types", []):
        raise ValueError(f"time type {time_type} is not allowed for {project}")


def check_step(hours: float, config: dict) -> None:
    """SPP rounds hours to its step (0.5 h measured); a value off the step would not be kept."""
    step = config["hour_step"]
    if abs(hours / step - round(hours / step)) > 1e-9:
        raise ValueError(f"hours must be a multiple of {step:g} (SPP rounds to it)")


def _find(entries: list[s.Entry], eid: str) -> int:
    for i, e in enumerate(entries):
        if e.id == eid:
            return i
    raise ValueError(f"no entry with id {eid}")


# ── commands ──────────────────────────────────────────────
def cmd_add(a) -> None:
    line = resolve(s.read_mapping(), a.alias, a.project, a.task, a.time_type)
    e = s.Entry(
        id=s.new_id(),
        date=s.parse_date(a.date).isoformat(),
        project=line["project"] or "",
        task=line["task"] or "",
        time_type=line["time_type"] or "",
        hours=a.hours,
        description=a.description,
        note=a.note,
    )
    s.validate_entry(e)
    check_step(e.hours, s.read_config())
    check_catalog(s.read_projects(), e.project, e.task, e.time_type)
    s.write_entries(s.read_entries() + [e])
    _print(asdict(e))


def cmd_entries(a) -> None:
    entries = s.read_entries()
    if a.date:
        d = s.parse_date(a.date).isoformat()
        picked = [e for e in entries if e.date == d]
    else:
        start, end = s.week_range(s.parse_date(a.week or "today"))
        picked = [e for e in entries if start.isoformat() <= e.date <= end.isoformat()]
    _print([asdict(e) for e in sorted(picked, key=lambda e: (e.date, e.project))])


def cmd_edit(a) -> None:
    entries = s.read_entries()
    i = _find(entries, a.id)
    changes = {k: getattr(a, k) for k in ("hours", "description", "note") if getattr(a, k) is not None}
    if a.alias or a.project or a.task or a.time_type:
        line = resolve(s.read_mapping(), a.alias, a.project, a.task, a.time_type)
        changes.update({k: v for k, v in line.items() if v is not None})
    if a.date is not None:
        changes["date"] = s.parse_date(a.date).isoformat()
    e = replace(entries[i], **changes)
    s.validate_entry(e)
    check_step(e.hours, s.read_config())
    check_catalog(s.read_projects(), e.project, e.task, e.time_type)
    entries[i] = e
    s.write_entries(entries)
    _print(asdict(e))


def cmd_delete(a) -> None:
    entries = s.read_entries()
    del entries[_find(entries, a.id)]
    s.write_entries(entries)


def cmd_alias_set(a) -> None:
    m = s.read_mapping()
    value = {"project": a.project}
    if a.task:
        value["task"] = a.task
    if a.time_type:
        value["time_type"] = a.time_type
    check_catalog(s.read_projects(), a.project, a.task, a.time_type)
    m["aliases"][a.name.lower()] = value
    s.write_mapping(m)


def cmd_alias_list(a) -> None:
    _print(s.read_mapping()["aliases"])


def cmd_projects(a) -> None:
    _print(s.read_projects())


WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]


def _num(x: float) -> str:
    return f"{x:g}"


def week_table(entries: list[s.Entry], start: date, config: dict) -> str:
    days = [start + timedelta(days=i) for i in range(7)]
    iso = [d.isoformat() for d in days]
    rows: dict[str, list[float]] = {}
    for e in entries:
        if e.date in iso:
            label = f"{e.project} / {e.task} / {e.time_type}"
            rows.setdefault(label, [0.0] * 7)[iso.index(e.date)] += e.hours
    totals = [sum(r[i] for r in rows.values()) for i in range(7)]
    width = max([len(label) for label in rows] + [7])

    def line(label: str, cells: list[str]) -> str:
        return f"{label:<{width}}  " + " ".join(f"{c:>5}" for c in cells)

    out = [f"Week {iso[0]} – {iso[6]}", line("", WEEKDAYS + ["Total"])]
    for label, hours in sorted(rows.items()):
        out.append(line(label, [_num(h) if h else "." for h in hours] + [_num(sum(hours))]))
    out.append(line("Total", [_num(t) if t else "." for t in totals] + [_num(sum(totals))]))
    missing = [
        _num(max(0.0, config["hours_per_day"] - totals[i])) if d.weekday() in config["workdays"] else "-"
        for i, d in enumerate(days)
    ]
    out.append(line("Missing", missing))
    return "\n".join(out)

def cmd_week(a) -> None:
    d = s.parse_date(a.date)
    print(week_table(s.read_entries(), s.week_range(d)[0], s.read_config()))


# ── parser ────────────────────────────────────────────────
def _line_args(p, required: bool) -> None:
    p.add_argument("--alias")
    p.add_argument("--project")
    p.add_argument("--task")
    p.add_argument("--time-type", dest="time_type")
    p.add_argument("--hours", type=float, required=required)
    p.add_argument("--description", required=required)
    p.add_argument("--note", required=required)
    p.add_argument("--date")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="timelog")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("add", help="add an entry to entries.csv")
    _line_args(p, required=True)
    p.set_defaults(func=cmd_add, date="today")

    p = sub.add_parser("entries", help="list entries of a week (default) or one day")
    p.add_argument("--week")
    p.add_argument("--date")
    p.set_defaults(func=cmd_entries)

    p = sub.add_parser("edit", help="change fields of an entry")
    p.add_argument("id")
    _line_args(p, required=False)
    p.set_defaults(func=cmd_edit)

    p = sub.add_parser("delete", help="delete an entry")
    p.add_argument("id")
    p.set_defaults(func=cmd_delete)

    alias = sub.add_parser("alias", help="manage aliases").add_subparsers(dest="alias_cmd", required=True)
    p = alias.add_parser("set")
    p.add_argument("name")
    p.add_argument("--project", required=True)
    p.add_argument("--task")
    p.add_argument("--time-type", dest="time_type")
    p.set_defaults(func=cmd_alias_set)
    alias.add_parser("list").set_defaults(func=cmd_alias_list)

    p = sub.add_parser("projects", help="SPP projects, tasks and time types (copy kept by the extension)")
    p.set_defaults(func=cmd_projects)

    p = sub.add_parser("week", help="hours per line and day, missing hours")
    p.add_argument("--date", default="today")
    p.set_defaults(func=cmd_week)

    return parser


def main(argv: list[str]) -> int:
    args = build_parser().parse_args(argv)
    try:
        args.func(args)
    except ValueError as e:
        print(str(e), file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
