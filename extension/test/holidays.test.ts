// Public holidays from the week's calendar file (Google's holiday calendars in the user's list).
import { expect, test } from "vitest";
import { holidaysOf } from "../src/core/holidays";

const day = (more: object) => ({
  id: "h", date: "2026-11-17", title: "Struggle for Freedom and Democracy Day", description: "Public holiday",
  all_day: true, holiday: true, calendar: "Holidays in Czechia", calendar_id: "en.czech#holiday@group.v.calendar.google.com", ...more,
});

test("days off only, with the country code and flag from Google's calendar id", () => {
  const events = [
    { id: "m1", title: "a meeting", start: "x" },
    day({}),
    day({ id: "o", date: "2026-11-18", title: "Some Day", description: "Observance" }),
  ];
  expect(holidaysOf({ events })).toEqual([
    { date: "2026-11-17", title: "Struggle for Freedom and Democracy Day", country: "CZ", flag: "🇨🇿" },
  ]);
});

test("a two-letter region is the code itself; an unknown region falls back to the calendar's name", () => {
  expect(holidaysOf({ events: [day({ calendar_id: "en.sk#holiday@group.v.calendar.google.com" })] })[0])
    .toMatchObject({ country: "SK", flag: "🇸🇰" });
  expect(holidaysOf({ events: [day({ calendar_id: "en.atlantis#holiday@group.v.calendar.google.com", calendar: "Holidays in Atlantis" })] })[0])
    .toMatchObject({ country: "Atlantis", flag: "" });
});

test("no calendar file means no holidays", () => {
  expect(holidaysOf(null)).toEqual([]);
});
