// Turns the page's embedded `oa_model_timesheet` JSON into an SppWeek.
import type { SppCell, SppLine, SppWeek } from "./types";

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'" };

function decode(s: string): string {
  return s.replace(/&(#\d+|#x[0-9a-f]+|\w+);/gi, (m, e: string) => {
    if (ENTITIES[e]) return ENTITIES[e];
    if (e[0] === "#") return String.fromCodePoint(e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return m;
  });
}

function selected(html: string): { id: string; name: string } {
  const m = /<option[^>]*selected="selected"[^>]*value="([^"]*)"[^>]*>([^<]*)/.exec(html);
  return m ? { id: m[1], name: decode(m[2]).trim() } : { id: "", name: "" };
}

function cellPos(name: string): { col: number; row: number } {
  const m = /^_c(\d+)_r(\d+)$/.exec(name);
  if (!m) throw new Error(`unexpected field name: ${name}`);
  return { col: Number(m[1]), row: Number(m[2]) };
}

export function parseModel(model: any, hasSaveButton: boolean): SppWeek {
  const rows: any[] = model.rows ?? [];
  const firstFields: any[] = (rows[0] ?? model.empty_rows?.[0])?.fields ?? [];
  const dayCols: Record<string, number> = {};
  for (const f of firstFields) if (f.type === "day") dayCols[f.date] = cellPos(f.name).col;

  const lines: SppLine[] = rows.map((r) => {
    const popups = r.fields.filter((f: any) => f.type === "popup");
    const [project, task, timeType] = popups.map((f: any) => selected(f.html));
    const cells: Record<string, SppCell> = {};
    let row = 0;
    for (const f of r.fields) {
      if (f.type !== "day") continue;
      const pos = cellPos(f.name);
      row = pos.row;
      if (f.value === "" || f.value === null || f.value === undefined) continue;
      const data = f.details?.data ?? {};
      cells[f.date] = {
        hours: Number(f.value),
        description: data.description ?? "",
        note: data.notes ?? "",
        col: pos.col,
        origId: f.orig_id ?? null,
      };
    }
    return {
      row,
      projectId: project.id,
      project: project.name,
      taskId: task.id,
      task: task.name,
      timeTypeId: timeType.id,
      timeType: timeType.name,
      cells,
    };
  });

  const emptyName: string | undefined = model.empty_rows?.[0]?.fields?.[0]?.name;
  return {
    timesheetId: model.timesheet_id,
    days: Object.keys(dayCols).sort(),
    dayCols,
    lines,
    emptyRow: emptyName ? Number(/_r(\d+)$/.exec(emptyName)![1]) : null,
    locked: !hasSaveButton,
    message: model.message?.text ?? null,
    errors: model.errors ?? [],
  };
}
