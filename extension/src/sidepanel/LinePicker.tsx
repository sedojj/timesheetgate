// Pick a new line: the project (when not given), then a task + time type the project lacks.
import { useState } from "preact/hooks";
import { freeLines, type LineRef } from "../core/lines";
import type { Catalog } from "../core/types";

export function LinePicker(props: {
  catalog: Catalog;
  project: string | null; // null: "Add project", choose a project not in the grid first
  taken: LineRef[];
  onPick(line: LineRef): void;
  onCancel(): void;
}) {
  const [project, setProject] = useState(props.project);
  const [filter, setFilter] = useState("");
  const inGrid = new Set(props.taken.map((l) => l.project));

  if (!project) {
    const projects = props.catalog.projects
      .map((p) => p.name)
      .filter((n) => !inGrid.has(n) && n.toLowerCase().includes(filter.trim().toLowerCase()));
    return (
      <div class="details picker">
        <b>Add a project</b>
        <input name="project_filter" placeholder="Filter projects" value={filter} onInput={(e) => setFilter(e.currentTarget.value)} />
        {projects.map((n) => <button class="choice" onClick={() => setProject(n)}>{n}</button>)}
        {!projects.length && <p class="hint">No project in your project list matches. (Sync project list in ⚙ refreshes it.)</p>}
        <button onClick={props.onCancel}>Cancel</button>
      </div>
    );
  }
  const lines = freeLines(props.catalog, project, props.taken);
  return (
    <div class="details picker">
      <b>New line in {project}</b>
      {lines.map((l) => (
        <button class="choice" onClick={() => props.onPick({ project, task: l.task, timeType: l.timeType })}>
          {`${l.task} · ${l.timeType}`}
        </button>
      ))}
      {!lines.length && <p class="hint">This project has all its lines in the grid already.</p>}
      <button onClick={props.onCancel}>Cancel</button>
    </div>
  );
}
