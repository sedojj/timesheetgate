// The data-folder store: same files and rules as cli/timelog_store.py and the old native host
// (cases ported from tests/test_host.py).
import { describe, expect, test } from "vitest";
import { formatCsv, parseCsv } from "../src/core/csv";
import { type Dir, handle } from "../src/core/store";

/** In-memory folder; the stamp changes on every write, like mtime + size. */
function memDir(files: Record<string, string> = {}): Dir & { files: Record<string, string> } {
  let n = 0;
  const stamps: Record<string, string> = {};
  return {
    files,
    async read(name) {
      return name in files ? { text: files[name], stamp: stamps[name] ?? "0" } : null;
    },
    async write(name, text) {
      files[name] = text;
      stamps[name] = String(++n);
    },
  };
}

const HEADER = "id,date,project,task,time_type,hours,description,note\r\n";
const row = (id: string, date: string, note = "n") => `${id},${date},P,T,Y,1.0,d,${note}\r\n`;
const entry = (id: string, date: string, more: object = {}) =>
  ({ id, date, project: "P", task: "T", time_type: "Y", hours: 1, description: "d", note: "n", ...more });
const ids = async (dir: Dir) => ((await handle(dir, { cmd: "week", start: "2026-10-04", timesheet_id: 1 })).entries as any[])
  .concat((await handle(dir, { cmd: "week", start: "2026-10-11", timesheet_id: 1 })).entries)
  .concat((await handle(dir, { cmd: "week", start: "2026-10-18", timesheet_id: 1 })).entries)
  .map((e: any) => e.id);

describe("csv", () => {
  test("round-trips quotes, commas, newlines and diacritics like Python's csv module", () => {
    const rows = [["id", "description"], ["a1", 'a, "b"\nc'], ["a2", "čeština — ok"], ["a3", ""]];
    const text = formatCsv(rows);
    expect(text).toBe('id,description\r\na1,"a, ""b""\nc"\r\na2,čeština — ok\r\na3,\r\n');
    expect(parseCsv(text)).toEqual(rows);
  });

  test("reads \\n line endings and a missing final newline", () => {
    expect(parseCsv('a,b\n1,"x\r\ny"\n2,z')).toEqual([["a", "b"], ["1", "x\r\ny"], ["2", "z"]]);
  });
});

describe("entries.csv format", () => {
  test("written exactly as Python writes it: header, float hours, \\r\\n", async () => {
    const dir = memDir();
    const r = await handle(dir, { cmd: "set_cell", date: "2026-10-12", project: "P", task: "T", time_type: "Y",
      hours: 2, description: " d ", note: "n", expected_ids: [] });
    expect(r.ok).toBe(true);
    expect(r.entry.id).toMatch(/^[0-9a-f]{8}$/);
    expect(dir.files["entries.csv"]).toBe(`${HEADER}${r.entry.id},2026-10-12,P,T,Y,2.0,d,n\r\n`);
  });

  test("reads Python's file, any number format for hours", async () => {
    const dir = memDir({ "entries.csv": HEADER + "a1,2026-10-12,P,T,Y,2.5,d,n\r\na2,2026-10-13,P,T,Y,3,d,n\r\n" });
    const r = await handle(dir, { cmd: "week", start: "2026-10-11", timesheet_id: 1 });
    expect(r.entries.map((e: any) => e.hours)).toEqual([2.5, 3]);
  });
});

