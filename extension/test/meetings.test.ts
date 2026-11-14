// Meetings of a week's calendar file: the same rules as cli/timelog_store.py meetings_of.
process.env.TZ = "Europe/Prague"; // UTC+1 in November; local dates must not depend on the machine
import { expect, test } from "vitest";
import { meetingsOf, roundUp } from "../src/core/meetings";
import type { LocalEntry } from "../src/core/types";

const ev = (id: string, start: string, end: string, more: object = {}) => ({
  id, start, end, all_day: false, title: id, description: "", attendees: ["a@x.test", "b@x.test"],
  my_status: "YES", recurring: false, ...more,
});
const EVENTS = [
  ev("m45", "2026-11-17T08:00:00.000Z", "2026-11-17T08:45:00.000Z"),
  ev("m20", "2026-11-17T09:00:00.000Z", "2026-11-17T09:20:00.000Z"),
  ev("no", "2026-11-17T10:00:00.000Z", "2026-11-17T11:00:00.000Z", { my_status: "NO" }),
  ev("day", "2026-11-16T23:00:00.000Z", "2026-11-17T23:00:00.000Z", { all_day: true }),
  { id: "h", holiday: true, date: "2026-11-17", title: "Holiday", description: "Public holiday", start: "x", end: "x", all_day: true },
  ev("r1", "2026-11-17T12:00:00.000Z", "2026-11-17T13:00:00.000Z", { recurring: true }),
  ev("r1", "2026-11-18T12:00:00.000Z", "2026-11-18T13:00:00.000Z", { recurring: true }),
  ev("late", "2026-11-17T22:30:00.000Z", "2026-11-17T23:30:00.000Z"),
];
const LINE = { project: "P", task: "T", time_type: "Y" };
const entry = (date: string, hours = 1): LocalEntry =>
  ({ id: "e", date, project: "P", task: "T", time_type: "Y", hours, description: "d", note: "n" });
const byId = (ms: ReturnType<typeof meetingsOf>, date: string) => Object.fromEntries(ms.filter((m) => m.date === date).map((m) => [m.id, m]));

test("only real meetings, with hours rounded up to the step", () => {
  const ms = byId(meetingsOf({ events: EVENTS }, {}, [], 0.5), "2026-11-17");
  expect(Object.keys(ms).sort()).toEqual(["late", "m20", "m45", "r1"]);
  expect([ms.m45.hours, ms.m20.hours, ms.m45.attendees, ms.m45.used]).toEqual([1, 0.5, 2, null]);
  expect(roundUp(1, 0.5)).toBe(1);
});

test("a late meeting belongs to the day it starts", () => {
  expect(meetingsOf({ events: EVENTS }, {}, [], 0.5).find((m) => m.id === "late")!.date).toBe("2026-11-17");
});

test("used while its cell has hours; a recurring meeting only on that day", () => {
  const used = { "m45|2026-11-17": LINE, "r1|2026-11-17": LINE };
  const ms = meetingsOf({ events: EVENTS }, used, [entry("2026-11-17")], 0.5);
  expect(byId(ms, "2026-11-17").m45.used).toEqual(LINE);
  expect(byId(ms, "2026-11-18").r1.used).toBeNull();
  expect(byId(meetingsOf({ events: EVENTS }, used, [], 0.5), "2026-11-17").m45.used).toBeNull(); // cell emptied
});

test("no calendar file means no meetings", () => {
  expect(meetingsOf(null, {}, [], 0.5)).toEqual([]);
});
