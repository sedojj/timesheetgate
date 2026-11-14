// Lines a project can still get (task + time type), from the project list (projects.json).
import type { Catalog } from "./types";

export type LineRef = { project: string; task: string; timeType: string };

/** In project-list order; a line already taken is never offered; an empty time type never is. */
export function freeLines(catalog: Catalog, project: string, taken: LineRef[]): { task: string; timeType: string }[] {
  const p = catalog.projects.find((x) => x.name === project);
  if (!p) return [];
  const has = new Set(taken.filter((l) => l.project === project).map((l) => `${l.task}\u001f${l.timeType}`));
  return p.tasks.flatMap((t) =>
    (t.time_types?.length ? t.time_types : p.time_types)
      .filter((timeType) => timeType && !has.has(`${t.name}\u001f${timeType}`))
      .map((timeType) => ({ task: t.name, timeType })),
  );
}
