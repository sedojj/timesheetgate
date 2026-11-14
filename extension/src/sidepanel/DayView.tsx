// One day under the grid: its public holiday and its meetings. Meetings can be added (or
// dragged onto a line); used ones show the line they went to.
import type { Holiday } from "../core/holidays";
import type { Meeting } from "../core/meetings";

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
  const title = new Date(props.date + "T12:00:00").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
  return (
    <div class="details day-view">
      <b>{title}</b>
      {props.meetings.length > 0 && <small> — drag a meeting onto a line, or click Add</small>}
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
      {props.meetings.map((m) => {
        const info = `${time(m.start)}–${time(m.end)} · ${m.hours} h · ${m.attendees} people${m.recurring ? " · recurring" : ""}`;
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
      {!props.holiday && !props.meetings.length && <p class="hint">No meetings on this day.</p>}
    </div>
  );
}
