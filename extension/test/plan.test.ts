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
  // One direction: the timelog goes to SPP; SPP changes since the last Sync (B) need one decision.
  test.each([
    ["same when SPP equals local", { [D]: cell(2) }, [local(2)], null, "same"],
    ["local change goes to SPP", { [D]: cell(2) }, [local(3)], cell(2), "toSpp"],
    ["SPP change since last Sync is sppChanged", { [D]: cell(3) }, [local(2)], cell(2), "sppChanged"],
    ["both changed is sppChanged", { [D]: cell(3) }, [local(4)], cell(2), "sppChanged"],
    ["a new local entry goes to SPP", {}, [local(2)], null, "toSpp"],
    ["SPP-only hours without base are sppChanged", { [D]: cell(8) }, [], null, "sppChanged"],
  ] as const)("%s", (_, spp, loc, b, state) => {
    expect(only(plan(week(spp), [...loc], b ? base(b) : null)).state).toBe(state);
  });

  test("local change goes to SPP: resolve writes the timelog's value", () => {
    const p = only(plan(week({ [D]: cell(2) }), [local(3)], base(cell(2))));
    expect(resolve([p], null, [local(3)], () => "new").writes.map((w) => w.value?.hours)).toEqual([3]);
  });

  test("local duplicates merge", () => {
    const entries = [local(1, "x", "n", "a"), local(0.5, "y", "n", "b")];
    const p = only(plan(week({ [D]: cell(1.5, "x; y", "n") }), entries, null));
    expect(p.state).toBe("same");
    expect(p.local).toEqual(cell(1.5, "x; y", "n"));
    const r = resolve([p], null, entries, () => "new");
    expect(r.writes).toEqual([]);
    expect(r.localWeek.map((e) => e.id)).toEqual(["a", "b"]);
  });

  test("local delete clears SPP", () => {
    const p = only(plan(week({ [D]: cell(2) }), [], base(cell(2))));
    expect(p.state).toBe("toSpp");
    expect(resolve([p], null, [], () => "new").writes).toEqual([{ project: P, task: T, timeType: Y, date: D, value: null }]);
  });

  test("SPP deletion since last Sync is sppChanged", () => {
    expect(only(plan(week(), [local(2)], base(cell(2)))).state).toBe("sppChanged");
  });

  test("sppChanged needs a decision", () => {
    const p = only(plan(week({ [D]: cell(3) }), [local(2)], base(cell(2))));
    expect(() => resolve([p], null, [local(2)], () => "new")).toThrow("SPP changed since the last Sync: decide first");
  });

  test("overwrite writes local, also deleting SPP-only hours", () => {
    const p = only(plan(week({ [D]: cell(8) }), [], null));
    const r = resolve([p], "overwrite", [], () => "new");
    expect(r.writes).toEqual([{ project: P, task: T, timeType: Y, date: D, value: null }]);
    expect(r.localWeek).toEqual([]);
  });

  test("keep copies SPP into the timelog", () => {
    const p = only(plan(week({ [D]: cell(3, "s", "t") }), [local(2)], base(cell(2))));
    const r = resolve([p], "keep", [local(2)], () => "new");
    expect(r.writes).toEqual([]);
    expect(r.localWeek).toEqual([{ ...local(3, "s", "t"), id: "new" }]);
    const gone = only(plan(week(), [local(2)], base(cell(2))));
    expect(resolve([gone], "keep", [local(2)], () => "new").localWeek).toEqual([]);
  });

  test("invalid when note missing", () => {
    const p = only(plan(week(), [local(2, "d", "")], null));
    expect(p.state).toBe("invalid");
    expect(p.reason).toBe("description and note are required");
  });

  test("duplicate SPP lines are invalid", () => {
    const w = week({ [D]: cell(1) });
    const twin = { ...w.lines[0], row: 2 };
    const p = only(plan({ ...w, lines: [w.lines[0], twin] }, [], null));
    expect(p.state).toBe("invalid");
    expect(p.reason).toBe("duplicate SPP lines");
  });

  test("local entries outside the week are ignored", () => {
    expect(plan(week(), [{ ...local(2), date: "2026-10-20" }], null)).toEqual([]);
  });
});

describe("baseOf", () => {
  test("keys every SPP cell of the week", async () => {
    const { baseOf } = await import("../src/core/plan");
    const b = baseOf(week({ [D]: cell(2, "x", "y") }), "2026-11-11T20:00:00Z");
    expect(b).toEqual({ week_start: DAYS[0], synced_at: "2026-11-11T20:00:00Z", cells: { [KEY]: cell(2, "x", "y") } });
  });
});

describe("review fixes: plan", () => {
  test("float sums are rounded to 2 decimals", () => {
    const entries = [local(0.1, "d", "n", "a"), local(0.2, "d", "n", "b")];
    const p = only(plan(week({ [D]: cell(0.3) }), entries, null));
    expect(p.local!.hours).toBe(0.3);
    expect(p.state).toBe("same");
  });
  test("hours equal within half a hundredth", () => {
    expect(only(plan(week({ [D]: cell(1.33) }), [local(1.333)], null)).state).toBe("same");
  });
});
