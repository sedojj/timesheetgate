// Side panel behaviour that protects data or a flow the user relies on. Wording and layout
// are left to the eye; jsdom cannot judge them anyway.
import { render } from "preact";
import { act } from "preact/test-utils";
import { describe, expect, test, vi } from "vitest";
import { App, type Api } from "../src/sidepanel/App";
import type { Catalog, LocalEntry, SppLine, SppWeek } from "../src/core/types";
import { CATALOG } from "./fixtures/catalog";
import { QUOTES } from "../src/sidepanel/quotes";

const DAYS = ["2026-10-11", "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17"];
const P = "Acme Corp : Acme Impl", T = "15: Testing Support [Validate]", C = "13: Configuration/Data Loads [Model]", Y = "Billable";
const FRESH: Catalog = { ...CATALOG, updated: new Date().toISOString() };
const PTO = { project: "Example Co : Time Off", task: "1: PTO [Master Phase]", time_type: "Non-Billable" };

const line = (task: string, cells: SppLine["cells"] = {}, row = 1): SppLine =>
  ({ row, projectId: "1160:11372", project: P, taskId: "1", task, timeTypeId: "9", timeType: Y, cells });
/** A week with one SPP line (task T) holding `hours` on Monday 12, or no line for null. */
function week(hours: number | null, locked = false): SppWeek {
  return {
    timesheetId: 7, days: DAYS, dayCols: Object.fromEntries(DAYS.map((d, i) => [d, i + 4])),
    lines: hours === null ? [] : [line(T, { "2026-10-12": { hours, description: "d", note: "n", col: 5, origId: 1 } })],
    emptyRow: 2, locked, message: null, errors: [],
  };
}
const entry = (hours: number, more: Partial<LocalEntry> = {}): LocalEntry =>
  ({ id: "e1", date: "2026-10-12", project: P, task: T, time_type: Y, hours, description: "d", note: "n", ...more });

function fakeApi(w: SppWeek | null, entries: LocalEntry[], after?: SppWeek | null, extra: object = {}): any {
  const api: any = {
    stamp: "a", unsavedFlag: false, aliases: {},
    week: vi.fn(async () => w),
    host: vi.fn(async (msg: any) =>
      msg.cmd === "week" ? { ok: true, entries, base: null, projects: FRESH, stamp: "a", aliases: api.aliases, ...extra }
      : msg.cmd === "stamp" ? { ok: true, stamp: api.stamp } : { ok: true }),
    catalog: vi.fn(async () => FRESH),
    save: vi.fn(async () => ({ errors: [], message: "saved", week: after === undefined ? w : after })),
    reload: vi.fn(async () => {}),
    onTabChange: (cb: () => void) => { api.tabChanged = cb; },
    unsaved: vi.fn(async () => api.unsavedFlag),
    onUnsaved: (cb: (u: boolean) => void) => { api.pushUnsaved = cb; },
  };
  return api;
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0));
async function mount(api: Api) {
  const root = document.createElement("div");
  document.body.appendChild(root);
  await act(async () => { render(<App api={api} />, root); });
  await act(flush);
  return root;
}
const $ = (root: HTMLElement, sel: string) => root.querySelector(sel) as HTMLInputElement;
const btn = (root: HTMLElement, text: string) =>
  [...root.querySelectorAll("button")].find((b) => b.textContent === text) as HTMLButtonElement;
const click = (el: Element) => act(async () => { (el as HTMLElement).click(); await flush(); });
const type = (el: HTMLInputElement, v: string) =>
  act(async () => { el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); });
const pick = (el: HTMLInputElement, v: string) =>
  act(async () => { el.value = v; el.dispatchEvent(new Event("change", { bubbles: true })); });
const leave = (el: Element, to: Element | null = null) =>
  act(async () => { el.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: to })); await flush(); });
const calls = (api: any, cmd: string) => api.host.mock.calls.map((c: any[]) => c[0]).filter((m: any) => m.cmd === cmd);
const tick = () => act(async () => { await vi.advanceTimersByTimeAsync(5000); });
async function withClock(fn: () => Promise<void>, now?: Date) {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  if (now) vi.setSystemTime(now);
  try { await fn(); } finally { vi.useRealTimers(); }
}

