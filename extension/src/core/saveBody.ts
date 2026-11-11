// Builds the POST body for the timesheet's own Save: the form's fields, our writes,
// and the per-cell dialog fields the page adds at submit time. Never a submit.
import { round2 } from "./plan";
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

export const MAX_NEW_LINES_ERROR = "one new line per save; Sync again for the next";

export function saveBody(formFields: Pair[], week: SppWeek, writes: Write[], catalog: Catalog): Pair[] {
  if (formFields.some(([k]) => /submit/i.test(k))) throw new Error("refusing to send a submit field");
  const body: Pair[] = formFields.filter(([k]) => !/^_c\d+_r\d+_dialog_/.test(k)).map(([k, v]) => [k, v]);

  // Grid values come from the page model (what SPP holds), never from inputs the user
  // may have typed into without saving.
  const byRow = new Map(week.lines.map((l) => [l.row, l]));
  const dayCol = new Set(Object.values(week.dayCols));
  for (const pair of body) {
    const m = /^_c(\d+)_r(\d+)$/.exec(pair[0]);
    if (!m) continue;
    const [col, row] = [Number(m[1]), Number(m[2])];
    const line = byRow.get(row);
    if (line) {
      if (col === 1) pair[1] = line.projectId;
      else if (col === 2) pair[1] = line.taskId;
      else if (col === 3) pair[1] = line.timeTypeId;
      else if (dayCol.has(col)) {
        const c = Object.values(line.cells).find((x) => x.col === col);
        pair[1] = c ? String(round2(c.hours)) : "";
      }
    } else if (dayCol.has(col)) pair[1] = "";
    else if (col === 1) pair[1] = ":";
    else if (col === 2) pair[1] = "0";
  }
  const set = (k: string, v: string) => {
    const hit = body.filter((p) => p[0] === k);
    if (hit.length) hit.forEach((p) => (p[1] = v));
    else body.push([k, v]);
  };

  // Final cell values per row/column, starting from what SPP holds.
  const cells = new Map<string, Cell | null>(); // "row,col" → value
  for (const line of week.lines) for (const c of Object.values(line.cells)) cells.set(`${line.row},${c.col}`, c);

  const lineRow = new Map(week.lines.map((l) => [[l.project, l.task, l.timeType].join(SEP), l.row]));
  // SPP renders one empty row; whether it takes more new rows in one save is not verified yet.
  let free = week.emptyRow === null ? 0 : 1;
  let nextRow = week.emptyRow ?? 0;
  for (const w of writes) {
    const lineKey = [w.project, w.task, w.timeType].join(SEP);
    let row = lineRow.get(lineKey);
    if (row === undefined) {
      const [projectId, taskId, timeTypeId] = ids(catalog, w);
      if (free-- <= 0) throw new Error(MAX_NEW_LINES_ERROR);
      row = nextRow++;
      lineRow.set(lineKey, row);
      set(`_c1_r${row}`, projectId);
      set(`_c2_r${row}`, taskId);
      set(`_c3_r${row}`, timeTypeId);
      for (const col of Object.values(week.dayCols)) set(`_c${col}_r${row}`, "");
    }
    const col = week.dayCols[w.date];
    if (col === undefined) throw new Error(`date not in this timesheet: ${w.date}`);
    set(`_c${col}_r${row}`, w.value ? String(round2(w.value.hours)) : "");
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
