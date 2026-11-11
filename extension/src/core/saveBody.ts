// Builds the POST body for the timesheet's own Save: the form's fields, our writes,
// and the per-cell dialog fields the page adds at submit time. Never a submit.
import type { Catalog, Cell, SppWeek, Write } from "./types";

type Pair = [string, string];
const SEP = "\u001f";

function ids(catalog: Catalog, w: Write): [string, string, string] {
  const project = catalog.projects.find((p) => p.name === w.project);
  if (!project) throw new Error(`not in projects list: ${w.project}`);
  const task = project.tasks.find((t) => t.name === w.task);
  if (!task) throw new Error(`not in projects list: ${w.task}`);
  const timeType = catalog.time_type_ids[w.timeType];
  if (!timeType) throw new Error(`not in projects list: ${w.timeType}`);
  return [project.id, task.id, timeType];
}

export function saveBody(formFields: Pair[], week: SppWeek, writes: Write[], catalog: Catalog): Pair[] {
  const body: Pair[] = formFields.filter(([k]) => !/^_c\d+_r\d+_dialog_/.test(k)).map(([k, v]) => [k, v]);
  const set = (k: string, v: string) => {
    const hit = body.filter((p) => p[0] === k);
    if (hit.length) hit.forEach((p) => (p[1] = v));
    else body.push([k, v]);
  };

  // Final cell values per row/column, starting from what SPP holds.
  const cells = new Map<string, Cell | null>(); // "row,col" → value
  for (const line of week.lines) for (const c of Object.values(line.cells)) cells.set(`${line.row},${c.col}`, c);

  const lineRow = new Map(week.lines.map((l) => [[l.project, l.task, l.timeType].join(SEP), l.row]));
  let nextRow = week.emptyRow ?? Math.max(0, ...week.lines.map((l) => l.row)) + 1;
  for (const w of writes) {
    const lineKey = [w.project, w.task, w.timeType].join(SEP);
    let row = lineRow.get(lineKey);
    if (row === undefined) {
      const [projectId, taskId, timeTypeId] = ids(catalog, w);
      row = nextRow++;
      lineRow.set(lineKey, row);
      set(`_c1_r${row}`, projectId);
      set(`_c2_r${row}`, taskId);
      set(`_c3_r${row}`, timeTypeId);
      for (const col of Object.values(week.dayCols)) set(`_c${col}_r${row}`, "");
    }
    const col = week.dayCols[w.date];
    if (col === undefined) throw new Error(`date not in this timesheet: ${w.date}`);
    set(`_c${col}_r${row}`, w.value ? String(w.value.hours) : "");
    cells.set(`${row},${col}`, w.value);
  }

  for (const [pos, c] of cells) {
    if (!c) continue;
    const [row, col] = pos.split(",");
    body.push([`_c${col}_r${row}_dialog_description`, c.description]);
    body.push([`_c${col}_r${row}_dialog_notes`, c.note]);
    // Read-only "time off request" field; the page sends "undefined" for cells it has no value for.
    body.push([`_c${col}_r${row}_dialog_sri`, "undefined"]);
  }
  set("_form_has_changed", "1");
  body.push(["_save_grid", "Save"]);
  return body;
}