describe("sync", () => {
  test("without a timesheet the panel says so", async () => {
    expect((await mount(fakeApi(null, []))).textContent).toContain("Open a timesheet in SuiteProjects Pro");
  });

  /** What SPP held at the last Sync: `hours` on Monday 12 on line T. */
  const lastSync = (hours: number) =>
    ({ base: { week_start: DAYS[0], synced_at: "x", cells: { [[P, T, Y, "2026-10-12"].join("\u001f")]: { hours, description: "d", note: "n" } } } });

  test("no question when SPP did not change", async () => {
    const api = fakeApi(week(2), [entry(3)], week(3), lastSync(2));
    const root = await mount(api);
    await click(btn(root, "Sync"));
    expect($(root, ".spp-question")).toBeNull();
    expect(api.save.mock.calls[0][0][0].value.hours).toBe(3);
  });

  test("SPP change: Sync asks once; Overwrite writes the timelog", async () => {
    const api = fakeApi(week(3), [entry(2)], week(2), lastSync(2));
    const root = await mount(api);
    expect($(root, ".cell.sppChanged")).not.toBeNull();
    expect(btn(root, "Sync").disabled).toBe(false);
    await click(btn(root, "Sync"));
    expect($(root, ".spp-question").textContent).toContain("SPP 3 h, timelog 2 h");
    expect(api.save).not.toHaveBeenCalled();
    await click(btn(root, "Overwrite with my timelog"));
    expect(api.save.mock.calls[0][0][0].value.hours).toBe(2);
    expect($(root, ".spp-question")).toBeNull();
  });

  test("Keep copies SPP's value into entries.csv and writes nothing to SPP", async () => {
    const api = fakeApi(week(3), [entry(2)], undefined, lastSync(2));
    const root = await mount(api);
    await click(btn(root, "Sync"));
    await click(btn(root, "Keep SPP's (copy to my timelog)"));
    expect(api.save).not.toHaveBeenCalled();
    expect(calls(api, "save_week")[0].entries.map((e: any) => e.hours)).toEqual([3]);
  });

  test("the question shows the line's time type, and the texts when only they changed", async () => {
    const w = week(2);
    w.lines[0].cells["2026-10-12"].note = "fixed by manager";
    const root = await mount(fakeApi(w, [entry(2)], undefined, lastSync(2)));
    await click(btn(root, "Sync"));
    const q = $(root, ".spp-question").textContent!;
    expect(q).toContain(`${T} · ${Y}`);
    expect(q).toContain('SPP 2 h "d / fixed by manager", timelog 2 h "d / n"');
  });

  test("hand-filled week: the question counts removals", async () => {
    const w = week(8);
    w.lines.push(line(C, { "2026-10-13": { hours: 8, description: "d", note: "n", col: 6, origId: 3 } }, 2));
    const root = await mount(fakeApi(w, []));
    await click(btn(root, "Sync"));
    expect($(root, ".spp-question").textContent).toContain("removes 2 entries from SPP");
  });

  test("Sync writes SPP, then entries.csv with the new base, and plans from SPP's answer", async () => {
    const api = fakeApi(week(null), [entry(3)], week(3));
    const root = await mount(api);
    await click(btn(root, "Sync"));
    expect(api.save.mock.calls[0][0]).toEqual([{ project: P, task: T, timeType: Y, date: "2026-10-12", value: { hours: 3, description: "d", note: "n" } }]);
    const [saved] = calls(api, "save_week");
    expect([saved.timesheet_id, saved.entries, saved.loaded_ids]).toEqual([7, [entry(3)], ["e1"]]);
    expect(Object.values(saved.base.cells)).toEqual([{ hours: 3, description: "d", note: "n" }]);
    expect(api.week).toHaveBeenCalledTimes(2); // load + the check before saving; no read after the reload
    expect($(root, ".cell.same")).not.toBeNull();
    expect(api.reload).toHaveBeenCalled();
  });

  test.each([
    ["SPP reports an error", (api: any) => { api.save = vi.fn(async () => ({ errors: ["1. Notes are required"], message: null, week: null })); }, "Notes are required"],
    ["SPP did not keep the write", (api: any) => { api.save = vi.fn(async () => ({ errors: [], message: null, week: week(null) })); }, "SPP did not keep"],
    ["SPP changed since loading", (api: any) => { api.week = vi.fn().mockResolvedValueOnce(week(null)).mockResolvedValue(week(5)); }, "SPP changed since the panel loaded"],
  ])("nothing reaches entries.csv when %s", async (_, setup, message) => {
    const api = fakeApi(week(null), [entry(3)]);
    setup(api);
    const root = await mount(api);
    await click(btn(root, "Sync"));
    expect(root.textContent).toContain(message);
    expect(calls(api, "save_week")).toEqual([]);
  });

  test("one new SPP line per Sync; the rest waits", async () => {
    const saved = week(null);
    saved.lines = [line(C, { "2026-10-12": { hours: 1, description: "d", note: "n", col: 5, origId: 2 } })];
    const api = fakeApi(week(null), [entry(3), entry(1, { id: "e2", task: C })], saved);
    const root = await mount(api);
    await click(btn(root, "Sync"));
    expect(api.save.mock.calls[0][0].map((w: any) => w.task)).toEqual([C]);
    expect(root.textContent).toContain("Sync again");
    expect(calls(api, "save_week")[0].entries.map((e: any) => e.id).sort()).toEqual(["e1", "e2"]);
    api.week = vi.fn(async () => saved); // the SPP page reloads after the save; the panel follows
    await act(async () => { api.tabChanged(); await flush(); });
    expect(root.textContent).toContain("Sync again");
  });

  test("locked week: Sync disabled, no question", async () => {
    const root = await mount(fakeApi(week(2, true), [entry(3)]));
    expect(btn(root, "Sync").disabled).toBe(true);
    expect(root.textContent).toContain("Locked");
    await click(btn(root, "Sync"));
    expect($(root, ".spp-question")).toBeNull();
  });

  test("the project list refreshes when stale; a failure keeps the panel", async () => {
    const api = fakeApi(week(2), [entry(2)], undefined, { projects: { updated: null, source: "recording", projects: [] } });
    await mount(api);
    expect(calls(api, "save_projects")).toHaveLength(1);
    api.catalog = vi.fn(async () => { throw new Error("project list not found on the page"); });
    const root = await mount(api);
    expect($(root, ".cell.same")).not.toBeNull();
    expect(root.textContent).toContain("Could not load projects from SPP");
  });
});

describe("grid", () => {
  test("weekends only when they hold hours; empty SPP lines stay, in SPP's order", async () => {
    const w = week(2);
    w.lines = [line("19: Training", {}, 1), { ...w.lines[0], row: 2 }, line(C, {}, 3)];
    const root = await mount(fakeApi(w, [entry(2), entry(1, { id: "e9", task: "8: Governance", date: "2026-10-17" })]));
    const heads = [...root.querySelectorAll("thead th")].map((t) => t.textContent);
    expect(heads.join(" ")).toContain("Sat 17");
    expect(heads.join(" ")).not.toContain("Sun");
    expect([...root.querySelectorAll("td.line b")].map((b) => b.textContent)).toEqual(["19: Training", T, C, "8: Governance"]);
  });

  test("totals count what SPP holds after Sync; green only at exactly 8 h", async () => {
    const root = await mount(fakeApi(week(2), [entry(2), entry(6, { id: "e6", task: C }), entry(3, { id: "e7", date: "2026-10-13" })]));
    const [, mon, tue, wed] = [...root.querySelectorAll("tr.totals td")];
    expect([mon.textContent, tue.textContent, wed.textContent]).toEqual(["8", "3", "0"]);
    expect([mon.className, tue.className, wed.className].map((c) => c.split(" ").pop())).toEqual(["ok", "short", "short"]);
  });

  test("rows are always grouped by project", async () => {
    const w = week(2);
    w.lines.push({ ...line("1: Internal meeting", {}, 2), project: "Example Co : Admin" });
    const root = await mount(fakeApi(w, [entry(2)]));
    expect([...root.querySelectorAll("tr.group .project")].map((r) => r.textContent)).toEqual([P, "Example Co : Admin"]);
    await click(btn(root, "⚙"));
    expect($(root, ".settings input[type=checkbox]")).toBeNull(); // no "Group by project" option any more
  });
});

