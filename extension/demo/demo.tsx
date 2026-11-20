// Store screenshots: the real side panel with made-up data (no real customers, projects or
// people). Build and shoot with `node demo/shoot.js`; ?scene=week or ?scene=meetings.
import { render } from "preact";
import { App, type Api } from "../src/sidepanel/App";
import type { Catalog, SppLine, SppWeek } from "../src/core/types";

const DAYS = ["2026-11-15", "2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21"];
const IMPL = "Northwind Traders : Implementation", ADMIN = "Example Co : Admin", OFF = "Example Co : Time Off";
const SEP = "\u001f";

const line = (row: number, project: string, task: string, timeType: string, cells: Record<string, [number, string, string]>): SppLine => ({
  row, projectId: `1:${row}`, project, taskId: String(row), task, timeTypeId: timeType === "Billable" ? "9" : "7", timeType,
  cells: Object.fromEntries(Object.entries(cells).map(([d, [hours, description, note]], i) =>
    [d, { hours, description, note, col: DAYS.indexOf(d) + 4, origId: row * 10 + i }])),
});

// What SPP holds (and held at the last Sync).
const LINES = [
  line(1, IMPL, "13: Configuration", "Billable", { "2026-11-16": [4, "Schema setup", "Data load configuration"], "2026-11-18": [3, "Field mapping", "Data load configuration"] }),
  line(2, IMPL, "12: Integration Support", "Billable", { "2026-11-16": [3, "Export review", "Integration"] }),
  line(3, ADMIN, "1: Internal meeting", "Non-Billable", { "2026-11-16": [1, "Team meetings", "Internal sync"] }),
];
const WEEK: SppWeek = {
  timesheetId: 4711, days: DAYS, dayCols: Object.fromEntries(DAYS.map((d, i) => [d, i + 4])),
  lines: LINES, emptyRow: 4, locked: false, message: null, errors: [],
};
const base = { week_start: DAYS[0], synced_at: "2026-11-17T08:00:00Z",
  cells: Object.fromEntries(LINES.flatMap((l) => Object.entries(l.cells).map(([d, c]) =>
    [[l.project, l.task, l.timeType, d].join(SEP), { hours: c.hours, description: c.description, note: c.note }]))) };

// The local timelog: what SPP has, plus this week's new hours (they show as "will be saved to SPP").
let n = 0;
const entry = (project: string, task: string, time_type: string, date: string, hours: number, description: string, note: string) =>
  ({ id: `e${++n}`, date, project, task, time_type, hours, description, note });
const ENTRIES = [
  ...LINES.flatMap((l) => Object.entries(l.cells).map(([d, c]) => entry(l.project, l.task, l.timeType, d, c.hours, c.description, c.note))),
  entry(OFF, "2: Company Holiday", "Non-Billable", "2026-11-17", 8, "Public holiday CZ", "Struggle for Freedom and Democracy Day"),
  entry(IMPL, "12: Integration Support", "Billable", "2026-11-18", 3, "Weekly sync; API review", "Integration"),
  entry(ADMIN, "1: Internal meeting", "Non-Billable", "2026-11-18", 0.5, "Team standup", "Internal sync"),
  entry(IMPL, "13: Configuration", "Billable", "2026-11-19", 5, "Validation rules", "Data load configuration"),
  entry(IMPL, "12: Integration Support", "Billable", "2026-11-19", 2, "Export pipeline", "Integration"),
  entry(ADMIN, "1: Internal meeting", "Non-Billable", "2026-11-19", 1, "Planning", "Internal sync"),
];

const CATALOG: Catalog = {
  updated: new Date().toISOString(), source: "extension", time_type_ids: { Billable: "9", "Non-Billable": "7" },
  projects: [
    { name: IMPL, id: "1:2", time_types: ["Billable"], tasks: [
      { name: "8: Project Management", id: "8", time_types: ["Billable"] },
      { name: "12: Integration Support", id: "12", time_types: ["Billable"] },
      { name: "13: Configuration", id: "13", time_types: ["Billable"] }] },
    { name: ADMIN, id: "1:3", time_types: ["Non-Billable"], tasks: [{ name: "1: Internal meeting", id: "1", time_types: ["Non-Billable"] }] },
    { name: OFF, id: "1:4", time_types: ["Non-Billable"], tasks: [
      { name: "1: PTO", id: "21", time_types: ["Non-Billable"] }, { name: "2: Company Holiday", id: "22", time_types: ["Non-Billable"] }] },
  ],
};

const meeting = (id: string, title: string, start: string, end: string, hours: number, attendees: number, status: string,
  recurring = false, used: any = null) => ({ id, date: "2026-11-18", start, end, title, hours, attendees, recurring, status, used });
const MEETINGS = [
  meeting("m1", "Weekly sync — Northwind", "2026-11-18T08:00:00.000Z", "2026-11-18T09:00:00.000Z", 1, 6, "YES", true,
    { project: IMPL, task: "12: Integration Support", time_type: "Billable" }),
  meeting("m2", "Mapping workshop", "2026-11-18T12:00:00.000Z", "2026-11-18T13:30:00.000Z", 1.5, 4, "YES"),
  meeting("m3", "Team standup", "2026-11-18T14:30:00.000Z", "2026-11-18T15:00:00.000Z", 0.5, 7, "OWNER", true,
    { project: ADMIN, task: "1: Internal meeting", time_type: "Non-Billable" }),
  meeting("m4", "Q4 kickoff — all hands", "2026-11-18T16:00:00.000Z", "2026-11-18T17:00:00.000Z", 1, 240, "INVITED"),
];

const api: Api = {
  week: async () => WEEK,
  async host(msg: any) {
    if (msg.cmd === "week") return {
      ok: true, entries: ENTRIES.filter((e) => e.date >= DAYS[0] && e.date <= DAYS[6]), base, projects: CATALOG, stamp: "1",
      aliases: { pto: { project: OFF, task: "1: PTO", time_type: "Non-Billable" }, holiday: { project: OFF, task: "2: Company Holiday", time_type: "Non-Billable" } },
      holidays: [{ date: "2026-11-17", title: "Struggle for Freedom and Democracy Day", country: "CZ", flag: "🇨🇿" }],
      meetings: MEETINGS, last_notes: { [[IMPL, "13: Configuration", "Billable"].join(SEP)]: "Data load configuration" }, hour_step: 0.5,
    };
    return msg.cmd === "stamp" ? { ok: true, stamp: "1" } : { ok: true };
  },
  catalog: async () => CATALOG,
  save: async () => ({ errors: [], message: null, week: WEEK }),
  reload: async () => {},
  unsaved: async () => false,
  calendar: {
    url: async () => "https://script.google.com/macros/s/demo/exec",
    setUrl: async () => {},
    fetch: async () => ({ events: Array.from({ length: 31 }, (_, i) => ({ id: `x${i}` })) }),
  },
};

render(<App api={api} />, document.getElementById("app")!);

// Scenes for the screenshots: the week, or Wednesday's meetings.
const scene = new URLSearchParams(location.search).get("scene") ?? "week";
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
(async () => {
  await wait(400);
  if (scene === "meetings") {
    const wed = [...document.querySelectorAll("thead th")].find((t) => t.textContent!.startsWith("Wed 18"))!;
    (wed as HTMLElement).click();
    await wait(100);
  }
  await wait(200);
  document.body.dataset.ready = "1";
})();
