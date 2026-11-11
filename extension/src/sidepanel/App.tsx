// Side panel: the open SPP week next to entries.csv, and one Sync button. Never submits.
import { useEffect, useRef, useState } from "preact/hooks";
import { baseOf, plan, resolve } from "../core/plan";
import type { Catalog, CellPlan, LocalEntry, SaveResult, SppWeek, Write } from "../core/types";

export type Api = {
  week(): Promise<SppWeek | null>;
  host(msg: object): Promise<any>;
  catalog(): Promise<Catalog>;
  save(writes: Write[], catalog: Catalog): Promise<SaveResult>;
  reload(): Promise<void>;
  /** Calls back when the SPP tab finishes loading or another tab is activated. */
  onTabChange?(cb: () => void): void;
};

type Data = { week: SppWeek; entries: LocalEntry[]; plans: CellPlan[]; catalog: Catalog };
const DAY_MS = 24 * 3600 * 1000;
const POLL_MS = 5000;
const WEEKEND_KEY = "timelog.showWeekend";
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
      if (choice === "local") return `${v(p.local)} (mine)`;
      return `${v(p.spp)}≠${v(p.local)}`;
  }
}

const STATE_TEXT: Record<CellPlan["state"], string> = {
  same: "same in SPP and entries.csv",
  toSpp: "Sync writes this to SPP",
  toLocal: "Sync copies this from SPP to entries.csv",
  conflict: "changed on both sides — choose one",
  invalid: "description or note missing — fix it in entries.csv",
};

const DAY_TARGET = 8;

/** The value SPP will hold for this cell after Sync. */
function afterSync(p: CellPlan, choice?: "spp" | "local"): number {
  const local = p.state === "toSpp" || p.state === "invalid" || (p.state === "conflict" && choice === "local");
  return (local ? p.local : p.spp)?.hours ?? 0;
}

const choosable = (p: CellPlan) => p.state === "conflict" && p.reason !== "locked" && p.reason !== "duplicate SPP lines";