describe("adding lines", () => {
  const plus = (root: HTMLElement, project: string) =>
    [...root.querySelectorAll("tr.group")].find((r) => r.querySelector(".project")!.textContent === project)!.querySelector("button.plus") as HTMLButtonElement;
  const lineNames = (root: HTMLElement) => [...root.querySelectorAll("td.line b")].map((b) => b.textContent);

  test("(+) adds an empty line to that project and it survives an automatic reload", () =>
    withClock(async () => {
      const api = fakeApi(week(2), [entry(2)]);
      const root = await mount(api);
      await click(plus(root, P));
      expect(btn(root, `${T} · ${Y}`)).toBeUndefined(); // already in the grid
      await click(btn(root, `${C} · ${Y}`));
      expect(lineNames(root)).toEqual([T, C]);
      api.stamp = "b";
      await tick();
      expect(api.week).toHaveBeenCalledTimes(2);
      expect(lineNames(root)).toEqual([T, C]);
    }));

  test("Add project offers only projects not in the grid, filtered by typing", async () => {
    const root = await mount(fakeApi(week(2), [entry(2)]));
    await click(btn(root, "+ Add project"));
    expect(btn(root, P)).toBeUndefined();
    await type($(root, "input[name=project_filter]"), "xyz");
    expect(btn(root, PTO.project)).toBeUndefined();
    await type($(root, "input[name=project_filter]"), "time");
    await click(btn(root, PTO.project));
    await click(btn(root, `${PTO.task} · ${PTO.time_type}`));
    expect([...root.querySelectorAll("tr.group .project")].map((r) => r.textContent)).toEqual([P, PTO.project]);
    expect(lineNames(root)).toEqual([T, PTO.task]);
  });

  test("an added line can be filled like any cell", async () => {
    const api = fakeApi(week(2), [entry(2)]);
    const root = await mount(api);
    await click(plus(root, P));
    await click(btn(root, `${C} · ${Y}`));
    const row = [...root.querySelectorAll("tr")].find((r) => r.querySelector("td.line b")?.textContent === C)!;
    await click(row.querySelectorAll("td.cell")[0]);
    await type($(root, "input[name=hours]"), "2");
    await type($(root, "input[name=description]"), "d");
    await type($(root, "input[name=note]"), "n");
    await leave($(root, "input[name=note]"));
    expect(calls(api, "set_cell")[0]).toMatchObject({ project: P, task: C, time_type: Y, date: "2026-10-12", hours: 2 });
  });
});

describe("live updates", () => {
  test("reloads when entries.csv or the SPP tab changes", () =>
    withClock(async () => {
      const api = fakeApi(week(2), [entry(3)]);
      await mount(api);
      await tick();
      expect(api.week).toHaveBeenCalledTimes(1); // nothing changed
      api.stamp = "b";
      await tick();
      expect(api.week).toHaveBeenCalledTimes(2);
      await act(async () => { api.tabChanged(); await flush(); });
      expect(api.week).toHaveBeenCalledTimes(3);
    }));

  test("unsaved typing in SPP blocks Sync at once, while polled, and right before Sync", () =>
    withClock(async () => {
      const api = fakeApi(week(null), [entry(3)]);
      const root = await mount(api);
      await act(async () => { api.pushUnsaved(true); });
      expect([btn(root, "Sync").disabled, !!$(root, ".ticker.unsaved")]).toEqual([true, true]);
      await act(async () => { api.pushUnsaved(false); });
      api.unsavedFlag = true;
      await tick();
      expect(btn(root, "Sync").disabled).toBe(true);
      api.unsavedFlag = false;
      await tick();
      api.unsavedFlag = true; // typed between the last check and the click
      await click(btn(root, "Sync"));
      expect(api.save).not.toHaveBeenCalled();
    }));
});

describe("editing a cell", () => {
  const field = (root: HTMLElement, name: string) => $(root, `.details input[name=${name}]`);

  test("saves when the focus leaves the fields — not between them, not without a change", async () => {
    const api = fakeApi(week(2), [entry(2)]);
    const root = await mount(api);
    await click($(root, ".cell.same"));
    expect([field(root, "hours").value, field(root, "description").value, field(root, "note").value]).toEqual(["2", "d", "n"]);
    await leave(field(root, "hours"));
    expect(calls(api, "set_cell")).toEqual([]);
    await type(field(root, "hours"), "3");
    await leave(field(root, "hours"), field(root, "note"));
    expect(calls(api, "set_cell")).toEqual([]);
    await leave(field(root, "note"));
    expect(calls(api, "set_cell")).toEqual([{
      cmd: "set_cell", date: "2026-10-12", project: P, task: T, time_type: Y, hours: 3, description: "d", note: "n", expected_ids: ["e1"],
    }]);
  });

  test("an empty cell can be filled (Enter saves); Remove entry deletes", async () => {
    const api = fakeApi(week(2), [entry(2)]);
    const root = await mount(api);
    await click($(root, "td.cell.empty"));
    expect(btn(root, "Remove entry").disabled).toBe(true);
    for (const [name, v] of [["hours", "1.5"], ["description", "x"], ["note", "y"]]) await type(field(root, name), v);
    await act(async () => { field(root, "note").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); await flush(); });
    expect(calls(api, "set_cell")[0]).toMatchObject({ date: "2026-10-13", hours: 1.5, expected_ids: [] });
    await click($(root, ".cell.same"));
    await click(btn(root, "Remove entry"));
    expect(calls(api, "set_cell")[1]).toMatchObject({ hours: null, expected_ids: ["e1"] });
  });

  test("a refused edit shows the reason", async () => {
    const api = fakeApi(week(2), [entry(2)]);
    const host = api.host;
    api.host = vi.fn(async (m: any) => (m.cmd === "set_cell" ? { ok: false, error: "hours must be a multiple of 0.5" } : host(m)));
    const root = await mount(api);
    await click($(root, ".cell.same"));
    await type(field(root, "hours"), "0.25");
    await leave(field(root, "hours"));
    expect(root.textContent).toContain("multiple of 0.5");
  });

  test("Restore SPP puts SPP's value back, also after a local deletion; disabled when equal", async () => {
    const same = await mount(fakeApi(week(2), [entry(2)]));
    await click($(same, ".cell.same"));
    expect(btn(same, "Restore SPP").disabled).toBe(true);
    const base = { week_start: DAYS[0], synced_at: "x", cells: { [[P, T, Y, "2026-10-12"].join("\u001f")]: { hours: 2, description: "d", note: "n" } } };
    const api = fakeApi(week(2), [], undefined, { base });
    const root = await mount(api);
    expect($(root, ".cell.toSpp").textContent).toBe("←–");
    await click($(root, ".cell.toSpp"));
    await click(btn(root, "Restore SPP"));
    expect(calls(api, "set_cell")[0]).toMatchObject({ hours: 2, description: "d", note: "n", expected_ids: [] });
  });

  test("clicking the open cell closes it; the cell box and the PTO form exclude each other", async () => {
    const api = fakeApi(week(2), [entry(2)]);
    api.aliases = { pto: PTO };
    const root = await mount(api);
    await click($(root, ".cell.same"));
    await click($(root, ".cell.same"));
    expect($(root, ".details").textContent).toMatch(/^Click a cell for details/);
    await click($(root, ".cell.same"));
    await click(btn(root, "Enter PTO"));
    expect([!!$(root, ".pto"), !!$(root, ".details .sync-status")]).toEqual([true, false]);
    await click($(root, ".cell.same"));
    expect([!!$(root, ".pto"), !!$(root, ".details .sync-status")]).toEqual([false, true]);
  });
});

