"""timelog CLI — the only interface the skill uses to read and change ~/.timelog.

Run: python3 timelog.py <subcommand> ...   (see --help)
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from dataclasses import asdict, replace

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
    m["aliases"][a.name.lower()] = value
    s.write_mapping(m)


def cmd_alias_list(a) -> None:
    _print(s.read_mapping()["aliases"])


def cmd_root_add(a) -> None:
    m = s.read_mapping()
    p = _path(a.path)
    if p not in m["client_roots"]:
        m["client_roots"].append(p)
    s.write_mapping(m)


def cmd_folder_set(a) -> None:
    m = s.read_mapping()
    alias = a.alias.lower()
    if alias not in m["aliases"]:
        raise ValueError(f"unknown alias: {a.alias}")
    m["folders"][_path(a.path)] = alias
    s.write_mapping(m)


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

    root = sub.add_parser("root", help="folders whose sub-folders are clients").add_subparsers(dest="root_cmd", required=True)
    p = root.add_parser("add")
    p.add_argument("path")
    p.set_defaults(func=cmd_root_add)

    folder = sub.add_parser("folder", help="fixed folder -> alias").add_subparsers(dest="folder_cmd", required=True)
    p = folder.add_parser("set")
    p.add_argument("path")
    p.add_argument("alias")
    p.set_defaults(func=cmd_folder_set)

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
