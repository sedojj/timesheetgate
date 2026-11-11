import { render } from "preact";
import { act } from "preact/test-utils";
import { describe, expect, test, vi } from "vitest";
import { App, type Api } from "../src/sidepanel/App";
import type { Catalog, LocalEntry, SppWeek } from "../src/core/types";
import { CATALOG } from "./fixtures/catalog";

const DAYS = ["2026-10-11", "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17"];
const P = "Acme Corp : Acme Impl", T = "15: Testing Support [Validate]", Y = "Billable";
const FRESH: Catalog = { ...CATALOG, updated: new Date().toISOString() };

function week(hours: number | null, locked = false): SppWeek {
  return {
    timesheetId: 7, days: DAYS, dayCols: Object.fromEntries(DAYS.map((d, i) => [d, i + 4])),
    lines: hours === null ? [] : [{
      row: 1, projectId: "1160:11372", project: P, taskId: "259870", task: T, timeTypeId: "9", timeType: Y,
      cells: { "2026-10-12": { hours, description: "d", note: "n", col: 5, origId: 1 } },
    }],
    emptyRow: 2, locked, message: null, errors: [],
  };
}
const entry = (hours: number): LocalEntry =>
  ({ id: "e1", date: "2026-10-12", project: P, task: T, time_type: Y, hours, description: "d", note: "n" });

function fakeApi(w: SppWeek | null, entries: LocalEntry[], after?: SppWeek): any {
  const api: any = {
    stamp: "a",
    week: vi.fn(async () => w),
    host: vi.fn(async (msg: any) =>
      msg.cmd === "week" ? { ok: true, entries, base: null, projects: FRESH, stamp: "a" }
      : msg.cmd === "stamp" ? { ok: true, stamp: api.stamp } : { ok: true }),
    catalog: vi.fn(async () => FRESH),
    save: vi.fn(async () => ({ errors: [], message: "The timesheet was saved.", week: after ?? w })),
    reload: vi.fn(async () => {}),
    onTabChange: (cb: () => void) => { api.tabChanged = cb; },
    unsavedFlag: false,
    unsaved: vi.fn(async () => api.unsavedFlag),
    onUnsaved: (cb: (u: boolean) => void) => { api.pushUnsaved = cb; },
  };
  return api;
}

async function mount(api: Api) {
  const root = document.createElement("div");
  document.body.appendChild(root);
  await act(async () => { render(<App api={api} />, root); });
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  return root;
}
const syncButton = (root: HTMLElement) =>
  [...root.querySelectorAll("button")].find((b) => b.textContent === "Sync") as HTMLButtonElement;