describe("Enter PTO", () => {
  const ptoApi = (entries: LocalEntry[] = [entry(2)]) => { const api = fakeApi(week(2), entries); api.aliases = { pto: PTO }; return api; };
  const f = (root: HTMLElement, name: string) => $(root, `.pto [name=${name}]`);
  const amount = (root: HTMLElement, v: string) => $(root, `.pto input[name=amount][value=${v}]`);
  const open = async (api: any) => { const root = await mount(api); await click(btn(root, "Enter PTO")); return root; };

  test("needs a pto alias, and says so", async () => {
    const root = await mount(fakeApi(week(2), [entry(2)]));
    expect(btn(root, "Enter PTO").disabled).toBe(true);
    expect(btn(root, "Enter PTO").closest(".tip")!.getAttribute("data-tip")).toContain("pto");
  });

  test("one day: full by default, half or custom; existing PTO on that day is replaced", async () => {
    const old = entry(4, { id: "p1", date: "2026-10-14", project: PTO.project, task: PTO.task, time_type: PTO.time_type });
    const api = ptoApi([entry(2), old]);
    let root = await open(api);
    expect([f(root, "start").value, f(root, "end").value, f(root, "note").value, amount(root, "full").checked]).toEqual(["2026-10-12", "", "PTO", true]);
    await pick(f(root, "start"), "2026-10-14");
    await click(btn(root, "Save PTO"));
    expect(calls(api, "set_cell")[0]).toEqual({
      cmd: "set_cell", date: "2026-10-14", project: PTO.project, task: PTO.task, time_type: PTO.time_type,
      hours: 8, description: "PTO", note: "PTO", expected_ids: ["p1"],
    });
    await click(btn(root, "Enter PTO"));
    await click(amount(root, "half"));
    await click(btn(root, "Save PTO"));
    await click(btn(root, "Enter PTO"));
    await click(amount(root, "custom"));
    await type(f(root, "hours"), "2.5");
    await click(btn(root, "Save PTO"));
    expect(calls(api, "set_cell").map((m: any) => m.hours)).toEqual([8, 4, 2.5]);
  });

  test("a range allows full days only and writes each workday", async () => {
    const api = ptoApi();
    const root = await open(api);
    await pick(f(root, "start"), "2026-10-13");
    expect([...(f(root, "end") as unknown as HTMLSelectElement).options].map((o) => o.value)).toEqual(["", "2026-10-14", "2026-10-15", "2026-10-16"]);
    await click(amount(root, "half"));
    await pick(f(root, "end"), "2026-10-15");
    expect([amount(root, "full").checked, amount(root, "half").disabled, amount(root, "custom").disabled]).toEqual([true, true, true]);
    await click(btn(root, "Save PTO"));
    expect(calls(api, "set_cell").map((m: any) => [m.date, m.hours])).toEqual([["2026-10-13", 8], ["2026-10-14", 8], ["2026-10-15", 8]]);
  });

  test("Today only within the open week, explained otherwise", async () => {
    await withClock(async () => {
      const root = await open(ptoApi());
      await pick(f(root, "start"), "2026-10-12");
      await click(btn(root, "Today"));
      expect(f(root, "start").value).toBe("2026-10-14");
    }, new Date(2026, 9, 14, 10, 0));
    await withClock(async () => {
      const root = await open(ptoApi());
      expect(btn(root, "Today").disabled).toBe(true);
      expect(btn(root, "Today").closest(".tip")!.getAttribute("data-tip")).toContain("not a workday in this timesheet's week");
    }, new Date(2026, 10, 12, 10, 0));
  });

  test("Add a quote fills the note; Cancel closes without saving", async () => {
    const api = ptoApi();
    const root = await open(api);
    await click(btn(root, "Add a quote"));
    expect(QUOTES.some(([q, a]) => f(root, "note").value === `“${q}” — ${a}`)).toBe(true);
    await click(btn(root, "Cancel"));
    expect([!!$(root, ".pto"), calls(api, "set_cell").length]).toEqual([false, 0]);
  });
});

