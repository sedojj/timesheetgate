// Side panel: the open SPP week next to entries.csv, and one Sync button. Never submits.
import { useEffect, useRef, useState } from "preact/hooks";
import { baseOf, cellKey, plan, resolve } from "../core/plan";
import type { Catalog, CellPlan, LocalEntry, SaveResult, SppWeek, Write } from "../core/types";
import { quoteNote } from "./quotes";

export type Api = {
  week(): Promise<SppWeek | null>;
  host(msg: object): Promise<any>;
  catalog(): Promise<Catalog>;
  save(writes: Write[], catalog: Catalog): Promise<SaveResult>;
  reload(): Promise<void>;
  /** Calls back when the SPP tab finishes loading or another tab is activated. */
  onTabChange?(cb: () => void): void;
  /** True while the SPP page has typing that is not saved yet. */
  unsaved?(): Promise<boolean>;
  /** Pushed by the page on every edit, so the panel reacts at once. */
  onUnsaved?(cb: (unsaved: boolean) => void): void;
};

type Alias = { project: string; task?: string; time_type?: string };
type Data = { week: SppWeek; entries: LocalEntry[]; plans: CellPlan[]; catalog: Catalog; aliases: Record<string, Alias> };
const DAY_MS = 24 * 3600 * 1000;
const POLL_MS = 5000;
const GROUP_KEY = "timelog.groupByProject";
const isWeekend = (d: string) => [0, 6].includes(new Date(d + "T12:00:00").getDay());
const SEP = "\u001f";
const fmt = (h: number) => String(Math.round(h * 100) / 100);
const newId = () => Math.random().toString(16).slice(2, 10).padEnd(8, "0");

function stale(c: any): boolean {
  return c?.source !== "extension" || !c.updated || Date.now() - Date.parse(c.updated) > DAY_MS;
}

async function host(api: Api, msg: object): Promise<any> {
  const r = await api.host(msg);
  if (!r?.ok) throw new Error(r?.error ?? "timelog host did not answer (run host/install.sh)");
  return r;
}

/** What matters for planning: the SPP cells and the lock, not row numbers or messages. */
function signature(w: SppWeek): string {
  const cells = Object.entries(baseOf(w, "").cells).sort(([a], [b]) => (a < b ? -1 : 1));
  return JSON.stringify([w.timesheetId, w.locked, cells]);
}

/** Writes for existing lines, plus the writes of at most one new line (see saveBody). */
function splitWrites(writes: Write[], week: SppWeek): { now: Write[]; later: number } {
  const lineKey = (w: { project: string; task: string; timeType: string }) => [w.project, w.task, w.timeType].join(SEP);
  const existing = new Set(week.lines.map(lineKey));
  const fresh = [...new Set(writes.map(lineKey).filter((k) => !existing.has(k)))];
  const now = writes.filter((w) => existing.has(lineKey(w)) || lineKey(w) === fresh[0]);
  return { now, later: Math.max(0, fresh.length - 1) };
}

/** Writes SPP's answer does not show — SPP ignored or changed them. */
function notKept(writes: Write[], saved: SppWeek): string[] {
  return writes
    .filter((w) => {
      const line = saved.lines.find((l) => l.project === w.project && l.task === w.task && l.timeType === w.timeType);
      const c = line?.cells[w.date];
      return w.value ? !c || Math.abs(c.hours - w.value.hours) >= 0.005 : !!c;
    })
    .map((w) => `${w.project} / ${w.task} ${w.date}`);
}

function label(p: CellPlan, choice?: "spp" | "local"): string {
  const v = (c: CellPlan["spp"]) => (c ? fmt(c.hours) : "–");
  switch (p.state) {
    case "same": return v(p.spp);
    case "toSpp": return `→${v(p.local)}`;
    case "toLocal": return `←${v(p.spp)}`;
    case "invalid": return `!${v(p.local)}`;
    case "conflict":
      if (choice === "spp") return `${v(p.spp)} (SPP)`;
      if (choice === "local") return `${v(p.local)} (local)`;
      return `${v(p.spp)}≠${v(p.local)}`;
  }
}

