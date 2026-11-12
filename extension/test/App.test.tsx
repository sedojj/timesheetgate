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

  test("a conflict needs a chosen side before Sync", async () => {
    const root = await mount(fakeApi(week(2), [entry(3)]));
    expect(btn(root, "Sync").disabled).toBe(true);
    await click($(root, ".cell.conflict"));
    await click(btn(root, "Use local"));
    expect(btn(root, "Sync").disabled).toBe(false);
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

  test("a locked week cannot sync", async () => {
    const root = await mount(fakeApi(week(2, true), [entry(3)]));
    expect(btn(root, "Sync").disabled).toBe(true);
    expect(root.textContent).toContain("Locked");
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

  test("group by project makes one section per project and is remembered", async () => {
    localStorage.clear();
    const w = week(2);
    w.lines.push({ ...line("1: Internal meeting", {}, 2), project: "Example Co : Admin" });
    const root = await mount(fakeApi(w, [entry(2)]));
    await click(btn(root, "⚙"));
    await click($(root, ".settings input[type=checkbox]"));
    expect([...root.querySelectorAll("tr.group")].map((r) => r.textContent)).toEqual([P, "Example Co : Admin"]);
    expect((await mount(fakeApi(w, [entry(2)]))).querySelectorAll("tr.group")).toHaveLength(2);
    localStorage.clear();
  });
});

describe("live updates", () => {
  test("reloads when entries.csv or the SPP tab changes, keeping chosen sides", () =>
    withClock(async () => {
      const api = fakeApi(week(2), [entry(3)]);
      const root = await mount(api);
      await click($(root, ".cell.conflict"));
      await click(btn(root, "Use local"));
      await tick();
      expect(api.week).toHaveBeenCalledTimes(1); // nothing changed
      api.stamp = "b";
      await tick();
      expect(api.week).toHaveBeenCalledTimes(2);
      expect($(root, ".cell.conflict").textContent).toContain("(local)");
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
    expect($(root, ".details").textContent).toBe("Click a cell for details.");
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