describe("data folder", () => {
  /** Folder access as Chrome reports it; activate() answers like requestPermission after a click. */
  function withFolder(api: any, state: string, after = "granted") {
    api.folder = {
      state: vi.fn(async () => state),
      activate: vi.fn(async () => (state = after)),
      choose: vi.fn(async () => ((state = "granted"), "Timesheetgate")),
      name: vi.fn(async () => (state === "none" ? null : "Timesheetgate")),
    };
    return api;
  }

  test("without a folder the panel asks to choose one, then loads", async () => {
    const api = withFolder(fakeApi(week(2), [entry(2)]), "none");
    const root = await mount(api);
    expect(calls(api, "week")).toHaveLength(0);
    await click(btn(root, "Choose folder"));
    expect(api.folder.choose).toHaveBeenCalled();
    expect($(root, ".cell.same")).not.toBeNull();
  });

  test("a stored folder loads on the first click anywhere, not before", async () => {
    const api = withFolder(fakeApi(week(2), [entry(2)]), "prompt");
    const root = await mount(api);
    expect(root.textContent).toContain("Click anywhere to load your timesheet file");
    expect(calls(api, "week")).toHaveLength(0);
    await click(root.querySelector("p")!);
    expect(api.folder.activate).toHaveBeenCalledTimes(1);
    expect($(root, ".cell.same")).not.toBeNull();
    expect(root.textContent).not.toContain("Click anywhere");
  });

  test("refused access offers another folder", async () => {
    const api = withFolder(fakeApi(week(2), [entry(2)]), "prompt", "denied");
    const root = await mount(api);
    await click(root.querySelector("p")!);
    expect(calls(api, "week")).toHaveLength(0);
    await click(btn(root, "Choose folder"));
    expect($(root, ".cell.same")).not.toBeNull();
  });

  test("Settings shows the folder, changes it, and refreshes the project list", async () => {
    const api = withFolder(fakeApi(week(2), [entry(2)]), "granted");
    const root = await mount(api);
    await click(btn(root, "⚙"));
    expect($(root, ".settings").textContent).toContain("Timesheetgate");
    const loads = calls(api, "week").length;
    await click(btn(root, "Change folder"));
    expect(api.folder.choose).toHaveBeenCalled();
    expect(calls(api, "week").length).toBe(loads + 1);
    await click(btn(root, "Sync project list"));
    expect(calls(api, "save_projects")).toHaveLength(1);
  });

  /** Chrome drops the grant a few seconds after the click (a side panel is not a tab). */
  function loseAccess(api: any) {
    const answer = api.host.getMockImplementation();
    api.lost = 0; // how many host calls still find no access
    api.host.mockImplementation(async (m: any) =>
      api.lost > 0 ? (api.lost--, { ok: false, needs_click: true, error: "Click in the panel to load your timesheet file." }) : answer(m));
  }

  test("access lost while idle: the grid stays, the bar asks for a click, the click reloads", () =>
    withClock(async () => {
      const api = withFolder(fakeApi(week(2), [entry(2)]), "granted");
      loseAccess(api);
      const root = await mount(api);
      api.lost = 1;
      await tick();
      expect(root.textContent).toContain("Click anywhere to load your timesheet file");
      expect($(root, ".cell.same")).not.toBeNull();
      expect(root.querySelectorAll(".error")).toHaveLength(0);
      expect($(root, ".ticker.off")).not.toBeNull(); // not watching entries.csv: the line stops
      const loads = calls(api, "week").length;
      await click($(root, ".bar"));
      expect(api.folder.activate).toHaveBeenCalled();
      expect(calls(api, "week").length).toBe(loads + 1);
      expect(root.textContent).not.toContain("Click anywhere");
      expect($(root, ".ticker.off")).toBeNull();
    }));

  test("Keep access opens the panel in a tab, where Chrome offers 'Allow on every visit'", async () => {
    const api = withFolder(fakeApi(week(2), [entry(2)]), "prompt");
    api.openTab = vi.fn();
    const root = await mount(api);
    await click(btn(root, "Keep access"));
    expect(api.openTab).toHaveBeenCalled();
  });

  test("access lost during Sync: after SPP saved, the click finishes entries.csv with the same write", async () => {
    const api = withFolder(fakeApi(week(null), [entry(3)], week(3)), "granted");
    loseAccess(api);
    const root = await mount(api);
    api.lost = 1;
    await click(btn(root, "Sync"));
    expect(api.save).toHaveBeenCalledTimes(1);
    expect(root.textContent).toContain("Click anywhere");
    expect(btn(root, "Sync").disabled).toBe(true);
    await click($(root, ".bar"));
    const [first, second] = calls(api, "save_week");
    expect(second).toEqual(first);
    expect(api.save).toHaveBeenCalledTimes(1);
    expect($(root, ".cell.same")).not.toBeNull();
    expect(root.textContent).toContain("Saved to SPP (not submitted).");
  });
});

describe("calendar", () => {
  const CAL = { generated: "x", start: "a", end: "b", events: [{ id: "m1" }, { id: "m2" }] };
  function withCalendar(api: any, url: string | null = "https://script.google.com/macros/s/X/exec") {
    api.calendar = {
      url: vi.fn(async () => url),
      setUrl: vi.fn(async (u: string) => { url = u; }),
      fetch: vi.fn(async () => CAL),
    };
    return api;
  }
  const local = (d: string) => new Date(d + "T00:00:00");

  test("on open: fetches the open timesheet's week once and saves it as calendar/<Sunday>.json", async () => {
    const api = withCalendar(fakeApi(week(2), [entry(2)]));
    const root = await mount(api);
    expect(api.calendar.fetch).toHaveBeenCalledWith("https://script.google.com/macros/s/X/exec", local("2026-10-11"), local("2026-10-18"));
    expect(calls(api, "save_calendar")).toEqual([{ cmd: "save_calendar", week_start: "2026-10-11", calendar: CAL }]);
    await act(async () => { api.tabChanged(); await flush(); });
    expect(api.calendar.fetch).toHaveBeenCalledTimes(1); // automatic reloads do not fetch again
    expect($(root, ".calendar-line").textContent).toContain("2 meetings"); // on the main screen
  });

  test("without a timesheet open it fetches the current week", () =>
    withClock(async () => {
      const api = withCalendar(fakeApi(null, []));
      const root = await mount(api);
      expect(api.calendar.fetch.mock.calls[0].slice(1)).toEqual([local("2026-11-08"), local("2026-11-15")]);
      expect(calls(api, "save_calendar")[0].week_start).toBe("2026-11-08");
      expect(btn(root, "Refresh calendar")).not.toBeUndefined();
    }, new Date("2026-11-12T10:00:00")));

  test("no address: nothing is fetched; saving one in Settings stores it and fetches", async () => {
    const api = withCalendar(fakeApi(week(2), [entry(2)]), null);
    const root = await mount(api);
    expect(api.calendar.fetch).not.toHaveBeenCalled();
    expect(btn(root, "Refresh calendar")).toBeUndefined(); // nothing to refresh yet
    await click(btn(root, "⚙"));
    await type($(root, "input[name=calendar_url]"), " https://script.google.com/macros/s/Y/exec ");
    await click(btn(root, "Save address"));
    expect(api.calendar.setUrl).toHaveBeenCalledWith("https://script.google.com/macros/s/Y/exec");
    expect(api.calendar.fetch.mock.calls[0][0]).toBe("https://script.google.com/macros/s/Y/exec");
  });

  test("Refresh calendar on the main screen fetches again; a failure shows there and the grid stays", async () => {
    const api = withCalendar(fakeApi(week(2), [entry(2)]));
    const root = await mount(api);
    api.calendar.fetch = vi.fn(async () => { throw new Error("Google did not return the calendar"); });
    await click(btn(root, "Refresh calendar"));
    expect(api.calendar.fetch).toHaveBeenCalledTimes(1);
    expect($(root, ".calendar-line").textContent).toContain("Google did not return the calendar");
    expect($(root, ".cell.same")).not.toBeNull();
    expect(calls(api, "save_calendar")).toHaveLength(1); // only the first, successful fetch
  });
});