const STATE_TEXT: Record<CellPlan["state"], string> = {
  same: "In sync",
  toSpp: "Not in sync — will be saved to SPP",
  toLocal: "Not in sync — will be copied from SPP",
  conflict: "Not in sync — changed on both sides, choose one",
  invalid: "Not in sync — description or note missing",
};

const DAY_TARGET = 8;
// One line per cell colour; an "entry" is one day's hours on one line.
const LEGEND: [CellPlan["state"], string, string, string][] = [
  ["same", "✓", "already match SPP", "already matches SPP"],
  ["toSpp", "→", "will be saved to SPP", "will be saved to SPP"],
  ["toLocal", "←", "will be copied from SPP to your timelog", "will be copied from SPP to your timelog"],
  ["conflict", "≠", "changed on both sides — click it to choose", "changed on both sides — click it to choose"],
  ["invalid", "!", "miss a description or note", "misses a description or note"],
];

/** The value SPP will hold for this cell after Sync. */
function afterSync(p: CellPlan, choice?: "spp" | "local"): number {
  const local = p.state === "toSpp" || p.state === "invalid" || (p.state === "conflict" && choice === "local");
  return (local ? p.local : p.spp)?.hours ?? 0;
}

const choosable = (p: CellPlan) => p.state === "conflict" && p.reason !== "locked" && p.reason !== "duplicate SPP lines";

type Target = { key: string; project: string; task: string; timeType: string; date: string };

/** Hours, description and note of one cell. Saves to entries.csv through the host when
 *  the focus leaves the fields (or on Enter) and something changed. */
function Editor(props: {
  target: Target;
  start: CellPlan["local"];
  local: CellPlan["local"];
  spp: CellPlan["spp"];
  onSave(hours: number | null, description: string, note: string): void;
}) {
  const initial = [props.start ? fmt(props.start.hours) : "", props.start?.description ?? "", props.start?.note ?? ""];
  const [hours, setHours] = useState(initial[0]);
  const [description, setDescription] = useState(initial[1]);
  const [note, setNote] = useState(initial[2]);
  const [problem, setProblem] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const last = useRef(initial.join(SEP)); // what is saved already; avoids a second save on blur after Enter

  const commit = () => {
    const now = [hours.trim(), description.trim(), note.trim()];
    if (now.join(SEP) === last.current || (!props.start && now.every((x) => !x))) return;
    const h = Number(now[0].replace(",", "."));
    if (!now[0] || Number.isNaN(h)) return setProblem("Enter the hours, or use Remove entry.");
    setProblem(null);
    last.current = now.join(SEP);
    props.onSave(h, now[1], now[2]);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter") commit();
  };

  return (
    <div
      class="editor"
      ref={box}
      onKeyDown={onKeyDown}
      onFocusOut={(e) => {
        if (!(e.relatedTarget instanceof Node && box.current?.contains(e.relatedTarget))) commit();
      }}
    >
      <label>
        Hours <input name="hours" inputMode="decimal" value={hours} onInput={(e) => setHours(e.currentTarget.value)} />
      </label>
      <label>
        Description <input name="description" value={description} onInput={(e) => setDescription(e.currentTarget.value)} />
      </label>
      <label>
        Note <input name="note" value={note} onInput={(e) => setNote(e.currentTarget.value)} />
      </label>
      {problem && <p class="error">{problem}</p>}
      <button disabled={!props.local} onClick={() => props.onSave(null, "", "")}>Remove entry</button>
      <button
        disabled={!props.spp || JSON.stringify(props.spp) === JSON.stringify(props.local)}
        onClick={() => props.spp && props.onSave(props.spp.hours, props.spp.description, props.spp.note)}
      >
        Restore SPP
      </button>
    </div>
  );
}