export function App({ api }: { api: Api }) {
  const [data, setData] = useState<Data | null>(null);
  const [status, setStatus] = useState<string>("Loading…");
  const [errors, setErrors] = useState<string[]>([]);
  const [choices, setChoices] = useState<Record<string, "spp" | "local">>({});
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tick, setTick] = useState(0); // restarts the ticker line on every check
  const [showWeekend, setShowWeekend] = useState(() => localStorage.getItem(WEEKEND_KEY) === "1");
  // Read by the poller and tab listener, which outlive a single render.
  const stampRef = useRef<string | null>(null);
  const holdRef = useRef(false); // a pending choice or a running sync
  const loadingRef = useRef(false);
  holdRef.current = busy || Object.keys(choices).length > 0;

  async function load(forceCatalog = false) {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setErrors([]);
    setNotice(null);
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
      setChoices({});
      setData({ week, entries: r.entries, plans: plan(week, r.entries, r.base), catalog });
      setStatus(week.message ?? "");
      setErrors([...week.errors, ...warnings]);
    } catch (e) {
      setErrors([String((e as Error).message ?? e)]);
    } finally {
      loadingRef.current = false;
    }
  }

  function autoReload(why: string) {
    if (holdRef.current) setNotice(`${why} — click Reload when you are done here.`);
    else load();
  }

  useEffect(() => {
    load();
    api.onTabChange?.(() => autoReload("The SPP page changed"));
    const timer = setInterval(async () => {
      setTick((t) => t + 1);
      if (document.visibilityState === "hidden" || loadingRef.current) return;
      try {
        const r = await api.host({ cmd: "stamp" });
        if (r?.ok && stampRef.current !== null && r.stamp !== stampRef.current) autoReload("entries.csv changed");
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
    }
  }

  const ticker = (
    <div
      key={tick}
      data-tick={tick}
      class={`ticker${holdRef.current ? " held" : ""}`}
      style={{ animationDuration: `${POLL_MS}ms` }}
    />
  );

  if (!data) {
    return (
      <div>
        {ticker}
        <p>{status}</p>
        {errors.map((e) => <p class="error">{e}</p>)}
        <button onClick={() => load()}>Reload</button>
      </div>
    );
  }

  const { week, plans } = data;
  const days = week.days.filter((d) => showWeekend || !isWeekend(d) || plans.some((p) => p.date === d));
  const toggleWeekend = () => {
    localStorage.setItem(WEEKEND_KEY, showWeekend ? "0" : "1");
    setShowWeekend(!showWeekend);
  };
  // Every SPP line in SPP's order (empty ones too), then lines that exist only locally.
  const lines = new Map<string, CellPlan[]>(
    [...week.lines].sort((a, b) => a.row - b.row).map((l) => [[l.project, l.task, l.timeType].join(SEP), []]),
  );
  for (const p of plans) {
    const k = [p.project, p.task, p.timeType].join(SEP);
    lines.set(k, [...(lines.get(k) ?? []), p]);
  }
  const counts = plans.reduce<Record<string, number>>((c, p) => ({ ...c, [p.state]: (c[p.state] ?? 0) + 1 }), {});
  const open = plans.some((p) => choosable(p) && !choices[p.key]);
  const blocked = week.locked || busy || open || plans.some((p) => p.state === "invalid");
  const choose = (p: CellPlan, side: "spp" | "local") => setChoices((c) => ({ ...c, [p.key]: side }));
  const sel = plans.find((p) => p.key === selected);
  const v = (c: CellPlan["spp"]) => (c ? `${fmt(c.hours)} h — ${c.description} / ${c.note}` : "none");

  return (
    <div>
      {ticker}
      {week.locked && <p class="error">Locked: submitted or approved. Nothing will be written.</p>}
      <table>
        <thead>
          <tr>
            <th>Line</th>
            {days.map((d) => <th>{new Date(d + "T12:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric" })}</th>)}
          </tr>
        </thead>
        <tbody>
          {[...lines].map(([k, ps]) => {
            const [project, task, timeType] = k.split(SEP);
            return (
              <tr>
                <td class="line">
                  <b>{task}</b>
                  <br />
                  <small>{project.split(" : ").pop()} · {timeType}</small>
                </td>
                {days.map((d) => {
                  const p = ps.find((x) => x.date === d);
                  if (!p) return <td />;
                  return (
                    <td class={`cell ${p.state}${p.key === selected ? " selected" : ""}`} onClick={() => setSelected(p.key)}>
                      {label(p, choices[p.key])}
                    </td>
                  );
                })}
              </tr>
            );
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
      {sel && (
        <div class="details">
          <b>{sel.task}</b> · {sel.project} · {sel.timeType} · {sel.date}
          <br />
          {STATE_TEXT[sel.state]}
          {sel.reason ? ` (${sel.reason})` : ""}
          <br />
          SPP: {v(sel.spp)}
          <br />
          Mine: {v(sel.local)}
          <br />
          Last sync: {v(sel.base)}
          {choosable(sel) && (
            <div>
              <button onClick={() => choose(sel, "spp")}>Use SPP</button>
              <button onClick={() => choose(sel, "local")}>Use mine</button>
            </div>
          )}
        </div>
      )}
      <p class="counts">
        {Object.entries(counts).map(([s, n]) => <span class={`cell ${s}`}>{`${s}: ${n}`}</span>)}
      </p>
      {notice && <p class="notice">{notice}</p>}
      {status && <p>{status}</p>}
      {errors.map((e) => <p class="error">{e}</p>)}
      <button disabled={blocked} onClick={sync}>Sync</button>
      <button disabled={busy} onClick={() => load()}>Reload</button>
      <button disabled={busy} onClick={() => load(true)}>Refresh projects</button>
      <label class="weekend">
        <input type="checkbox" checked={showWeekend} onClick={toggleWeekend} /> Show weekend
      </label>
      <p class="legend">Click a cell for details. → to SPP · ← from SPP · ≠ choose a side · ! description or note missing</p>
    </div>
  );
}