describe("public holidays", () => {
  const HOLIDAY = { project: "Example Co : Time Off", task: "2: Company Holiday [Master Phase]", time_type: "Non-Billable" };
  const TUE = { date: "2026-10-13", title: "Struggle for Freedom and Democracy Day", country: "CZ", flag: "🇨🇿" };
  const head = (root: HTMLElement) => root.querySelector("th.holiday") as HTMLElement;

  test("holiday: the header opens the day; Enter 8 h writes the holiday line", async () => {
    const api = fakeApi(week(2), [entry(2)], undefined, { holidays: [TUE] });
    api.aliases = { holiday: HOLIDAY };
    const root = await mount(api);
    expect(head(root).textContent).toBe("Tue 13 🇨🇿🎉");
    expect(root.querySelectorAll("th.holiday")).toHaveLength(1);
    await click(head(root));
    expect(calls(api, "set_cell")).toEqual([]); // opening the day writes nothing
    expect($(root, ".day-view").textContent).toContain(TUE.title);
    await click(btn(root, "Enter 8 h"));
    expect(calls(api, "set_cell")).toEqual([{
      cmd: "set_cell", date: "2026-10-13", project: HOLIDAY.project, task: HOLIDAY.task, time_type: HOLIDAY.time_type,
      hours: 8, description: "Public holiday CZ", note: TUE.title, expected_ids: [],
    }]);
  });

  test("without a holiday alias, or when that day is entered already, Enter 8 h writes nothing", async () => {
    const api = fakeApi(week(2), [entry(2)], undefined, { holidays: [TUE] });
    const root = await mount(api);
    await click(head(root));
    expect($(root, ".day-view .tip").getAttribute("data-tip")).toContain("Needs a 'holiday' alias");
    expect(btn(root, "Enter 8 h").disabled).toBe(true);
    const done = fakeApi(week(2), [entry(2), entry(8, { id: "h1", date: TUE.date, project: HOLIDAY.project, task: HOLIDAY.task, time_type: HOLIDAY.time_type })],
      undefined, { holidays: [TUE] });
    done.aliases = { holiday: HOLIDAY };
    const root2 = await mount(done);
    await click(head(root2));
    expect(btn(root2, "Enter 8 h").disabled).toBe(true);
    expect([...calls(api, "set_cell"), ...calls(done, "set_cell")]).toEqual([]);
  });
});

