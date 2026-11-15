// Meetings from a week's calendar file, and whether each is "used": the same rules as
// cli/timelog_store.py meetings_of. Used = a calendar/used.json record AND that cell has hours.
import type { LocalEntry } from "./types";

export type UsedLine = { project: string; task: string; time_type: string };
export type Meeting = {
  id: string;
  date: string; // the local day it starts
  start: string;
  end: string;
  title: string;
  hours: number; // length rounded up to the hour step
  attendees: number;
  recurring: boolean;
  status: string; // your answer, as Google gives it: YES, MAYBE, INVITED (not answered), OWNER
  used: UsedLine | null;
};

export const roundUp = (hours: number, step: number) => Math.ceil(hours / step - 1e-9) * step;

const localDay = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** Real meetings only: not declined, not all-day, not public holidays. */
export function meetingsOf(calendar: { events: any[] } | null, used: Record<string, UsedLine>, entries: LocalEntry[], step: number): Meeting[] {
  return (calendar?.events ?? [])
    .filter((e) => !e.holiday && !e.all_day && e.my_status !== "NO")
    .map((e) => {
      const date = localDay(e.start);
      const line = used[`${e.id}|${date}`] ?? null;
      const hasHours = line && entries.some((x) => x.date === date && x.project === line.project && x.task === line.task
        && x.time_type === line.time_type && x.hours > 0);
      return {
        id: e.id, date, start: e.start, end: e.end, title: e.title ?? "",
        hours: roundUp((Date.parse(e.end) - Date.parse(e.start)) / 3600e3, step),
        attendees: (e.attendees ?? []).length, recurring: !!e.recurring, status: e.my_status ?? "INVITED", used: hasHours ? line : null,
      };
    })
    .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
}
