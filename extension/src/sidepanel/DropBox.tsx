// The box a dropped (or added) meeting opens: the line, then hours / description / note, all
// pre-filled from the user's own data. Enter saves, Esc cancels.
import { useState } from "preact/hooks";
import type { LineRef } from "../core/lines";
import type { Meeting } from "../core/meetings";
import type { Catalog } from "../core/types";
import { LinePicker } from "./LinePicker";

export type DropTarget = { line: LineRef } | { project: string } | { newProject: true };

const keyOf = (l: LineRef) => [l.project, l.task, l.timeType].join("\u001f");

export function DropBox(props: {
  meeting: Meeting;
  target: DropTarget;
  catalog: Catalog;
  taken: LineRef[]; // the grid's lines: offered when dropped on a line, excluded when picking a new one
  lastNotes: Record<string, string>;
  hourStep: number;
  error: string | null; // a refusal from the store, shown here
  onSave(line: LineRef, hours: number, description: string, note: string): void;
  onCancel(): void;
}) {
  const [line, setLine] = useState<LineRef | null>("line" in props.target ? props.target.line : null);
  const [hours, setHours] = useState(String(props.meeting.hours));
  const [description, setDescription] = useState(props.meeting.title);
  const [note, setNote] = useState(line ? props.lastNotes[keyOf(line)] ?? "" : "");
  const [problem, setProblem] = useState<string | null>(null);

  const pick = (l: LineRef) => {
    setLine(l);
    setNote(props.lastNotes[keyOf(l)] ?? "");
  };
  const save = () => {
    if (!line) return;
    const h = Number(hours.replace(",", "."));
    if (!hours.trim() || Number.isNaN(h)) return setProblem("Enter the hours.");
    if (Math.abs(h / props.hourStep - Math.round(h / props.hourStep)) > 1e-9) return setProblem(`Hours in steps of ${props.hourStep} (SPP rounds to it).`);
    if (!description.trim()) return setProblem("Enter a description (SPP needs one).");
    if (!note.trim()) return setProblem("Enter a note (SPP needs one).");
    setProblem(null);
    props.onSave(line, h, description.trim(), note.trim());
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") props.onCancel();
    else if (e.key === "Enter" && line) save();
  };

  const head = <b>{props.meeting.title} → {new Date(props.meeting.date + "T12:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric" })}</b>;
  if (!line) {
    const project = "project" in props.target ? props.target.project : null;
    return (
      <div class="drop-box" onKeyDown={onKeyDown}>
        {head}
        <LinePicker catalog={props.catalog} project={project} taken={props.taken} onPick={pick} onCancel={props.onCancel} />
      </div>
    );
  }
  return (
    <div class="details drop-box editor" onKeyDown={onKeyDown}>
      {head}
      {"line" in props.target ? (
        <label>
          Line
          <select name="line" value={keyOf(line)} onChange={(e) => pick(props.taken.find((l) => keyOf(l) === e.currentTarget.value)!)}>
            {props.taken.map((l) => <option value={keyOf(l)}>{`${l.task} · ${l.timeType}`}</option>)}
          </select>
        </label>
      ) : (
        <p>New line: {line.task} · {line.timeType} ({line.project})</p>
      )}
      <label>Hours <input name="hours" inputMode="decimal" value={hours} onInput={(e) => setHours(e.currentTarget.value)} /></label>
      <label>Description <input name="description" value={description} onInput={(e) => setDescription(e.currentTarget.value)} /></label>
      <label>Note <input name="note" value={note} placeholder="SPP needs a note" onInput={(e) => setNote(e.currentTarget.value)} /></label>
      {(problem ?? props.error) && <p class="error">{problem ?? props.error}</p>}
      <button onClick={save}>Add to timesheet</button>
      <button onClick={props.onCancel}>Cancel</button>
    </div>
  );
}