describe("day view", () => {
  const meeting = (more: object = {}) => ({
    id: "m1", date: "2026-10-13", start: "2026-10-13T07:00:00.000Z", end: "2026-10-13T08:30:00.000Z",
    title: "Mapping workshop", hours: 1.5, attendees: 4, recurring: true, used: null, ...more,
  });
  const dayHead = (root: HTMLElement, text: string) => [...root.querySelectorAll("thead th")].find((t) => t.textContent!.startsWith(text)) as HTMLElement;

  test("clicking a day header shows that day's meetings; again closes it", async () => {
    const other = meeting({ id: "m2", date: "2026-10-14", title: "Wednesday call" });
    const root = await mount(fakeApi(week(2), [entry(2)], undefined, { meetings: [meeting(), other] }));
    await click(dayHead(root, "Tue 13"));
    const day = $(root, ".day-view");
    expect(day.textContent).toContain("Mapping workshop");
    expect(day.textContent).toContain("1.5 h");
    expect(day.textContent).toContain("4 people");
    expect(day.textContent).not.toContain("Wednesday call");
    await click(dayHead(root, "Tue 13"));
    expect($(root, ".day-view")).toBeNull();
  });

  test("used meetings are greyed with their line and cannot be added", async () => {
    const used = meeting({ used: { project: P, task: C, time_type: Y } });
    const root = await mount(fakeApi(week(2), [entry(2)], undefined, { meetings: [used] }));
    await click(dayHead(root, "Tue 13"));
    const card = $(root, ".day-view .meet.used");
    expect(card.textContent).toContain(`on ${C} ✓`);
    expect(card.querySelector("button")).toBeNull();
    expect(card.getAttribute("draggable")).not.toBe("true");
  });

  const answers = () => [
    meeting({ id: "a", title: "Corporate all-hands", status: "INVITED", start: "2026-10-13T06:00:00.000Z" }),
    meeting({ id: "b", title: "Maybe sync", status: "MAYBE", start: "2026-10-13T07:00:00.000Z" }),
    meeting({ id: "c", title: "Client call", status: "YES", start: "2026-10-13T08:00:00.000Z" }),
    meeting({ id: "d", title: "My workshop", status: "OWNER", start: "2026-10-13T09:00:00.000Z" }),
  ];
  const titles = (root: HTMLElement) => [...root.querySelectorAll(".day-view .meet b")].map((b) => b.textContent);

  test("meetings stay in time order, each with its answer as an icon", async () => {
    const root = await mount(fakeApi(week(2), [entry(2)], undefined, { meetings: answers() }));
    await click(dayHead(root, "Tue 13"));
    expect(titles(root)).toEqual(["Corporate all-hands", "Maybe sync", "Client call", "My workshop"]);
    const marks = [...root.querySelectorAll(".day-view .meet small")].map((m) => m.textContent!.split(" · ")[0]);
    expect(marks).toEqual(["?", "?", "✓", "★"]);
  });

  test("Only accepted is off by default; on, it hides the rest behind a count, and is remembered", async () => {
    localStorage.clear();
    const root = await mount(fakeApi(week(2), [entry(2)], undefined, { meetings: answers() }));
    await click(dayHead(root, "Tue 13"));
    const box = () => $(root, ".day-view input[name=only_accepted]");
    expect(box().checked).toBe(false);
    expect(titles(root)).toHaveLength(4);
    await click(box());
    expect(titles(root)).toEqual(["Client call", "My workshop"]);
    expect($(root, ".day-view").textContent).toContain("+2 not accepted (1 tentative, 1 not answered)");
    await click(btn(root, "show"));
    expect([titles(root).length, box().checked]).toEqual([4, false]);
    await click(box());
    const again = await mount(fakeApi(week(2), [entry(2)], undefined, { meetings: answers() }));
    await click(dayHead(again, "Tue 13"));
    expect(($(again, ".day-view input[name=only_accepted]")).checked).toBe(true);
    localStorage.clear();
  });

  test("day view, cell editor and PTO form exclude each other", async () => {
    const api = fakeApi(week(2), [entry(2)], undefined, { meetings: [meeting()] });
    api.aliases = { pto: PTO };
    const root = await mount(api);
    await click(dayHead(root, "Tue 13"));
    await click($(root, ".cell.same"));
    expect($(root, ".day-view")).toBeNull();
    await click(dayHead(root, "Tue 13"));
    expect($(root, ".editor input[name=hours]")).toBeNull();
    await click(btn(root, "Enter PTO"));
    expect($(root, ".day-view")).toBeNull();
  });
});

describe("calendar and grid", () => {
  test("a week's first calendar fetch shows its holidays without waiting for another reload", async () => {
    const TUE = { date: "2026-10-13", title: "Struggle for Freedom and Democracy Day", country: "CZ", flag: "🇨🇿" };
    const extra: any = { holidays: [] }; // the calendar file does not exist yet when the grid loads
    const api = fakeApi(week(2), [entry(2)], undefined, extra);
    api.calendar = {
      url: vi.fn(async () => "https://script.google.com/macros/s/X/exec"),
      setUrl: vi.fn(),
      // Google takes seconds: the fetch ends after the grid has loaded; then the file has the holiday.
      fetch: vi.fn(() => new Promise((resolve) => { done = () => { extra.holidays = [TUE]; resolve({ events: [] }); }; })),
    };
    let done = () => {};
    const root = await mount(api);
    expect(root.querySelector("th.holiday")).toBeNull();
    await act(async () => { done(); await flush(); await flush(); });
    expect(root.querySelector("th.holiday")?.textContent).toBe("Tue 13 🇨🇿🎉");
  });
});

