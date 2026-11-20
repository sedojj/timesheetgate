// One day under the grid: its public holiday and its meetings. Meetings can be added (or
// dragged onto a line); used ones show the line they went to.
import { useState } from "preact/hooks";
import type { Holiday } from "../core/holidays";
import type { Meeting } from "../core/meetings";

const ONLY_KEY = "timelog.onlyAccepted";
/** Your answer as an icon: ✓ accepted, ★ organizer, ? tentative or not answered. */
const ICON: Record<string, string> = { YES: "✓", OWNER: "★" };
const iconOf = (status: string) => ICON[status] ?? "?";
const accepted = (status: string) => status in ICON;

const time = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

export function DayView(props: {
  date: string;
  holiday: Holiday | undefined;
  holidayTip: string;
  canEnterHoliday: boolean;
  meetings: Meeting[];
  onEnterHoliday(): void;
  onAdd(m: Meeting): void;
  onDragStart(m: Meeting): void;
}) {
  const [only, setOnly] = useState(() => localStorage.getItem(ONLY_KEY) === "1");
  const setOnlyAccepted = (on: boolean) => {
    localStorage.setItem(ONLY_KEY, on ? "1" : "0");
    setOnly(on);
  };
  // In time order (as they come); "Only accepted" hides the rest behind a count.
  const hidden = only ? props.meetings.filter((m) => !accepted(m.status)) : [];
  const shown = only ? props.meetings.filter((m) => accepted(m.status)) : props.meetings;
  const tentative = hidden.filter((m) => m.status === "MAYBE").length;
  const title = new Date(props.date + "T12:00:00").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
  return (
    <div class="details day-view">
      <div class="day-head">
        <span>
          <b>{title}</b>
          {props.meetings.length > 0 && <small> — drag a meeting onto a line, or click Add</small>}
        </span>
        {props.meetings.length > 0 && (
          <label class="option only-accepted">
            <input type="checkbox" name="only_accepted" checked={only} onClick={() => setOnlyAccepted(!only)} />
            Only accepted
          </label>
        )}
      </div>
      {props.holiday && (
        <div class="meet holiday">
          <span>
            {props.holiday.flag}🎉 <b>Public holiday</b>
            <small>{props.holiday.title}</small>
          </span>
          <span class="tip" data-tip={props.holidayTip}>
            <button disabled={!props.canEnterHoliday} onClick={props.onEnterHoliday}>Enter 8 h</button>
          </span>
        </div>
      )}
      {shown.map((m) => {
        const info = `${iconOf(m.status)} · ${time(m.start)}–${time(m.end)} · ${m.hours} h${m.attendees ? ` · ${m.attendees} people` : ""}${m.recurring ? " · recurring" : ""}`; // no guests shown: a hidden list
        if (m.used)
          return (
            <div class="meet used">
              <span><b>{m.title}</b><small>{`on ${m.used.task} ✓`}</small></span>
            </div>
          );
        return (
          <div class="meet" draggable onDragStart={() => props.onDragStart(m)}>
            <span><span class="grip">⠿</span><b>{m.title}</b><small>{info}</small></span>
            <button onClick={() => props.onAdd(m)}>Add</button>
          </div>
        );
      })}
      {hidden.length > 0 && (
        <p class="hint">
          {`+${hidden.length} not accepted (${[tentative && `${tentative} tentative`, hidden.length - tentative && `${hidden.length - tentative} not answered`].filter(Boolean).join(", ")}) `}
          <button onClick={() => setOnlyAccepted(false)}>show</button>
        </p>
      )}
      {!props.holiday && !props.meetings.length && <p class="hint">No meetings on this day.</p>}
    </div>
  );
}