describe("save_week", () => {
  test("replaces only that week and stores the base", async () => {
    const dir = memDir({ "entries.csv": HEADER + row("o1", "2026-10-10") + row("o2", "2026-10-12") });
    const base = { week_start: "2026-10-11", synced_at: "x", cells: { k: { hours: 2, description: "d", note: "n" } } };
    const r = await handle(dir, { cmd: "save_week", start: "2026-10-11", timesheet_id: 126795,
      entries: [entry("n1", "2026-10-13", { hours: 2 })], base, loaded_ids: ["o2"] });
    expect(r).toEqual({ ok: true });
    expect(await ids(dir)).toEqual(["o1", "n1"]);
    expect(JSON.parse(dir.files["spp-state.json"])["126795"]).toEqual(base);
  });

  test("an invalid entry writes nothing", async () => {
    const dir = memDir({ "entries.csv": HEADER + row("o2", "2026-10-12") });
    const r = await handle(dir, { cmd: "save_week", start: "2026-10-11", timesheet_id: 1,
      entries: [entry("n1", "2026-10-13", { hours: 0 })], base: {}, loaded_ids: ["o2"] });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("hours");
    expect(await ids(dir)).toEqual(["o2"]);
    expect(dir.files["spp-state.json"]).toBeUndefined();
  });

  test("refuses when entries.csv changed meanwhile", async () => {
    const dir = memDir({ "entries.csv": HEADER + row("o2", "2026-10-12") + row("cli", "2026-10-13") });
    const r = await handle(dir, { cmd: "save_week", start: "2026-10-11", timesheet_id: 1, entries: [], base: {},
      loaded_ids: ["o2"] });
    expect(r).toEqual({ ok: false, error: "entries.csv changed since the panel loaded; reload the panel" });
    expect(await ids(dir)).toEqual(["o2", "cli"]);
  });

  test("accepts cells imported from SPP without description or note", async () => {
    const dir = memDir();
    const r = await handle(dir, { cmd: "save_week", start: "2026-10-11", timesheet_id: 1,
      entries: [entry("n1", "2026-10-13", { hours: 1.5, description: "", note: "" })], base: {}, loaded_ids: [] });
    expect(r).toEqual({ ok: true });
    expect((await handle(dir, { cmd: "week", start: "2026-10-11", timesheet_id: 1 })).entries[0].note).toBe("");
  });
});

const KEY = { date: "2026-10-12", project: "P", task: "T", time_type: "Y" };

describe("set_cell", () => {
  test("replaces that cell's entries", async () => {
    const dir = memDir({ "entries.csv": HEADER + row("a", "2026-10-12") + row("b", "2026-10-12") + row("o", "2026-10-13") });
    const r = await handle(dir, { cmd: "set_cell", ...KEY, hours: 2.5, description: "new", note: "nn", expected_ids: ["b", "a"] });
    expect(r.ok).toBe(true);
    const week = (await handle(dir, { cmd: "week", start: "2026-10-11", timesheet_id: 1 })).entries;
    expect(week.map((e: any) => e.date).sort()).toEqual(["2026-10-12", "2026-10-13"]);
    const fresh = week.find((e: any) => e.date === "2026-10-12");
    expect([fresh.hours, fresh.description, fresh.note, fresh.id]).toEqual([2.5, "new", "nn", r.entry.id]);
  });

  test("creates and removes", async () => {
    const dir = memDir();
    const r = await handle(dir, { cmd: "set_cell", ...KEY, hours: 1, description: "d", note: "n", expected_ids: [] });
    expect(r.ok).toBe(true);
    const gone = await handle(dir, { cmd: "set_cell", ...KEY, hours: null, description: "", note: "", expected_ids: [r.entry.id] });
    expect(gone).toEqual({ ok: true, entry: null });
    expect(await ids(dir)).toEqual([]);
  });

  test("checks the rules: note, hour step from config.json, catalog", async () => {
    const dir = memDir();
    for (const [bad, text] of [[{ note: "" }, "description and note are required"], [{ hours: 0.25 }, "multiple of 0.5"]] as const) {
      const r = await handle(dir, { cmd: "set_cell", ...KEY, hours: 1, description: "d", note: "n", expected_ids: [], ...bad });
      expect(r.ok).toBe(false);
      expect(r.error).toContain(text);
    }
    dir.files["config.json"] = JSON.stringify({ hour_step: 0.25 });
    expect((await handle(dir, { cmd: "set_cell", ...KEY, hours: 0.25, description: "d", note: "n", expected_ids: [] })).ok).toBe(true);
    dir.files["projects.json"] = JSON.stringify({ updated: "x", source: "extension", time_type_ids: {},
      projects: [{ name: "Q", id: "1:2", time_types: ["Y"], tasks: [{ name: "T", id: "9" }] }] });
    const r = await handle(dir, { cmd: "set_cell", ...KEY, date: "2026-10-13", hours: 1, description: "d", note: "n", expected_ids: [] });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("unknown project: P");
  });

  test("refuses when the cell changed meanwhile", async () => {
    const dir = memDir({ "entries.csv": HEADER + row("a", "2026-10-12") });
    const r = await handle(dir, { cmd: "set_cell", ...KEY, hours: 1, description: "d", note: "n", expected_ids: [] });
    expect(r).toEqual({ ok: false, error: "this entry changed in entries.csv meanwhile; check the panel and try again" });
    expect(await ids(dir)).toEqual(["a"]);
  });
});

