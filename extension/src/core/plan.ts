// Three-way sync plan: SPP now, local entries.csv, and the base from the last sync.
import type { BaseWeek, Cell, CellPlan, LocalEntry, SppWeek, Write } from "./types";

const SEP = "\u001f";
const UNRESOLVABLE = new Set(["locked", "duplicate SPP lines"]);

export function cellKey(project: string, task: string, timeType: string, date: string): string {
  return [project, task, timeType, date].join(SEP);
}

type Meta = { project: string; task: string; timeType: string; date: string };
const metaOf = (key: string): Meta => {
  const [project, task, timeType, date] = key.split(SEP);
  return { project, task, timeType, date };
};
const lineOf = (m: Meta) => [m.project, m.task, m.timeType].join(SEP);

/** SPP keeps hours with 2 decimals; so do we, to avoid 0.30000000000000004. */
export const round2 = (h: number) => Math.round(h * 100) / 100;

function equal(a: Cell | null, b: Cell | null): boolean {
  if (!a || !b) return a === b;
  return Math.abs(a.hours - b.hours) < 0.005 && a.description.trim() === b.description.trim() && a.note.trim() === b.note.trim();
}

function joinUnique(parts: string[]): string {
  return [...new Set(parts.map((p) => p.trim()).filter(Boolean))].join("; ");
}

function merge(cells: Cell[]): Cell {
  return {
    hours: round2(cells.reduce((s, c) => s + c.hours, 0)),
    description: joinUnique(cells.map((c) => c.description)),
    note: joinUnique(cells.map((c) => c.note)),
  };
}

function group<T>(items: [string, T][]): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const [k, v] of items) m.set(k, [...(m.get(k) ?? []), v]);
  return m;
}

export function plan(spp: SppWeek, local: LocalEntry[], base: BaseWeek | null): CellPlan[] {
  const days = new Set(spp.days);
  const lineCount = group(spp.lines.map((l) => [[l.project, l.task, l.timeType].join(SEP), l] as [string, unknown]));
  const dupLines = new Set([...lineCount].filter(([, ls]) => ls.length > 1).map(([k]) => k));

  const sppCells = group(
    spp.lines.flatMap((l) =>
      Object.entries(l.cells).map(([d, c]) => [cellKey(l.project, l.task, l.timeType, d), { hours: c.hours, description: c.description, note: c.note }] as [string, Cell]),
    ),
  );
  const localCells = group(
    local.filter((e) => days.has(e.date)).map((e) => [cellKey(e.project, e.task, e.time_type, e.date), { hours: e.hours, description: e.description, note: e.note }] as [string, Cell]),
  );
  const baseCells = base?.cells ?? {};

  const keys = new Set([...sppCells.keys(), ...localCells.keys(), ...Object.keys(baseCells).filter((k) => days.has(metaOf(k).date))]);
  const plans: CellPlan[] = [...keys].map((key) => {
    const meta = metaOf(key);
    const s = sppCells.has(key) ? merge(sppCells.get(key)!) : null;
    const l = localCells.has(key) ? merge(localCells.get(key)!) : null;
    const b = baseCells[key] ?? null;
    let state: CellPlan["state"];
    let reason: string | undefined;
    if (dupLines.has(lineOf(meta))) [state, reason] = ["conflict", "duplicate SPP lines"];
    else if (equal(s, l)) state = "same";
    else if (equal(s, b)) state = "toSpp";
    else if (equal(l, b)) state = "toLocal";
    else state = "conflict";
    if (state === "toSpp" && spp.locked) [state, reason] = ["conflict", "locked"];
    if (state === "toSpp" && l && (!l.description.trim() || !l.note.trim())) [state, reason] = ["invalid", "description and note are required"];
    return { key, ...meta, state, ...(reason ? { reason } : {}), spp: s, local: l, base: b };
  });
  return plans.sort((x, y) => (x.key < y.key ? -1 : x.key > y.key ? 1 : 0));
}

export function resolve(
  plans: CellPlan[],
  choices: Record<string, "spp" | "local">,
  local: LocalEntry[],
  newId: () => string,
): { writes: Write[]; localWeek: LocalEntry[] } {
  const writes: Write[] = [];
  const replace = new Map<string, LocalEntry | null>();
  const open = plans.filter((p) => p.state === "conflict" && !UNRESOLVABLE.has(p.reason ?? "") && !choices[p.key]);
  if (open.length) throw new Error("unresolved conflicts");

  for (const p of plans) {
    const choice = p.state === "conflict" && !UNRESOLVABLE.has(p.reason ?? "") ? choices[p.key] : undefined;
    if (p.state === "toSpp" || choice === "local") {
      writes.push({ project: p.project, task: p.task, timeType: p.timeType, date: p.date, value: p.local });
    } else if (p.state === "toLocal" || choice === "spp") {
      replace.set(
        p.key,
        p.spp && { id: newId(), date: p.date, project: p.project, task: p.task, time_type: p.timeType, ...p.spp },
      );
    }
  }

  const localWeek: LocalEntry[] = [];
  for (const e of local) {
    const key = cellKey(e.project, e.task, e.time_type, e.date);
    if (!replace.has(key)) localWeek.push(e);
  }
  for (const e of replace.values()) if (e) localWeek.push(e);
  return { writes, localWeek };
}

/** The SPP side of a week as the base for the next three-way plan. */
export function baseOf(spp: SppWeek, now: string): BaseWeek {
  const cells: Record<string, Cell> = {};
  for (const l of spp.lines)
    for (const [d, c] of Object.entries(l.cells))
      cells[cellKey(l.project, l.task, l.timeType, d)] = { hours: c.hours, description: c.description, note: c.note };
  return { week_start: spp.days[0], synced_at: now, cells };
}
