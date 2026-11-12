// The data folder: same files and rules as cli/timelog_store.py. The panel sends the messages
// the native host used to answer; handle() answers them over a Dir (the folder the user chose).
import { formatCsv, parseCsv } from "./csv";
import type { LocalEntry } from "./types";

export type Dir = {
  /** null when the file does not exist; stamp changes whenever the file changes. */
  read(name: string): Promise<{ text: string; stamp: string } | null>;
  /** Replaces the whole file (never leaves a partial one). */
  write(name: string, text: string): Promise<void>;
};

const FIELDS = ["id", "date", "project", "task", "time_type", "hours", "description", "note"] as const;
const NOTE_REQUIRED = "description and note are required (SPP rejects the save otherwise)";
const DEFAULT_CONFIG = { hours_per_day: 8, workdays: [0, 1, 2, 3, 4], hour_step: 0.5 };

async function readJson(dir: Dir, name: string, fallback: any): Promise<any> {
  const f = await dir.read(name);
  return f ? JSON.parse(f.text) : fallback;
}
const writeJson = (dir: Dir, name: string, data: unknown) => dir.write(name, JSON.stringify(data, null, 2) + "\n");

async function readEntries(dir: Dir): Promise<LocalEntry[]> {
  const f = await dir.read("entries.csv");
  if (!f) return [];
  const [head, ...rows] = parseCsv(f.text);
  return rows.map((r) => {
    const e: any = Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""]));
    return { ...e, hours: Number(e.hours) };
  });
}

/** Python writes hours as a float: 2.0, 2.5. */
const pyFloat = (h: number) => (Number.isInteger(h) ? h.toFixed(1) : String(h));

function writeEntries(dir: Dir, entries: LocalEntry[]): Promise<void> {
  const rows = entries.map((e) => FIELDS.map((k) => (k === "hours" ? pyFloat(e.hours) : String(e[k] ?? ""))));
  return dir.write("entries.csv", formatCsv([[...FIELDS], ...rows]));
}

const newId = () => [...crypto.getRandomValues(new Uint8Array(4))].map((b) => b.toString(16).padStart(2, "0")).join("");

function weekRange(start: string): [string, string] {
  const end = new Date(start + "T00:00:00Z");
  end.setUTCDate(end.getUTCDate() + 6);
  return [start, end.toISOString().slice(0, 10)];
}

function validate(e: LocalEntry, noteRequired = true): void {
  for (const name of ["project", "task", "time_type"] as const)
    if (!String(e[name] ?? "").trim()) throw new Error(`${name} is required`);
  if (noteRequired && (!e.description.trim() || !e.note.trim())) throw new Error(NOTE_REQUIRED);
  if (!(e.hours > 0 && e.hours <= 24)) throw new Error("hours must be more than 0 and at most 24");
}

function checkStep(hours: number, step: number): void {
  if (Math.abs(hours / step - Math.round(hours / step)) > 1e-9)
    throw new Error(`hours must be a multiple of ${step} (SPP rounds to it)`);
}

/** Names must match SPP exactly. Checked only when projects.json has projects. */
function checkCatalog(catalog: any, project: string, task: string, timeType: string): void {
  if (!catalog.projects?.length || !project) return;
  const p = catalog.projects.find((x: any) => x.name === project);
  if (!p) throw new Error(`unknown project: ${project} (run \`projects\` for the list)`);
  if (task && !(p.tasks ?? []).some((t: any) => t.name === task))
    throw new Error(`unknown task for ${project}: ${task} (run \`projects\` for the list)`);
  if (timeType && !(p.time_types ?? []).includes(timeType)) throw new Error(`time type ${timeType} is not allowed for ${project}`);
}

const sameIds = (a: string[], b: string[]) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
const readProjects = async (dir: Dir) => ({ updated: null, source: null, projects: [], ...(await readJson(dir, "projects.json", {})) });

async function stamp(dir: Dir): Promise<string> {
  return (await dir.read("entries.csv"))?.stamp ?? "none";
}

/** Replace one cell's entries (one line, one day) by one entry, or remove them. */
async function setCell(dir: Dir, msg: any): Promise<any> {
  const key = [msg.date, msg.project, msg.task, msg.time_type].join("\u001f");
  const keyOf = (e: LocalEntry) => [e.date, e.project, e.task, e.time_type].join("\u001f");
  const entries = await readEntries(dir);
  const mine = entries.filter((e) => keyOf(e) === key);
  if (!sameIds(mine.map((e) => e.id), msg.expected_ids))
    return { ok: false, error: "this entry changed in entries.csv meanwhile; check the panel and try again" };
  let fresh: LocalEntry | null = null;
  if (msg.hours !== null && msg.hours !== undefined) {
    fresh = { id: newId(), date: msg.date, project: msg.project, task: msg.task, time_type: msg.time_type,
      hours: Number(msg.hours), description: msg.description.trim(), note: msg.note.trim() };
    validate(fresh);
    checkStep(fresh.hours, { ...DEFAULT_CONFIG, ...(await readJson(dir, "config.json", {})) }.hour_step);
    checkCatalog(await readProjects(dir), fresh.project, fresh.task, fresh.time_type);
  }
  await writeEntries(dir, [...entries.filter((e) => keyOf(e) !== key), ...(fresh ? [fresh] : [])]);
  return { ok: true, entry: fresh };
}

async function saveWeek(dir: Dir, msg: any): Promise<any> {
  const [lo, hi] = weekRange(msg.start);
  const inWeek = (e: LocalEntry) => lo <= e.date && e.date <= hi;
  const fresh: LocalEntry[] = msg.entries.map((d: any) => ({ ...Object.fromEntries(FIELDS.map((k) => [k, d[k]])), hours: Number(d.hours) }));
  // Cells imported from SPP may lack description or note (projects where SPP does not require them).
  for (const e of fresh) validate(e, false);
  const current = await readEntries(dir);
  if (!sameIds(current.filter(inWeek).map((e) => e.id), msg.loaded_ids))
    return { ok: false, error: "entries.csv changed since the panel loaded; reload the panel" };
  await writeEntries(dir, [...current.filter((e) => !inWeek(e)), ...fresh]);
  const state = await readJson(dir, "spp-state.json", {});
  state[String(msg.timesheet_id)] = msg.base;
  await writeJson(dir, "spp-state.json", state);
  return { ok: true };
}

export async function handle(dir: Dir, msg: any): Promise<any> {
  try {
    switch (msg.cmd) {
      case "week": {
        const [lo, hi] = weekRange(msg.start);
        return {
          ok: true,
          entries: (await readEntries(dir)).filter((e) => lo <= e.date && e.date <= hi),
          base: (await readJson(dir, "spp-state.json", {}))[String(msg.timesheet_id)] ?? null,
          projects: await readProjects(dir),
          stamp: await stamp(dir),
          aliases: (await readJson(dir, "mapping.json", {})).aliases ?? {},
        };
      }
      case "stamp":
        return { ok: true, stamp: await stamp(dir) };
      case "save_week":
        return await saveWeek(dir, msg);
      case "set_cell":
        return await setCell(dir, msg);
      case "save_projects":
        await writeJson(dir, "projects.json", msg.catalog);
        return { ok: true };
      default:
        return { ok: false, error: `unknown command: ${msg.cmd}` };
    }
  } catch (e) {
    return { ok: false, error: String((e as Error).message ?? e) }; // reply with the error instead of failing silently
  }
}
