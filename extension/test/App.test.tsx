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
  return {
    week: vi.fn(async () => w),
    host: vi.fn(async (msg: any) =>
      msg.cmd === "week" ? { ok: true, entries, base: null, projects: FRESH } : { ok: true }),
    catalog: vi.fn(async () => FRESH),
    save: vi.fn(async () => ({ errors: [], message: "The timesheet was saved.", week: after ?? w })),
    reload: vi.fn(async () => {}),
  };
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
});
