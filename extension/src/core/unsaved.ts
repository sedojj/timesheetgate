// Detects typing in the SPP grid that is not saved yet: form inputs that differ from
// the page model (what SPP holds). A Sync would drop such typing, so the panel blocks it.
import type { SppWeek } from "./types";

export function unsavedChanges(formFields: [string, string][], week: SppWeek): string[] {
  const byRow = new Map(week.lines.map((l) => [l.row, l]));
  const dayCols = new Set(Object.values(week.dayCols));
  const changed: string[] = [];
  for (const [name, value] of formFields) {
    const m = /^_c(\d+)_r(\d+)$/.exec(name);
    if (!m) continue;
    const [col, row] = [Number(m[1]), Number(m[2])];
    const line = byRow.get(row);
    let differs: boolean;
    if (dayCols.has(col)) {
      const saved = line ? Object.values(line.cells).find((c) => c.col === col)?.hours ?? 0 : 0;
      const typed = value.trim() === "" ? 0 : Number(value.replace(",", "."));
      differs = Number.isNaN(typed) || Math.abs(typed - saved) >= 0.005;
    } else if (!line) {
      differs = col === 1 ? value !== ":" && value !== "" : false; // a started new line
    } else {
      const ids: Record<number, string> = { 1: line.projectId, 2: line.taskId, 3: line.timeTypeId };
      differs = col in ids && value !== ids[col];
    }
    if (differs) changed.push(name);
  }
  return changed;
}
