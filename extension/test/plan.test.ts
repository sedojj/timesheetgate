import { describe, expect, test } from "vitest";
import { cellKey, plan, resolve } from "../src/core/plan";
import type { BaseWeek, Cell, LocalEntry, SppLine, SppWeek } from "../src/core/types";

const DAYS = ["2026-10-11", "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17"];
const D = "2026-10-12";
const P = "Acme : Impl", T = "9: Kickoff", Y = "Billable";
const KEY = cellKey(P, T, Y, D);

function week(cells: Record<string, Cell> = {}, extra: Partial<SppWeek> = {}, lines?: SppLine[]): SppWeek {
  const line: SppLine = {
    row: 1, projectId: "1:2", project: P, taskId: "9", task: T, timeTypeId: "9", timeType: Y,
    cells: Object.fromEntries(Object.entries(cells).map(([d, c]) => [d, { ...c, col: 5, origId: 1 }])),
  };
  return {
    timesheetId: 1, days: DAYS, dayCols: Object.fromEntries(DAYS.map((d, i) => [d, i + 4])),
    lines: lines ?? (Object.keys(cells).length ? [line] : []), emptyRow: 2, locked: false, message: null, errors: [],
    ...extra,
  };
}
const cell = (hours: number, description = "d", note = "n"): Cell => ({ hours, description, note });
const local = (hours: number, description = "d", note = "n", id = "e1"): LocalEntry =>
  ({ id, date: D, project: P, task: T, time_type: Y, hours, description, note });
const base = (c: Cell | null): BaseWeek => ({ week_start: DAYS[0], synced_at: "x", cells: c ? { [KEY]: c } : {} });
const only = (ps: ReturnType<typeof plan>) => { expect(ps).toHaveLength(1); return ps[0]; };

describe("plan", () => {
  test("same when equal", () => {
    expect(only(plan(week({ [D]: cell(2) }), [local(2)], null)).state).toBe("same");
  });
  test("toSpp when only local changed", () => {
    expect(only(plan(week({ [D]: cell(2) }), [local(3)], base(cell(2)))).state).toBe("toSpp");
  });
  test("toLocal when only SPP changed", () => {
    expect(only(plan(week({ [D]: cell(3) }), [local(2)], base(cell(2)))).state).toBe("toLocal");
  });
  test("conflict when both changed", () => {
    expect(only(plan(week({ [D]: cell(3) }), [local(4)], base(cell(2)))).state).toBe("conflict");
  });
  test("note difference is a conflict", () => {
    expect(only(plan(week({ [D]: cell(2, "d", "a") }), [local(2, "d", "b")], null)).state).toBe("conflict");
  });
  test("new local entry goes to SPP", () => {
    expect(only(plan(week(), [local(2)], null)).state).toBe("toSpp");
  });
  test("SPP-only cell comes to local", () => {
    expect(only(plan(week({ [D]: cell(2) }), [], null)).state).toBe("toLocal");
  });

  test("local duplicates merge", () => {
    const entries = [local(1, "x", "n", "a"), local(0.5, "y", "n", "b")];
    const p = only(plan(week({ [D]: cell(1.5, "x; y", "n") }), entries, null));
    expect(p.state).toBe("same");
    expect(p.local).toEqual(cell(1.5, "x; y", "n"));
    const r = resolve([p], {}, entries, () => "new");
    expect(r.writes).toEqual([]);
    expect(r.localWeek.map((e) => e.id)).toEqual(["a", "b"]);
  });

  test("local delete clears SPP", () => {
    const p = only(plan(week({ [D]: cell(2) }), [], base(cell(2))));
    expect(p.state).toBe("toSpp");
    expect(resolve([p], {}, [], () => "new").writes).toEqual([{ project: P, task: T, timeType: Y, date: D, value: null }]);
  });

  test("SPP delete removes local", () => {
    const p = only(plan(week(), [local(2)], base(cell(2))));
    expect(p.state).toBe("toLocal");
    expect(resolve([p], {}, [local(2)], () => "new").localWeek).toEqual([]);
  });

  test("toLocal replaces local entries with the SPP value", () => {
    const p = only(plan(week({ [D]: cell(3, "s", "t") }), [local(2)], base(cell(2))));
    const r = resolve([p], {}, [local(2)], () => "new");
    expect(r.localWeek).toEqual([{ ...local(3, "s", "t"), id: "new" }]);
  });

  test("locked turns writes into conflicts", () => {
    const p = only(plan(week({ [D]: cell(2) }, { locked: true }), [local(3)], base(cell(2))));
    expect(p.state).toBe("conflict");
    expect(p.reason).toBe("locked");
    expect(() => resolve([p], {}, [local(3)], () => "new")).not.toThrow();
  });

  test("invalid when note missing", () => {
    const p = only(plan(week(), [local(2, "d", "")], null));
    expect(p.state).toBe("invalid");
    expect(p.reason).toBe("description and note are required");
  });

  test("unresolved conflict throws, chosen conflict resolves", () => {
    const p = only(plan(week({ [D]: cell(3) }), [local(4)], base(cell(2))));
    expect(() => resolve([p], {}, [local(4)], () => "new")).toThrow("unresolved conflicts");
    expect(resolve([p], { [KEY]: "local" }, [local(4)], () => "new").writes[0].value).toEqual(cell(4));
    expect(resolve([p], { [KEY]: "spp" }, [local(4)], () => "new").localWeek[0].hours).toBe(3);
  });

  test("duplicate SPP lines are conflicts", () => {
    const w = week({ [D]: cell(1) });
    const twin = { ...w.lines[0], row: 2 };
    const p = only(plan({ ...w, lines: [w.lines[0], twin] }, [], null));
    expect(p.state).toBe("conflict");
    expect(p.reason).toBe("duplicate SPP lines");
  });

  test("local entries outside the week are ignored", () => {
    expect(plan(week(), [{ ...local(2), date: "2026-10-20" }], null)).toEqual([]);
  });
});