describe("dropping a meeting", () => {
  const M = { id: "m1", date: "2026-10-13", start: "2026-10-13T07:00:00.000Z", end: "2026-10-13T07:45:00.000Z",
    title: "Mapping workshop", hours: 1, attendees: 4, recurring: false, used: null };
  const NOTES = { [[P, T, Y].join("\u001f")]: "Last note" };
  const fire = (el: Element, kind: string) =>
    act(async () => { el.dispatchEvent(new Event(kind, { bubbles: true, cancelable: true })); await flush(); });
  const dayHead = (root: HTMLElement) => [...root.querySelectorAll("thead th")].find((t) => t.textContent!.startsWith("Tue 13")) as HTMLElement;
  const row = (root: HTMLElement, task: string) => [...root.querySelectorAll("tr")].find((r) => r.querySelector("td.line b")?.textContent === task)!;
  const group = (root: HTMLElement, project: string) =>
    [...root.querySelectorAll("tr.group")].find((r) => r.querySelector(".project")!.textContent === project)!;
  /** Opens Tuesday, drags the meeting onto `target`. */
  async function drop(root: HTMLElement, target: (r: HTMLElement) => Element) {
    await click(dayHead(root));
    await fire($(root, ".day-view .meet[draggable]"), "dragstart");
    await fire(target(root), "dragover");
    await fire(target(root), "drop");
  }
  const enter = (el: Element) =>
    act(async () => { el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); await flush(); });
  const esc = (el: Element) =>
    act(async () => { el.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); await flush(); });
  const setup = (entries = [entry(2)], extra: object = {}) =>
    fakeApi(week(2), entries, undefined, { meetings: [M], last_notes: NOTES, hour_step: 0.5, ...extra });

  test("dropping on a line opens the box pre-filled; Enter writes the cell and marks the meeting", async () => {
    const api = setup();
    const root = await mount(api);
    await drop(root, (r) => row(r, T));
    expect([$(root, ".drop-box input[name=hours]").value, $(root, ".drop-box input[name=description]").value,
      $(root, ".drop-box input[name=note]").value]).toEqual(["1", "Mapping workshop", "Last note"]);
    await enter($(root, ".drop-box input[name=note]"));
    expect(calls(api, "set_cell")).toEqual([{ cmd: "set_cell", date: "2026-10-13", project: P, task: T, time_type: Y, hours: 1,
      description: "Mapping workshop", note: "Last note", expected_ids: [], meeting: { id: "m1", date: "2026-10-13" } }]);
    expect($(root, ".drop-box")).toBeNull();
  });

  test("dropping into a cell with hours adds them and joins the descriptions", async () => {
    const api = setup([entry(2), entry(2, { id: "e7", date: "2026-10-13", description: "a" })]);
    const root = await mount(api);
    await drop(root, (r) => row(r, T));
    await enter($(root, ".drop-box input[name=note]"));
    expect(calls(api, "set_cell")[0]).toMatchObject({ hours: 3, description: "a; Mapping workshop", expected_ids: ["e7"] });
  });

  test("the note is required: an empty note keeps the box open", async () => {
    const api = setup(undefined, { last_notes: {} });
    const root = await mount(api);
    await drop(root, (r) => row(r, T));
    await enter($(root, ".drop-box input[name=note]"));
    expect(calls(api, "set_cell")).toEqual([]);
    expect($(root, ".drop-box").textContent).toContain("note");
  });

  test("dropping on a project row asks for the new line first", async () => {
    const api = setup();
    const root = await mount(api);
    await drop(root, (r) => group(r, P));
    await click(btn(root, `${C} · ${Y}`));
    await type($(root, ".drop-box input[name=note]"), "n");
    await enter($(root, ".drop-box input[name=note]"));
    expect(calls(api, "set_cell")[0]).toMatchObject({ project: P, task: C, time_type: Y, hours: 1 });
  });

  test("dropping on Add project asks for the project, then the line", async () => {
    const api = setup();
    const root = await mount(api);
    await drop(root, (r) => btn(r, "+ Add project"));
    await click(btn(root, PTO.project));
    await click(btn(root, `${PTO.task} · ${PTO.time_type}`));
    await type($(root, ".drop-box input[name=note]"), "n");
    await enter($(root, ".drop-box input[name=note]"));
    expect(calls(api, "set_cell")[0]).toMatchObject({ project: PTO.project, task: PTO.task, time_type: PTO.time_type });
  });

  test("Add in the day view opens the box on a line you can change", async () => {
    const root = await mount(setup());
    await click(dayHead(root));
    await click(btn(root, "Add"));
    expect($(root, ".drop-box select[name=line]")).not.toBeNull();
  });

  test("over 24 h is refused: the box shows why, the meeting stays free", async () => {
    const api = setup([entry(2), entry(23.5, { id: "e9", date: "2026-10-13" })]);
    const answer = api.host.getMockImplementation();
    api.host.mockImplementation(async (m: any) =>
      m.cmd === "set_cell" ? { ok: false, error: "hours must be more than 0 and at most 24" } : answer(m));
    const root = await mount(api);
    await drop(root, (r) => row(r, T));
    await enter($(root, ".drop-box input[name=note]"));
    expect($(root, ".drop-box").textContent).toContain("at most 24");
    expect($(root, ".day-view .meet[draggable]")).not.toBeNull();
  });

  test("Esc closes the box without writing", async () => {
    const api = setup();
    const root = await mount(api);
    await drop(root, (r) => row(r, T));
    await esc($(root, ".drop-box input[name=hours]"));
    expect($(root, ".drop-box")).toBeNull();
    expect(calls(api, "set_cell")).toEqual([]);
  });
});

describe("opening another timesheet", () => {
  const NEXT = ["2026-10-18", "2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24"];
  /** The following week's timesheet, empty. */
  const nextWeek = (): SppWeek => ({ ...week(null), timesheetId: 8, days: NEXT, dayCols: Object.fromEntries(NEXT.map((d, i) => [d, i + 4])) });
  const open = (api: any, w: SppWeek) => act(async () => { api.week = vi.fn(async () => w); api.tabChanged(); await flush(); await flush(); });
  const dayHead = (root: HTMLElement, text: string) => [...root.querySelectorAll("thead th")].find((t) => t.textContent!.startsWith(text)) as HTMLElement;
  const localIso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  test("resets the open day, the picker, the question and lines added without hours", async () => {
    const api = fakeApi(week(3), [entry(2)], undefined,
      { base: { week_start: DAYS[0], synced_at: "x", cells: { [[P, T, Y, "2026-10-12"].join("\u001f")]: { hours: 2, description: "d", note: "n" } } } });
    const root = await mount(api);
    await click(btn(root, "Sync")); // SPP changed: the question opens
    expect($(root, ".spp-question")).not.toBeNull();
    await click([...root.querySelectorAll("tr.group button.plus")][0]);
    await click(btn(root, `${C} · ${Y}`)); // an added line without hours
    await click(dayHead(root, "Tue 13"));
    await open(api, nextWeek());
    expect([$(root, ".spp-question"), $(root, ".day-view"), $(root, ".picker")]).toEqual([null, null, null]);
    expect([...root.querySelectorAll("td.line b")].map((b) => b.textContent)).not.toContain(C);
  });

  test("the same timesheet reloading keeps what is open", async () => {
    const api = fakeApi(week(2), [entry(2)]);
    const root = await mount(api);
    await click(dayHead(root, "Tue 13"));
    await open(api, week(2));
    expect($(root, ".day-view")).not.toBeNull();
  });

  const withFetch = (api: any) => {
    api.calendar = { url: vi.fn(async () => "https://script.google.com/macros/s/X/exec"), setUrl: vi.fn(),
      fetch: vi.fn(async () => ({ events: [] })) };
    return api;
  };
  const fetched = (api: any) => api.calendar.fetch.mock.calls.map((c: any[]) => localIso(c[1]));
  const later = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
  const HOUR = 3600e3;

  test("another week's timesheet fetches its week; back and forth within the hour does not", () =>
    withClock(async () => {
      const api = withFetch(fakeApi(week(2), [entry(2)]));
      await mount(api);
      await open(api, nextWeek());
      await open(api, week(2));
      await open(api, nextWeek());
      expect(fetched(api)).toEqual(["2026-10-11", "2026-10-18"]);
      await later(HOUR);
      await open(api, week(2)); // an hour later: that week is fetched again
      expect(fetched(api).filter((w: string) => w === "2026-10-11")).toHaveLength(2);
    }));

  test("left open, the week on screen is fetched again once an hour", () =>
    withClock(async () => {
      const api = withFetch(fakeApi(week(2), [entry(2)]));
      await mount(api);
      await later(HOUR - 60e3);
      expect(fetched(api)).toEqual(["2026-10-11"]);
      await later(2 * 60e3);
      expect(fetched(api)).toEqual(["2026-10-11", "2026-10-11"]);
    }));
});