describe("App", () => {
  test("shows hint without a timesheet", async () => {
    const root = await mount(fakeApi(null, []));
    expect(root.textContent).toContain("Open a timesheet in SuiteProjects Pro");
  });

  test("renders states; choosing a side enables Sync", async () => {
    const root = await mount(fakeApi(week(2), [entry(3)]));
    const c = root.querySelector(".cell.conflict") as HTMLElement;
    expect(c).not.toBeNull();
    expect(syncButton(root).disabled).toBe(true);
    await act(async () => { c.click(); });
    expect(syncButton(root).disabled).toBe(true);
    const useMine = [...root.querySelectorAll("button")].find((b) => b.textContent === "Use mine")!;
    await act(async () => { useMine.click(); });
    expect(syncButton(root).disabled).toBe(false);
  });

  test("sync writes then saves the week", async () => {
    const api = fakeApi(week(null), [entry(3)], week(3));
    const root = await mount(api);
    expect(root.querySelector(".cell.toSpp")).not.toBeNull();
    await act(async () => { syncButton(root).click(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(api.save).toHaveBeenCalledTimes(1);
    expect(api.save.mock.calls[0][0]).toEqual([
      { project: P, task: T, timeType: Y, date: "2026-10-12", value: { hours: 3, description: "d", note: "n" } },
    ]);
    const saveWeek = api.host.mock.calls.map((c: any[]) => c[0]).find((m: any) => m.cmd === "save_week");
    expect(saveWeek.timesheet_id).toBe(7);
    expect(saveWeek.entries).toEqual([entry(3)]);
    expect(saveWeek.loaded_ids).toEqual(["e1"]);
    expect(Object.values(saveWeek.base.cells)).toEqual([{ hours: 3, description: "d", note: "n" }]);
    expect(api.reload).toHaveBeenCalled();
  });

  test("SPP errors stop the sync", async () => {
    const api = fakeApi(week(null), [entry(3)]);
    api.save = vi.fn(async () => ({ errors: ["1. Notes are required"], message: null, week: null }));
    const root = await mount(api);
    await act(async () => { syncButton(root).click(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(root.textContent).toContain("Notes are required");
    expect(api.host.mock.calls.some((c: any[]) => c[0].cmd === "save_week")).toBe(false);
  });

  test("locked disables sync", async () => {
    const root = await mount(fakeApi(week(2, true), [entry(3)]));
    expect(syncButton(root).disabled).toBe(true);
    expect(root.textContent).toContain("Locked");
  });

  test("stale projects list is refreshed", async () => {
    const api = fakeApi(week(2), [entry(2)]);
    api.host = vi.fn(async (msg: any) =>
      msg.cmd === "week" ? { ok: true, entries: [entry(2)], base: null, projects: { updated: null, source: "recording", projects: [] } } : { ok: true });
    await mount(api);
    expect(api.catalog).toHaveBeenCalledTimes(1);
    expect(api.host.mock.calls.some((c: any[]) => c[0].cmd === "save_projects")).toBe(true);
  });

  test("SPP changed since loading aborts the sync", async () => {
    const api = fakeApi(week(null), [entry(3)]);
    api.week = vi.fn().mockResolvedValueOnce(week(null)).mockResolvedValue(week(5));
    const root = await mount(api);
    await act(async () => { syncButton(root).click(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(api.save).not.toHaveBeenCalled();
    expect(root.textContent).toContain("SPP changed since the panel loaded");
  });

  test("one new line per sync", async () => {
    const C = "13: Configuration/Data Loads [Model]";
    const other = { ...entry(1), id: "e2", task: C };
    const saved = week(1);
    saved.lines[0] = { ...saved.lines[0], task: C, taskId: "259868" };
    const api = fakeApi(week(null), [entry(3), other], saved);
    const root = await mount(api);
    await act(async () => { syncButton(root).click(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(api.save.mock.calls[0][0].map((w: any) => w.task)).toEqual([C]);
    expect(root.textContent).toContain("Sync again");
    const saveWeek = api.host.mock.calls.map((c: any[]) => c[0]).find((m: any) => m.cmd === "save_week");
    expect(saveWeek.entries.map((e: any) => e.id).sort()).toEqual(["e1", "e2"]);
  });

  test("a save SPP did not keep is an error", async () => {
    const api = fakeApi(week(null), [entry(3)], week(null));
    const root = await mount(api);
    await act(async () => { syncButton(root).click(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(root.textContent).toContain("SPP did not keep");
    expect(api.host.mock.calls.some((c: any[]) => c[0].cmd === "save_week")).toBe(false);
  });

  test("after a save the plan comes from SPP's answer", async () => {
    const api = fakeApi(week(null), [entry(3)], week(3));
    const root = await mount(api);
    await act(async () => { syncButton(root).click(); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(api.week).toHaveBeenCalledTimes(2);
    expect(root.querySelector(".cell.same")).not.toBeNull();
    expect(root.querySelector(".cell.toSpp")).toBeNull();
  });

  test("a failed projects load keeps the panel usable", async () => {
    const api = fakeApi(week(2), [entry(2)]);
    api.host = vi.fn(async (msg: any) =>
      msg.cmd === "week" ? { ok: true, entries: [entry(2)], base: null, projects: { ...FRESH, updated: null } } : { ok: true });
    api.catalog = vi.fn(async () => { throw new Error("project list not found on the page"); });
    const root = await mount(api);
    expect(root.querySelector(".cell.same")).not.toBeNull();
    expect(root.textContent).toContain("Could not load projects from SPP");
  });

  test("clicking a cell shows its line and values", async () => {
    const root = await mount(fakeApi(week(null), [entry(3)]));
    expect(root.querySelector(".details")).toBeNull();
    await act(async () => { (root.querySelector(".cell.toSpp") as HTMLElement).click(); });
    const d = root.querySelector(".details")!.textContent!;
    expect(d).toContain(T);
    expect(d).toContain("Mine: 3 h — d / n");
    expect(d).toContain("SPP: none");
    expect(root.querySelector(".details h4")!.textContent).toBe("Sync status");
    expect(d.indexOf("Sync status")).toBeLessThan(d.indexOf("Sync writes this to SPP"));
  });

  test("line labels are not cut", async () => {
    const root = await mount(fakeApi(week(2), [entry(2)]));
    const label = root.querySelector("td.line")!.textContent!;
    expect(label).toContain(T);
    expect(label).toContain("Acme Impl");
  });

  describe("live updates", () => {
    test("reloads when entries.csv changes, not otherwise", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        const api = fakeApi(week(2), [entry(2)]);
        await mount(api);
        await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
        expect(api.week).toHaveBeenCalledTimes(1);
        api.stamp = "b";
        await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
        expect(api.week).toHaveBeenCalledTimes(2);
      } finally {
        vi.useRealTimers();
      }
    });

    test("reloads when the SPP tab changes", async () => {
      const api = fakeApi(week(2), [entry(2)]);
      await mount(api);
      await act(async () => { api.tabChanged(); await new Promise((r) => setTimeout(r, 0)); });
      expect(api.week).toHaveBeenCalledTimes(2);
    });

    test("a pending choice blocks the auto-reload and shows a notice", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        const api = fakeApi(week(2), [entry(3)]);
        const root = await mount(api);
        await act(async () => { (root.querySelector(".cell.conflict") as HTMLElement).click(); });
        const useMine = [...root.querySelectorAll("button")].find((b) => b.textContent === "Use mine")!;
        await act(async () => { useMine.click(); });
        api.stamp = "b";
        await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
        expect(api.week).toHaveBeenCalledTimes(1);
        expect(root.textContent).toContain("entries.csv changed");
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("weekend", () => {
    const headers = (root: HTMLElement) => [...root.querySelectorAll("thead th")].map((t) => t.textContent);
    test("hidden by default", async () => {
      localStorage.clear();
      const root = await mount(fakeApi(week(2), [entry(2)]));
      expect(headers(root)).toHaveLength(6);
      expect(headers(root).join(" ")).not.toContain("Sun");
    });
    test("shown when a weekend day has hours", async () => {
      localStorage.clear();
      const root = await mount(fakeApi(week(2), [entry(2), { ...entry(1), id: "e9", date: "2026-10-17" }]));
      expect(headers(root)).toHaveLength(7); // Saturday has hours; Sunday stays hidden
      expect(headers(root).join(" ")).toContain("Sat 17");
    });
    test("checkbox shows it and is remembered", async () => {
      localStorage.clear();
      const root = await mount(fakeApi(week(2), [entry(2)]));
      const box = root.querySelector("input[type=checkbox]") as HTMLInputElement;
      await act(async () => { box.click(); });
      expect(headers(root)).toHaveLength(8);
      const again = await mount(fakeApi(week(2), [entry(2)]));
      expect(headers(again)).toHaveLength(8);
      localStorage.clear();
    });
  });

  test("the ticker restarts on every check and turns amber while held", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const api = fakeApi(week(2), [entry(3)]);
      const root = await mount(api);
      const tick = () => root.querySelector(".ticker")!.getAttribute("data-tick");
      const first = tick();
      await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
      expect(tick()).not.toBe(first);
      expect(root.querySelector(".ticker.held")).toBeNull();
      await act(async () => { (root.querySelector(".cell.conflict") as HTMLElement).click(); });
      const useMine = [...root.querySelectorAll("button")].find((b) => b.textContent === "Use mine")!;
      await act(async () => { useMine.click(); });
      expect(root.querySelector(".ticker.held")).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  test("SPP lines without hours are shown, in SPP's order", async () => {
    const w = week(2);
    const empty = { ...w.lines[0], row: 2, task: "13: Configuration/Data Loads [Model]", taskId: "259868", cells: {} };
    const first = { ...w.lines[0], row: 1, task: "19: Client Training [Governance]", taskId: "1", cells: {} };
    w.lines = [first, w.lines[0], empty].map((l, i) => ({ ...l, row: i + 1 }));
    const local = { ...entry(1), id: "e5", task: "8: Project Management/Governance [Governance]" };
    const root = await mount(fakeApi(w, [entry(2), local]));
    const rows = [...root.querySelectorAll("td.line b")].map((b) => b.textContent);
    expect(rows).toEqual([
      "19: Client Training [Governance]", T, "13: Configuration/Data Loads [Model]",
      "8: Project Management/Governance [Governance]",
    ]);
  });

  test("totals row: what SPP will hold after Sync, green at 8 h", async () => {
    const C = "13: Configuration/Data Loads [Model]";
    const extra = { ...entry(6), id: "e6", task: C }; // toSpp: counts with my value
    const tue = { ...entry(3), id: "e7", date: "2026-10-13" };
    const root = await mount(fakeApi(week(2), [entry(2), extra, tue]));
    const totals = [...root.querySelectorAll("tr.totals td")];
    expect(totals[0].textContent).toBe("Total");
    const mon = totals[1], tueCell = totals[2], wed = totals[3];
    expect(mon.textContent).toBe("8");
    expect(mon.className).toContain("ok");
    expect(tueCell.textContent).toBe("3");
    expect(tueCell.className).toContain("short");
    expect(wed.textContent).toBe("0");
    expect(wed.className).toContain("short");
  });

  describe("unsaved typing in SPP", () => {
    test("stops the ticker red and blocks a red Sync button", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        const api = fakeApi(week(null), [entry(3)]);
        const root = await mount(api);
        expect(syncButton(root).disabled).toBe(false);
        api.unsavedFlag = true;
        await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
        expect(root.querySelector(".ticker.unsaved")).not.toBeNull();
        expect(syncButton(root).disabled).toBe(true);
        expect(syncButton(root).className).toContain("danger");
        expect(root.textContent).toContain("Unsaved changes in SPP");
        api.unsavedFlag = false;
        await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
        expect(root.querySelector(".ticker.unsaved")).toBeNull();
        expect(syncButton(root).disabled).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });

    test("checked again right before Sync", async () => {
      const api = fakeApi(week(null), [entry(3)]);
      const root = await mount(api);
      api.unsavedFlag = true;
      await act(async () => { syncButton(root).click(); });
      await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
      expect(api.save).not.toHaveBeenCalled();
      expect(root.textContent).toContain("Unsaved changes in SPP");
    });
  
    test("typing in SPP stops the ticker immediately", async () => {
      const api = fakeApi(week(null), [entry(3)]);
      const root = await mount(api);
      await act(async () => { api.pushUnsaved(true); });
      expect(root.querySelector(".ticker.unsaved")).not.toBeNull();
      expect(root.textContent).toContain("Unsaved changes in SPP — save or discard them first");
      await act(async () => { api.pushUnsaved(false); });
      expect(root.querySelector(".ticker.unsaved")).toBeNull();
    });
  });
});
