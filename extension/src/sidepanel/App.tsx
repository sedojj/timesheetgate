// Side panel: the open SPP week next to entries.csv, and one Sync button. Never submits.
import { useEffect, useState } from "preact/hooks";
import { baseOf, plan, resolve } from "../core/plan";
import type { Catalog, CellPlan, LocalEntry, SaveResult, SppWeek, Write } from "../core/types";

export type Api = {
  week(): Promise<SppWeek | null>;
  host(msg: object): Promise<any>;
  catalog(): Promise<Catalog>;
  save(writes: Write[], catalog: Catalog): Promise<SaveResult>;
  reload(): Promise<void>;
};

type Data = { week: SppWeek; entries: LocalEntry[]; plans: CellPlan[]; catalog: Catalog };
const DAY_MS = 24 * 3600 * 1000;
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

function tip(p: CellPlan): string {
  const v = (c: CellPlan["spp"]) => (c ? `${fmt(c.hours)} h — ${c.description} / ${c.note}` : "none");
  return [`SPP: ${v(p.spp)}`, `Mine: ${v(p.local)}`, `Last sync: ${v(p.base)}`, p.reason ? `(${p.reason})` : ""]
    .filter(Boolean)
    .join("\n");
}

export function App({ api }: { api: Api }) {
  const [data, setData] = useState<Data | null>(null);
  const [status, setStatus] = useState<string>("Loading…");
  const [errors, setErrors] = useState<string[]>([]);
  const [choices, setChoices] = useState<Record<string, "spp" | "local">>({});
  const [busy, setBusy] = useState(false);

  async function load(forceCatalog = false) {
    setErrors([]);
    try {
      const week = await api.week();
      if (!week) {
        setData(null);
        setStatus("Open a timesheet in SuiteProjects Pro.");
        return;
      }
      const r = await host(api, { cmd: "week", start: week.days[0], timesheet_id: week.timesheetId });
      let catalog: Catalog = r.projects;
      if (forceCatalog || stale(catalog)) {
        setStatus("Loading your projects from SPP…");
        catalog = await api.catalog();
        await host(api, { cmd: "save_projects", catalog });
      }
      setChoices({});
      setData({ week, entries: r.entries, plans: plan(week, r.entries, r.base), catalog });
      setStatus(week.message ?? "");
      if (week.errors.length) setErrors(week.errors);
    } catch (e) {
      setErrors([String((e as Error).message ?? e)]);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function sync() {
    if (!data) return;
    setBusy(true);
    setErrors([]);
    try {
      const { writes, localWeek } = resolve(data.plans, choices, data.entries, newId);
      let week = data.week;
      if (writes.length) {
        setStatus(`Saving ${writes.length} cell(s) to SPP…`);
        const r = await api.save(writes, data.catalog);
        if (r.errors.length || !r.week) {
          setErrors(r.errors.length ? r.errors : ["SPP did not confirm the save"]);
          setStatus("Nothing was saved.");
          return;
        }
        week = r.week;
      }
      const base = baseOf(week, new Date().toISOString());
      await host(api, { cmd: "save_week", start: week.days[0], timesheet_id: week.timesheetId, entries: localWeek, base });
      if (writes.length) await api.reload();
      await load();
      setStatus(writes.length ? "Saved to SPP (not submitted)." : "entries.csv updated.");
    } catch (e) {
      setErrors([String((e as Error).message ?? e)]);
    } finally {
      setBusy(false);
    }
  }

  if (!data) {
    return (
      <div>
        <p>{status}</p>
        {errors.map((e) => <p class="error">{e}</p>)}
        <button onClick={() => load()}>Reload</button>
      </div>
    );
  }

  const { week, plans } = data;
  const lines = new Map<string, CellPlan[]>();
  for (const p of plans) {
    const k = [p.project, p.task, p.timeType].join(SEP);
    lines.set(k, [...(lines.get(k) ?? []), p]);
  }
  const counts = plans.reduce<Record<string, number>>((c, p) => ({ ...c, [p.state]: (c[p.state] ?? 0) + 1 }), {});
  const open = plans.some((p) => p.state === "conflict" && p.reason !== "locked" && p.reason !== "duplicate SPP lines" && !choices[p.key]);
  const blocked = week.locked || busy || open || plans.some((p) => p.state === "invalid");
  const toggle = (p: CellPlan) =>
    setChoices((c) => ({ ...c, [p.key]: c[p.key] === "spp" ? "local" : "spp" }));

  return (
    <div>
      {week.locked && <p class="error">Locked: submitted or approved. Nothing will be written.</p>}
      <table>
        <thead>
          <tr>
            <th>Line</th>
            {week.days.map((d) => <th>{new Date(d + "T12:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric" })}</th>)}
          </tr>
        </thead>
        <tbody>
          {[...lines].map(([k, ps]) => {
            const [project, task, timeType] = k.split(SEP);
            return (
              <tr>
                <td class="line" title={`${project}\n${task}\n${timeType}`}>{project.split(" : ").pop()} / {task}</td>
                {week.days.map((d) => {
                  const p = ps.find((x) => x.date === d);
                  if (!p) return <td />;
                  const choosable = p.state === "conflict" && p.reason !== "locked" && p.reason !== "duplicate SPP lines";
                  return (
                    <td class={`cell ${p.state}`} title={tip(p)} onClick={choosable ? () => toggle(p) : undefined}>
                      {label(p, choices[p.key])}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      <p class="counts">
        {Object.entries(counts).map(([s, n]) => <span class={`cell ${s}`}>{`${s}: ${n}`}</span>)}
      </p>
      {status && <p>{status}</p>}
      {errors.map((e) => <p class="error">{e}</p>)}
      <button disabled={blocked} onClick={sync}>Sync</button>
      <button disabled={busy} onClick={() => load()}>Reload</button>
      <button disabled={busy} onClick={() => load(true)}>Refresh projects</button>
      <p class="legend">→ to SPP · ← from SPP · ≠ click to choose · ! description or note missing</p>
    </div>
  );
}