describe("week, stamp, save_projects", () => {
  test("the week reply has everything the panel needs", async () => {
    const dir = memDir();
    expect((await handle(dir, { cmd: "week", start: "2026-10-11", timesheet_id: 1 })).base).toBeNull();
    dir.files["entries.csv"] = HEADER + row("a", "2026-10-10") + row("b", "2026-10-12") + row("c", "2026-10-18");
    const base = { week_start: "2026-10-11", synced_at: "x", cells: {} };
    dir.files["spp-state.json"] = JSON.stringify({ "126795": base });
    dir.files["mapping.json"] = JSON.stringify({ aliases: { pto: { project: "Co : Time Off" } }, client_roots: [] });
    const cat = { updated: "2026-11-11T20:00:00Z", source: "extension", projects: [], time_type_ids: {} };
    expect(await handle(dir, { cmd: "save_projects", catalog: cat })).toEqual({ ok: true });
    expect(dir.files["projects.json"]).toBe(JSON.stringify(cat, null, 2) + "\n");
    const r = await handle(dir, { cmd: "week", start: "2026-10-11", timesheet_id: 126795 });
    expect(r.entries.map((e: any) => e.id)).toEqual(["b"]);
    expect([r.base, r.projects, r.aliases.pto.project]).toEqual([base, cat, "Co : Time Off"]);
    expect(r.stamp).toBe((await handle(dir, { cmd: "stamp" })).stamp);
  });

  test("the stamp changes when entries change", async () => {
    const dir = memDir();
    expect(await handle(dir, { cmd: "stamp" })).toEqual({ ok: true, stamp: "none" });
    await handle(dir, { cmd: "set_cell", ...KEY, hours: 1, description: "d", note: "n", expected_ids: [] });
    const second = (await handle(dir, { cmd: "stamp" })).stamp;
    expect(second).not.toBe("none");
    await handle(dir, { cmd: "set_cell", ...KEY, date: "2026-10-13", hours: 1, description: "d", note: "n", expected_ids: [] });
    expect((await handle(dir, { cmd: "stamp" })).stamp).not.toBe(second);
  });

  test("an unknown command is an error reply, not a throw", async () => {
    expect(await handle(memDir(), { cmd: "nope" })).toEqual({ ok: false, error: "unknown command: nope" });
  });
});

describe("same file as the Python side", () => {
  test("Python reads what the panel writes, and writes it back byte for byte", async () => {
    const { execFileSync } = await import("node:child_process");
    const { mkdtempSync, readFileSync, writeFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const home = mkdtempSync(join(tmpdir(), "timelog-"));
    const dir = memDir();
    await handle(dir, { cmd: "save_week", start: "2026-10-11", timesheet_id: 1, base: {}, loaded_ids: [], entries: [
      entry("a1", "2026-10-12", { description: 'a, "b"\nc', note: "čeština — ok", hours: 2 }),
      entry("a2", "2026-10-13", { hours: 1.5, description: "", note: "" }),
    ] });
    writeFileSync(join(home, "entries.csv"), dir.files["entries.csv"]);
    const cli = join(__dirname, "..", "..", "cli");
    execFileSync("python3", ["-I", "-c", `import sys; sys.path.insert(0, ${JSON.stringify(cli)}); import timelog_store as s; s.write_entries(s.read_entries())`],
      { env: { ...process.env, TIMELOG_HOME: home } });
    expect(readFileSync(join(home, "entries.csv"), "utf8")).toBe(dir.files["entries.csv"]);
  });
});