const localIso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Quick PTO entry on the `pto` alias line: one day or a range (full days only). */
function PtoForm(props: { days: string[]; onSave(days: string[], hours: number, description: string, note: string): void; onCancel(): void }) {
  const today = localIso(new Date());
  const [start, setStart] = useState(props.days.includes(today) ? today : props.days[0]);
  const [end, setEnd] = useState("");
  const [amount, setAmount] = useState<"full" | "half" | "custom">("full");
  const [hours, setHours] = useState("");
  const [description, setDescription] = useState("PTO");
  const [note, setNote] = useState("PTO");
  const [problem, setProblem] = useState<string | null>(null);
  const range = !!end;
  const chosen = range ? "full" : amount;
  const dayName = (d: string) => new Date(d + "T12:00:00").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" });

  const save = () => {
    const h = chosen === "full" ? 8 : chosen === "half" ? 4 : Number(hours.replace(",", "."));
    if (chosen === "custom" && (!hours.trim() || Number.isNaN(h))) return setProblem("Enter the hours.");
    const days = range ? props.days.filter((d) => d >= start && d <= end) : [start];
    props.onSave(days, h, description.trim(), note.trim());
  };
  const option = (value: typeof amount, text: string) => (
    <label class="choice">
      <input type="radio" name="amount" value={value} checked={chosen === value} disabled={range && value !== "full"} onClick={() => setAmount(value)} />
      {text}
    </label>
  );
  return (
    <div class="details pto">
      <b>Enter PTO</b>
      <div class="editor">
        <label>
          From
          <select name="start" value={start} onChange={(e) => {
            const v = e.currentTarget.value;
            setStart(v);
            if (end && end <= v) setEnd("");
          }}>
            {props.days.map((d) => <option value={d}>{dayName(d)}</option>)}
          </select>
        </label>
        <label>
          To (optional)
          <select name="end" value={end} onChange={(e) => setEnd(e.currentTarget.value)}>
            <option value="">just this day</option>
            {props.days.filter((d) => d > start).map((d) => <option value={d}>{dayName(d)}</option>)}
          </select>
        </label>
        <div>
          {option("full", "Full day (8 h)")}
          {option("half", "Half day (4 h)")}
          {option("custom", "Custom")}
        </div>
        {chosen === "custom" && (
          <label>
            Hours <input name="hours" inputMode="decimal" value={hours} onInput={(e) => setHours(e.currentTarget.value)} />
          </label>
        )}
        <label>
          Description <input name="description" value={description} onInput={(e) => setDescription(e.currentTarget.value)} />
        </label>
        <label>
          Note <input name="note" value={note} onInput={(e) => setNote(e.currentTarget.value)} />
        </label>
        {problem && <p class="error">{problem}</p>}
        <button onClick={save}>Save PTO</button>
        <button onClick={() => setNote(quoteNote())}>Add a quote</button>
        <button onClick={props.onCancel}>Cancel</button>
      </div>
    </div>
  );
}

export function App({ api }: { api: Api }) {
  const [data, setData] = useState<Data | null>(null);
  const [status, setStatus] = useState<string>("Loading…");
  const [errors, setErrors] = useState<string[]>([]);
  const [choices, setChoices] = useState<Record<string, "spp" | "local">>({});
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [tick, setTick] = useState(0); // restarts the ticker line on every check
  const [unsaved, setUnsaved] = useState(false);
  const [ptoOpen, setPtoOpen] = useState(false);
  const [grouped, setGrouped] = useState(() => localStorage.getItem(GROUP_KEY) === "1");
  // Read by the poller and tab listener, which outlive a single render.
  const stampRef = useRef<string | null>(null);
  const holdRef = useRef(false); // a running sync
  const pendingRef = useRef(false); // an update arrived during a sync
  const loadingRef = useRef(false);
  holdRef.current = busy;

  /** keepChoices: an automatic update keeps the sides chosen for conflicts that still exist. */
  async function load(forceCatalog = false, keepChoices = false) {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setErrors([]);
    try {
      const week = await api.week();
      if (!week) {
        setData(null);
        setStatus("Open a timesheet in SuiteProjects Pro.");
        return;
      }
      const r = await host(api, { cmd: "week", start: week.days[0], timesheet_id: week.timesheetId });
      stampRef.current = r.stamp ?? null;
      let catalog: Catalog = r.projects;
      const warnings: string[] = [];
      if (forceCatalog || stale(catalog)) {
        setStatus("Loading your projects from SPP…");
        try {
          catalog = await api.catalog();
          await host(api, { cmd: "save_projects", catalog });
        } catch (e) {
          warnings.push(`Could not load projects from SPP: ${(e as Error).message ?? e}`);
        }
      }
      const plans = plan(week, r.entries, r.base);
      const still = new Set(plans.filter(choosable).map((p) => p.key));
      setChoices((c) => (keepChoices ? Object.fromEntries(Object.entries(c).filter(([k]) => still.has(k))) : {}));
      setData({ week, entries: r.entries, plans, catalog, aliases: r.aliases ?? {} });
      setStatus(week.message ?? "");
      setErrors([...week.errors, ...warnings]);
    } catch (e) {
      setErrors([String((e as Error).message ?? e)]);
    } finally {
      loadingRef.current = false;
    }
  }

  function autoReload() {
    if (holdRef.current) pendingRef.current = true;
    else load(false, true);
  }

  useEffect(() => {
    load();
    api.onTabChange?.(autoReload);
    api.onUnsaved?.(setUnsaved);
    const timer = setInterval(async () => {
      setTick((t) => t + 1);
      if (api.unsaved) setUnsaved(await api.unsaved().catch(() => false));
      if (document.visibilityState === "hidden" || loadingRef.current) return;
      try {
        const r = await api.host({ cmd: "stamp" });
        if (r?.ok && stampRef.current !== null && r.stamp !== stampRef.current) autoReload();
      } catch {
        /* the next poll tries again */
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, []);

  async function sync() {
    if (!data) return;
    setBusy(true);
    setErrors([]);
    try {
      if (await api.unsaved?.()) {
        setUnsaved(true);
        return;
      }
      const current = await api.week();
      if (!current || signature(current) !== signature(data.week)) {
        await load();
        setErrors(["SPP changed since the panel loaded (or the page is still reloading). Check the grid and Sync again."]);
        return;
      }
      const { writes, localWeek } = resolve(data.plans, choices, data.entries, newId);
      const { now, later } = splitWrites(writes, data.week);
      let week = data.week;
      if (now.length) {
        setStatus(`Saving ${now.length} cell(s) to SPP…`);
        const r = await api.save(now, data.catalog);
        if (r.errors.length || !r.week) {
          setErrors(r.errors.length ? r.errors : ["SPP did not confirm the save"]);
          setStatus("Nothing was saved.");
          return;
        }
        const missing = r.week.timesheetId === data.week.timesheetId ? notKept(now, r.week) : ["a different timesheet"];
        if (missing.length) {
          setErrors([`SPP did not keep: ${missing.join(", ")}. entries.csv was not changed.`]);
          return;
        }
        week = r.week;
      }
      const base = baseOf(week, new Date().toISOString());
      const saved = await host(api, {
        cmd: "save_week", start: week.days[0], timesheet_id: week.timesheetId,
        entries: localWeek, base, loaded_ids: data.entries.map((e) => e.id),
      });
      const stamp = await api.host({ cmd: "stamp" });
      if (saved && stamp?.ok) stampRef.current = stamp.stamp; // our own write is not a change
      setChoices({});
      setData({ ...data, week, entries: localWeek, plans: plan(week, localWeek, base) });
      if (now.length) api.reload();
      setStatus(
        later ? `Saved. ${later} more new line(s): Sync again after the page reloads.`
        : now.length ? "Saved to SPP (not submitted)." : "entries.csv updated.",
      );
    } catch (e) {
      setErrors([String((e as Error).message ?? e)]);
    } finally {
      setBusy(false);
      holdRef.current = false;
      if (pendingRef.current) {
        pendingRef.current = false;
        load(false, true);
      }
    }
  }

  const ticker = (
    <div
      key={tick}
      data-tick={tick}
      class={`ticker${unsaved ? " unsaved" : holdRef.current ? " held" : ""}`}
      style={{ animationDuration: `${POLL_MS}ms` }}
    />
  );

  if (!data) {
    return (
      <div>
        {ticker}
        <p>{status}</p>
        {errors.map((e) => <p class="error">{e}</p>)}
        {errors.length > 0 && <button onClick={() => load()}>Try again</button>}
      </div>
    );
  }

  const { week, plans } = data;
  // Weekends only when they hold hours, so nothing Sync would change is ever hidden.
  const days = week.days.filter((d) => !isWeekend(d) || plans.some((p) => p.date === d));
  // Every SPP line in SPP's order (empty ones too), then lines that exist only locally.
  const lines = new Map<string, CellPlan[]>(
    [...week.lines].sort((a, b) => a.row - b.row).map((l) => [[l.project, l.task, l.timeType].join(SEP), []]),
  );
  for (const p of plans) {
    const k = [p.project, p.task, p.timeType].join(SEP);
    lines.set(k, [...(lines.get(k) ?? []), p]);
  }
  // Grouped: each project's lines together, projects in the order they first appear.
  const projectOrder = [...new Set([...lines.keys()].map((k) => k.split(SEP)[0]))];
  const rows = [...lines].sort(([a], [b]) =>
    grouped ? projectOrder.indexOf(a.split(SEP)[0]) - projectOrder.indexOf(b.split(SEP)[0]) : 0,
  );
  const toggleGrouped = () => {
    localStorage.setItem(GROUP_KEY, grouped ? "0" : "1");
    setGrouped(!grouped);
  };
  const counts = plans.reduce<Record<string, number>>((c, p) => ({ ...c, [p.state]: (c[p.state] ?? 0) + 1 }), {});
  const open = plans.some((p) => choosable(p) && !choices[p.key]);
  const blocked = week.locked || busy || open || unsaved || plans.some((p) => p.state === "invalid");
  const choose = (p: CellPlan, side: "spp" | "local") => setChoices((c) => ({ ...c, [p.key]: side }));
  const sel = plans.find((p) => p.key === selected);
  const [sp, st, sy, sd] = (selected ?? "").split(SEP);
  const target: Target | null = selected ? { key: selected, project: sp, task: st, timeType: sy, date: sd } : null;
  /** Writes cells to entries.csv one by one (stops at the first refusal), then reloads once. */
  async function saveCells(cells: { t: Target; hours: number | null; description: string; note: string }[]) {
    setErrors([]);
    let saved = 0;
    let problem: string | null = null;
    try {
      for (const { t, hours, description, note } of cells) {
        const expected_ids = data!.entries
          .filter((e) => cellKey(e.project, e.task, e.time_type, e.date) === t.key)
          .map((e) => e.id);
        await host(api, {
          cmd: "set_cell", date: t.date, project: t.project, task: t.task, time_type: t.timeType,
          hours, description, note, expected_ids,
        });
        saved++;
      }
    } catch (e) {
      problem = String((e as Error).message ?? e);
    }
    if (saved) await load(false, true);
    if (problem) setErrors([saved ? `${problem} (${saved} of ${cells.length} saved)` : problem]);
  }
  const saveCell = (t: Target, hours: number | null, description: string, note: string) =>
    saveCells([{ t, hours, description, note }]);
  const v = (c: CellPlan["spp"]) => (c ? `${fmt(c.hours)} h — ${c.description} / ${c.note}` : "none");

  return (
    <div>
      {ticker}
      {week.locked && <p class="error">Locked: submitted or approved. Nothing will be written.</p>}
      <table>
        <thead>
          <tr>
            <th />
            {days.map((d) => <th>{new Date(d + "T12:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric" })}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map(([k, ps], i) => {
            const [project, task, timeType] = k.split(SEP);
            const header = grouped && (i === 0 || rows[i - 1][0].split(SEP)[0] !== project);
            return [
              header && (
                <tr class="group">
                  <td colSpan={days.length + 1}>{project}</td>
                </tr>
              ),
              <tr>
                <td class="line">
                  <b>{task}</b>
                  <br />
                  <small>{grouped ? timeType : `${project.split(" : ").pop()} · ${timeType}`}</small>
                </td>
                {days.map((d) => {
                  const p = ps.find((x) => x.date === d);
                  const key = cellKey(project, task, timeType, d);
                  if (!p)
                    return (
                      <td
                        class={`cell empty${key === selected ? " selected" : ""}`}
                        onClick={() => setSelected((k) => (k === key ? null : key))}
                      />
                    );
                  return (
                    <td
                      class={`cell ${p.state}${p.key === selected ? " selected" : ""}`}
                      onClick={() => setSelected((k) => (k === p.key ? null : p.key))}
                    >
                      {label(p, choices[p.key])}
                    </td>
                  );
                })}
              </tr>,
            ];
          })}
          <tr class="totals">
            <td>Total</td>
            {days.map((d) => {
              const sum = Math.round(plans.filter((p) => p.date === d).reduce((t, p) => t + afterSync(p, choices[p.key]), 0) * 100) / 100;
              const tone = isWeekend(d) ? "" : Math.abs(sum - DAY_TARGET) < 0.005 ? " ok" : " short";
              return <td class={`total${tone}`}>{fmt(sum)}</td>;
            })}
          </tr>
        </tbody>
      </table>
      {ptoOpen && data.aliases.pto && (
        <PtoForm
          days={week.days.filter((d) => !isWeekend(d))}
          onCancel={() => setPtoOpen(false)}
          onSave={async (days, h, d, n) => {
            const a = data.aliases.pto;
            const cells = days.map((day) => ({
              t: {
                key: cellKey(a.project, a.task ?? "", a.time_type ?? "", day),
                project: a.project, task: a.task ?? "", timeType: a.time_type ?? "", date: day,
              },
              hours: h, description: d, note: n,
            }));
            setPtoOpen(false);
            await saveCells(cells);
          }}
        />
      )}
      {!target && <div class="details hint">Click a cell for details.</div>}
      {target && (
        <div class="details">
          <b>{target.task}</b> · {target.project} · {target.timeType} · {target.date}
          <Editor
            key={`${target.key}|${JSON.stringify(sel?.local ?? sel?.spp ?? null)}`}
            target={target}
            start={sel?.local ?? sel?.spp ?? null}
            local={sel?.local ?? null}
            spp={sel?.spp ?? null}
            onSave={(h, d, n) => saveCell(target, h, d, n)}
          />
          <p class="sync-status">
            <b>Sync status:</b> {sel ? STATE_TEXT[sel.state] + (sel.reason ? ` (${sel.reason})` : "") : "no hours yet"}
          </p>
          {sel && (
            <>
              <details>
                <summary>Show values</summary>
                SPP: {v(sel.spp)}
                <br />
                Local: {v(sel.local)}
                <br />
                Last sync: {v(sel.base)}
              </details>
              {choosable(sel) && (
                <div>
                  <button onClick={() => choose(sel, "spp")}>Use SPP</button>
                  <button onClick={() => choose(sel, "local")}>Use local</button>
                </div>
              )}
            </>
          )}
        </div>
      )}
      <div class="legend">
        <h4>What Sync will do</h4>
        <ul>
          {LEGEND.map(([state, mark, many, one]) => {
            const n = counts[state] ?? 0;
            return <li class={`chip ${state}`}>{`${mark} ${n} ${n === 1 ? "entry" : "entries"} ${n === 1 ? one : many}`}</li>;
          })}
        </ul>
      </div>
      {unsaved && <p class="error">Unsaved changes in SPP — save or discard them first.</p>}
      {status && <p>{status}</p>}
      {errors.map((e) => <p class="error">{e}</p>)}
      <button disabled={blocked} class={unsaved ? "danger" : ""} onClick={sync}>Sync</button>
      <button disabled={busy || !data.aliases.pto} title={data.aliases.pto ? "" : "Needs a 'pto' alias (timelog alias set pto …)"} onClick={() => setPtoOpen(true)}>Enter PTO</button>
      <button disabled={busy} onClick={() => load(true)}>Sync project list</button>
      <label class="option">
        <input type="checkbox" checked={grouped} onClick={toggleGrouped} /> Group by project
      </label>
    </div>
  );
}
