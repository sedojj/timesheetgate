// Side panel: the open SPP week next to entries.csv, and one Sync button. Never submits.
import { useEffect, useRef, useState } from "preact/hooks";
import { baseOf, cellKey, plan, resolve, round2 } from "../core/plan";
import type { Holiday } from "../core/holidays";
import type { LineRef } from "../core/lines";
import type { Meeting } from "../core/meetings";
import type { Catalog, CellPlan, LocalEntry, SaveResult, SppWeek, Write } from "../core/types";
import type { Folder, FolderState } from "./folder";
import { DayView } from "./DayView";
import { DropBox, type DropTarget } from "./DropBox";
import { LinePicker } from "./LinePicker";
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
  /** The data folder; without it (tests) the files count as reachable. */
  folder?: Folder;
  /** Opens the panel in a normal tab: only there Chrome offers "Allow on every visit". */
  openTab?(): void;
  /** Your Google Calendar through your Apps Script web app (calendar/Code.gs). */
  calendar?: {
    url(): Promise<string | null>;
    setUrl(url: string): Promise<void>;
    /** The meetings from start (inclusive) to end (exclusive), as the script returns them. */
    fetch(url: string, start: Date, end: Date): Promise<{ events: unknown[] }>;
  };
};

type Alias = { project: string; task?: string; time_type?: string };
type Data = {
  week: SppWeek; entries: LocalEntry[]; plans: CellPlan[]; catalog: Catalog; aliases: Record<string, Alias>;
  holidays: Holiday[]; // days off this week, from the calendar file
  meetings: Meeting[]; // this week's meetings, with "used"
  lastNotes: Record<string, string>; // per line: the note of its latest entry, any week
  hourStep: number;
};
const DAY_MS = 24 * 3600 * 1000;
const POLL_MS = 5000;
const isWeekend = (d: string) => [0, 6].includes(new Date(d + "T12:00:00").getDay());
const SEP = "\u001f";
const fmt = (h: number) => String(Math.round(h * 100) / 100);
const newId = () => Math.random().toString(16).slice(2, 10).padEnd(8, "0");

function stale(c: any): boolean {
  return c?.source !== "extension" || !c.updated || Date.now() - Date.parse(c.updated) > DAY_MS;
}

/** Chrome dropped the folder grant; the next click in the panel gets it back. */
class LostAccess extends Error {}

async function host(api: Api, msg: object): Promise<any> {
  const r = await api.host(msg);
  if (r?.needs_click) throw new LostAccess(r.error);
  if (!r?.ok) throw new Error(r?.error ?? "the data folder did not answer");
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

function label(p: CellPlan): string {
  const v = (c: CellPlan["spp"]) => (c ? fmt(c.hours) : "–");
  switch (p.state) {
    case "same": return v(p.spp);
    case "toSpp": return `←${v(p.local)}`; // the panel sits right of SPP: "to SPP" points at it
    case "sppChanged": return `SPP ${v(p.spp)}`;
    case "invalid": return `!${v(p.local)}`;
  }
}

const STATE_TEXT: Record<CellPlan["state"], string> = {
  same: "In sync",
  toSpp: "Not in sync — will be saved to SPP",
  sppChanged: "SPP changed since your last Sync — Sync will ask",
  invalid: "Not in sync — cannot be saved",
};

const DAY_TARGET = 8;
// One line per cell colour; an "entry" is one day's hours on one line.
const LEGEND: [CellPlan["state"], string, string, string][] = [
  ["same", "✓", "already match SPP", "already matches SPP"],
  ["toSpp", "←", "will be saved to SPP", "will be saved to SPP"],
  ["sppChanged", "SPP", "changed in SPP since your last Sync — Sync will ask", "changed in SPP since your last Sync — Sync will ask"],
  ["invalid", "!", "cannot be saved (description or note missing)", "cannot be saved (description or note missing)"],
];

/** Totals count the timelog: it is what goes to SPP unless you keep SPP's changes. */
const afterSync = (p: CellPlan): number => p.local?.hours ?? 0;

/** Cells SPP changed since the last Sync, as the question lists them. */
function changedText(ps: CellPlan[]): { lines: string[]; removed: number } {
  const v = (c: CellPlan["spp"]) => (c ? `${fmt(c.hours)} h` : "none");
  return {
    lines: ps.map((p) => `${p.task} / ${p.date}: SPP ${v(p.spp)}, timelog ${v(p.local)}`),
    removed: ps.filter((p) => p.spp && !p.local).length,
  };
}

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

/** Hover explanation (native tooltips do not show in the side panel); none when text is empty. */
function Tip(props: { text: string | null; children: any }) {
  return props.text ? <span class="tip" data-tip={props.text}>{props.children}</span> : props.children;
}

const localIso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** The Sunday that starts this SPP week. */
function sundayOf(d: Date): string {
  const s = new Date(d);
  s.setDate(s.getDate() - s.getDay());
  return localIso(s);
}

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
  const pickStart = (v: string) => {
    setStart(v);
    if (end && end <= v) setEnd("");
  };
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
          <span class="inline">
            <select name="start" value={start} onChange={(e) => pickStart(e.currentTarget.value)}>
              {props.days.map((d) => <option value={d}>{dayName(d)}</option>)}
            </select>
            <Tip text={props.days.includes(today) ? null : `Today (${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short" })}) is not a workday in this timesheet's week.`}>
              <button type="button" disabled={!props.days.includes(today)} onClick={() => pickStart(today)}>Today</button>
            </Tip>
          </span>
        </label>
        <label>
          To (optional)
          <select name="end" value={end} onChange={(e) => setEnd(e.currentTarget.value)}>
            <option value="">just this day</option>
            {props.days.filter((d) => d > start).map((d) => <option value={d}>{dayName(d)}</option>)}
          </select>
        </label>
        <div class="choices">
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
  const [asking, setAsking] = useState(false); // the week-level question about SPP's changes is open
  const [busy, setBusy] = useState(false);
  const [waitingLines, setWaitingLines] = useState(0); // new SPP lines left for the next Sync; survives reloads
  const [selected, setSelected] = useState<string | null>(null);
  const [tick, setTick] = useState(0); // restarts the ticker line on every check
  const [unsaved, setUnsaved] = useState(false);
  const [ptoOpen, setPtoOpen] = useState(false);
  const [extraLines, setExtraLines] = useState<LineRef[]>([]); // added lines without hours yet; gone when the panel reopens
  const [picking, setPicking] = useState<{ project: string | null } | null>(null); // the line picker is open
  const [dayOpen, setDayOpen] = useState<string | null>(null); // the day view shows this date
  const dragRef = useRef<Meeting | null>(null); // the meeting being dragged (jsdom has no DataTransfer)
  const [dropping, setDropping] = useState<{ meeting: Meeting; target: DropTarget } | null>(null);
  const [dropError, setDropError] = useState<string | null>(null);
  const [access, setAccess] = useState<FolderState | "checking">(api.folder ? "checking" : "granted");
  const [folderName, setFolderName] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [calUrl, setCalUrl] = useState(""); // what the Settings field shows
  const [calInfo, setCalInfo] = useState<string | null>(null);
  const [calSaved, setCalSaved] = useState(false); // an address is stored: show the calendar line
  // Read by the poller and tab listener, which outlive a single render.
  const stampRef = useRef<string | null>(null);
  const holdRef = useRef(false); // a running sync
  const pendingRef = useRef(false); // an update arrived during a sync
  const loadingRef = useRef(false);
  const accessRef = useRef(access);
  const retryRef = useRef<(() => Promise<void>) | null>(null); // runs after the click that restores access
  const calUrlRef = useRef<string | null>(null); // the stored address
  const calFetchedRef = useRef(false); // fetched once per panel open
  const weekStartRef = useRef<string | null>(null); // the open timesheet's Sunday
  holdRef.current = busy;
  accessRef.current = access;

  /** Lost access shows the bar instead of an error. */
  function fail(e: unknown) {
    if (e instanceof LostAccess) setAccess("prompt");
    else setErrors([String((e as Error).message ?? e)]);
  }

  async function load(forceCatalog = false) {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setErrors([]);
    try {
      const week = await api.week();
      weekStartRef.current = week?.days[0] ?? null;
      if (!calFetchedRef.current) {
        calFetchedRef.current = true;
        refreshCalendar(); // in the background: it takes seconds
      }
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
      setData({ week, entries: r.entries, plans, catalog, aliases: r.aliases ?? {}, holidays: r.holidays ?? [], meetings: r.meetings ?? [], lastNotes: r.last_notes ?? {}, hourStep: r.hour_step ?? 0.5 });
      setStatus(week.message ?? "");
      setErrors([...week.errors, ...warnings]);
    } catch (e) {
      fail(e);
    } finally {
      loadingRef.current = false;
      if (pendingRef.current && !holdRef.current) {
        pendingRef.current = false; // an update arrived while loading
        load();
      }
    }
  }

  /** Fetches the open timesheet's week (or this week) and saves it as calendar/<Sunday>.json. */
  async function refreshCalendar() {
    const url = calUrlRef.current;
    if (!api.calendar || !url) return;
    const weekStart = weekStartRef.current ?? sundayOf(new Date());
    const start = new Date(weekStart + "T00:00:00");
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    setCalInfo("Fetching the calendar…");
    try {
      const calendar = await api.calendar.fetch(url, start, end);
      await host(api, { cmd: "save_calendar", week_start: weekStart, calendar });
      if (weekStartRef.current === weekStart) autoReload(); // the grid shows this week's holidays
      const at = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
      setCalInfo(`${calendar.events.length} meetings in the week of ${weekStart}, fetched ${at}.`);
    } catch (e) {
      if (e instanceof LostAccess) setAccess("prompt");
      setCalInfo(`Could not fetch the calendar: ${(e as Error).message ?? e}`);
    }
  }

  async function saveCalendarUrl() {
    const url = calUrl.trim();
    await api.calendar!.setUrl(url);
    calUrlRef.current = url || null;
    setCalUrl(url);
    setCalSaved(!!url);
    refreshCalendar();
  }

  function autoReload() {
    if (accessRef.current !== "granted") return; // nothing to reload before the folder is open
    if (holdRef.current || loadingRef.current) pendingRef.current = true;
    else load();
  }

  useEffect(() => {
    (async () => {
      calUrlRef.current = (await api.calendar?.url()) ?? null;
      setCalUrl(calUrlRef.current ?? "");
      setCalSaved(!!calUrlRef.current);
      const state = api.folder ? await api.folder.state() : "granted";
      setFolderName((await api.folder?.name()) ?? null);
      setAccess(state);
      if (state === "granted") load();
    })().catch((e) => setErrors([String(e?.message ?? e)]));
    api.onTabChange?.(autoReload);
    api.onUnsaved?.(setUnsaved);
    const timer = setInterval(async () => {
      setTick((t) => t + 1);
      if (api.unsaved) setUnsaved(await api.unsaved().catch(() => false));
      if (document.visibilityState === "hidden" || loadingRef.current) return;
      try {
        const r = await api.host({ cmd: "stamp" });
        if (r?.needs_click) setAccess("prompt");
        if (r?.ok && stampRef.current !== null && r.stamp !== stampRef.current) autoReload();
      } catch {
        /* the next poll tries again */
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, []);

  // Chrome grants access to the stored folder only within a user gesture, and drops the grant a
  // few seconds after it sees no tab of our origin (a side panel is not a tab): click to restore.
  useEffect(() => {
    if (access !== "prompt") return;
    const first = () =>
      api.folder!.activate().then(
        (state) => {
          setAccess(state);
          if (state !== "granted") return;
          const retry = retryRef.current;
          retryRef.current = null;
          if (retry) retry();
          else load();
        },
        (e) => setErrors([String(e?.message ?? e)]),
      );
    document.addEventListener("click", first, { capture: true, once: true });
    return () => document.removeEventListener("click", first, { capture: true });
  }, [access]);

  async function chooseFolder() {
    try {
      const name = await api.folder!.choose();
      if (!name) return;
      setFolderName(name);
      setAccess("granted");
      await load();
    } catch (e) {
      setErrors([String((e as Error).message ?? e)]);
    }
  }


  const settings = (
    <>
      <button class="gear" title="Settings" onClick={() => setSettingsOpen(!settingsOpen)}>⚙</button>
      {settingsOpen && (
        <div class="details settings">
          {api.folder && (
            <div>
              Folder: <b>{folderName ?? "none"}</b> <button onClick={chooseFolder}>Change folder</button>
              <br />
              <small>The timelog command uses ~/Timesheetgate. For another folder, set TIMELOG_HOME to it.</small>
            </div>
          )}
          <br />
          <button disabled={busy || !data} onClick={() => load(true)}>Sync project list</button>
          {api.calendar && (
            <div class="calendar">
              <label>
                Calendar script address (see the README)
                <input name="calendar_url" value={calUrl} onInput={(e) => setCalUrl(e.currentTarget.value)} />
              </label>
              <button onClick={saveCalendarUrl}>Save address</button>
            </div>
          )}
        </div>
      )}
    </>
  );

  // First thing when filling a day: the meetings of the week, so agents can suggest entries.
  const calendarLine = calSaved && (
    <p class="calendar-line">
      <b>Calendar:</b> {calInfo ?? "not fetched yet."}{" "}
      <button disabled={calInfo === "Fetching the calendar…"} onClick={refreshCalendar}>Refresh calendar</button>
    </p>
  );

  // Chrome keeps the grant for good only after "Allow on every visit", which it offers in a tab.
  const bar = (
    <p class="bar">
      Click anywhere to load your timesheet file.
      {api.openTab && (
        <>
          {" "}
          <button onClick={api.openTab}>Keep access</button>
          <br />
          <small>Once: in the tab that opens, click, then choose "Allow on every visit".</small>
        </>
      )}
    </p>
  );

  if (access !== "granted" && !data) {
    return (
      <div>
        {settings}
        {access === "checking" && <p>Loading…</p>}
        {access === "prompt" && bar}
        {(access === "none" || access === "denied") && (
          <>
            {access === "denied" && <p class="error">Chrome did not allow access to the folder {folderName}.</p>}
            <p>
              Choose the folder for your timesheet file (entries.csv). Suggested: create a folder named Timesheetgate
              in your home folder — the timelog command uses ~/Timesheetgate.
            </p>
            <button onClick={chooseFolder}>Choose folder</button>
          </>
        )}
        {errors.map((e) => <p class="error">{e}</p>)}
      </div>
    );
  }

  /** decision: the answer to the question about cells SPP changed since the last Sync. */
  async function sync(decision: "overwrite" | "keep" | null = null) {
    if (!data) return;
    if (!decision && data.plans.some((p) => p.state === "sppChanged")) return setAsking(true);
    setAsking(false);
    setBusy(true);
    setErrors([]);
    setWaitingLines(0);
    let waiting = false; // SPP is saved; entries.csv waits for the click that restores access
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
      const { writes, localWeek } = resolve(data.plans, decision, data.entries, newId);
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
      const msg = {
        cmd: "save_week", start: week.days[0], timesheet_id: week.timesheetId,
        entries: localWeek, base, loaded_ids: data.entries.map((e) => e.id),
      };
      const finish = async () => {
        await host(api, msg);
        const stamp = await api.host({ cmd: "stamp" });
        if (stamp?.ok) stampRef.current = stamp.stamp; // our own write is not a change
        setData({ ...data, week, entries: localWeek, plans: plan(week, localWeek, base) });
        if (now.length) api.reload();
        setWaitingLines(later);
        setStatus(now.length ? "Saved to SPP (not submitted)." : "entries.csv updated.");
      };
      try {
        await finish();
      } catch (e) {
        if (!(e instanceof LostAccess)) throw e;
        waiting = true;
        setStatus("Saved to SPP. Click anywhere to update entries.csv too.");
        retryRef.current = () => finish().catch(fail).finally(() => setBusy(false));
        setAccess("prompt");
      }
    } catch (e) {
      fail(e);
    } finally {
      if (!waiting) {
        setBusy(false);
        holdRef.current = false;
        if (pendingRef.current) {
          pendingRef.current = false;
          load();
        }
      }
    }
  }

  const ticker = (
    <div
      key={tick}
      data-tick={tick}
      class={`ticker${unsaved ? " unsaved" : access === "prompt" ? " off" : holdRef.current ? " held" : ""}`}
      style={{ animationDuration: `${POLL_MS}ms` }}
    />
  );

  if (!data) {
    return (
      <div>
        {ticker}
        {settings}
        <p>{status}</p>
        {calendarLine}
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
  for (const l of extraLines) {
    const k = [l.project, l.task, l.timeType].join(SEP);
    if (!lines.has(k)) lines.set(k, []);
  }
  // Each project's lines together, projects in the order they first appear.
  const projectOrder = [...new Set([...lines.keys()].map((k) => k.split(SEP)[0]))];
  const rows = [...lines].sort(([a], [b]) => projectOrder.indexOf(a.split(SEP)[0]) - projectOrder.indexOf(b.split(SEP)[0]));
  const taken: LineRef[] = rows.map(([k]) => { const [project, task, timeType] = k.split(SEP); return { project, task, timeType }; });
  /** The line picker, the cell box and the PTO form exclude each other. */
  const openPicker = (project: string | null) => {
    setSelected(null);
    setPtoOpen(false);
    setDayOpen(null);
    setPicking({ project });
  };
  const counts = plans.reduce<Record<string, number>>((c, p) => ({ ...c, [p.state]: (c[p.state] ?? 0) + 1 }), {});
  const blocked = week.locked || busy || unsaved || plans.some((p) => p.state === "invalid");
  const changed = changedText(plans.filter((p) => p.state === "sppChanged"));
  const sel = plans.find((p) => p.key === selected);
  /** Opening a cell closes the PTO form, and the other way round. */
  const selectCell = (key: string) => {
    setPtoOpen(false);
    setPicking(null);
    setDayOpen(null);
    setSelected((k) => (k === key ? null : key));
  };
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
      if (e instanceof LostAccess) setAccess("prompt"); // the edit is not saved: say so too
      problem = String((e as Error).message ?? e);
    }
    if (saved) await load();
    if (problem) setErrors([saved ? `${problem} (${saved} of ${cells.length} saved)` : problem]);
  }
  const saveCell = (t: Target, hours: number | null, description: string, note: string) =>
    saveCells([{ t, hours, description, note }]);
  /** One click on a holiday's header: 8 h on the `holiday` alias line, unless that day has it already. */
  const holidayLine = data.aliases.holiday;
  const holidayCell = (h: Holiday): Target | null =>
    holidayLine
      ? { key: cellKey(holidayLine.project, holidayLine.task ?? "", holidayLine.time_type ?? "", h.date),
          project: holidayLine.project, task: holidayLine.task ?? "", timeType: holidayLine.time_type ?? "", date: h.date }
      : null;
  const holidayEntered = (t: Target) => data.entries.some((e) => cellKey(e.project, e.task, e.time_type, e.date) === t.key);
  function holidayTip(h: Holiday): string {
    const what = `Public holiday ${h.country}: ${h.title}`;
    const t = holidayCell(h);
    if (!t) return `${what}. Needs a 'holiday' alias: timelog alias set holiday --project … --task … --time-type …`;
    return holidayEntered(t) ? `${what} — entered.` : `${what} — enters ${DAY_TARGET} h on your holiday line.`;
  }
  /** A day header opens that day's meetings and holiday; again closes it. Excludes the other boxes. */
  function openDay(d: string) {
    setSelected(null);
    setPtoOpen(false);
    setPicking(null);
    setDayOpen((x) => (x === d ? null : d));
  }
  /** Drop targets: a line, a project row, or "+ Add project". */
  const dropOn = (target: DropTarget) => ({
    onDragOver: (e: Event) => { if (dragRef.current) e.preventDefault(); },
    onDrop: (e: Event) => {
      e.preventDefault();
      const m = dragRef.current;
      dragRef.current = null;
      if (m) openDrop(m, target);
    },
  });
  function openDrop(meeting: Meeting, target: DropTarget) {
    setDropError(null);
    setDropping({ meeting, target });
  }
  /** One meeting into one cell: hours add up, descriptions join; the cell is replaced in one write. */
  async function saveDrop(line: LineRef, hours: number, description: string, note: string) {
    const m = dropping!.meeting;
    const key = cellKey(line.project, line.task, line.timeType, m.date);
    const mine = data!.entries.filter((e) => cellKey(e.project, e.task, e.time_type, e.date) === key);
    const total = round2(mine.reduce((t, e) => t + e.hours, 0) + hours);
    const desc = [...mine.map((e) => e.description), description].filter((x) => x.trim()).join("; ");
    try {
      await host(api, {
        cmd: "set_cell", date: m.date, project: line.project, task: line.task, time_type: line.timeType,
        hours: total, description: desc, note, expected_ids: mine.map((e) => e.id), meeting: { id: m.id, date: m.date },
      });
      setDropping(null);
      await load();
    } catch (e) {
      if (e instanceof LostAccess) setAccess("prompt");
      setDropError(String((e as Error).message ?? e));
    }
  }
  function enterHoliday(h: Holiday) {
    const t = holidayCell(h);
    if (!t || holidayEntered(t) || busy) return;
    saveCells([{ t, hours: DAY_TARGET, description: `Public holiday ${h.country}`, note: h.title }]);
  }
  const v = (c: CellPlan["spp"]) => (c ? `${fmt(c.hours)} h — ${c.description} / ${c.note}` : "none");

  return (
    <div>
      {ticker}
      {settings}
      {access === "prompt" && bar}
      {calendarLine}
      {week.locked && <p class="error">Locked: submitted or approved. Nothing will be written.</p>}
      <table>
        <thead>
          <tr>
            <th class="corner" />
            {days.map((d) => {
              const label = new Date(d + "T12:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric" });
              const h = data.holidays.find((x) => x.date === d);
              return (
                <th class={`day${h ? " holiday" : ""}${dayOpen === d ? " selected" : ""}`} onClick={() => openDay(d)}>
                  {h ? `${label} ${h.flag}🎉` : label}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map(([k, ps], i) => {
            const [project, task, timeType] = k.split(SEP);
            const header = i === 0 || rows[i - 1][0].split(SEP)[0] !== project;
            return [
              header && (
                <tr class="group" {...dropOn({ project })}>
                  <td colSpan={days.length + 1}>
                    <span class="project">{project}</span>
                    <button class="plus" title="Add a line to this project" onClick={() => openPicker(project)}>+</button>
                  </td>
                </tr>
              ),
              <tr {...dropOn({ line: { project, task, timeType } })}>
                <td class="line">
                  <b>{task}</b>
                  <br />
                  <small>{timeType}</small>
                </td>
                {days.map((d) => {
                  const p = ps.find((x) => x.date === d);
                  const key = cellKey(project, task, timeType, d);
                  if (!p)
                    return (
                      <td
                        class={`cell empty${key === selected ? " selected" : ""}`}
                        onClick={() => selectCell(key)}
                      />
                    );
                  return (
                    <td
                      class={`cell ${p.state}${p.key === selected ? " selected" : ""}`}
                      onClick={() => selectCell(p.key)}
                    >
                      {label(p)}
                    </td>
                  );
                })}
              </tr>,
            ];
          })}
          <tr class="totals">
            <td>Total</td>
            {days.map((d) => {
              const sum = Math.round(plans.filter((p) => p.date === d).reduce((t, p) => t + afterSync(p), 0) * 100) / 100;
              const tone = isWeekend(d) ? "" : Math.abs(sum - DAY_TARGET) < 0.005 ? " ok" : " short";
              return <td class={`total${tone}`}>{fmt(sum)}</td>;
            })}
          </tr>
        </tbody>
      </table>
      <button class="add-project" onClick={() => openPicker(null)} {...dropOn({ newProject: true })}>+ Add project</button>
      {picking && (
        <LinePicker
          catalog={data.catalog}
          project={picking.project}
          taken={taken}
          onCancel={() => setPicking(null)}
          onPick={(l) => {
            setExtraLines((x) => [...x, l]);
            setPicking(null);
          }}
        />
      )}
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
      {dayOpen && (() => {
        const h = data.holidays.find((x) => x.date === dayOpen);
        const t = h && holidayCell(h);
        return (
          <DayView
            date={dayOpen}
            holiday={h}
            holidayTip={h ? holidayTip(h) : ""}
            canEnterHoliday={!!t && !holidayEntered(t) && !busy}
            meetings={data.meetings.filter((m) => m.date === dayOpen)}
            onEnterHoliday={() => h && enterHoliday(h)}
            onAdd={(m) => openDrop(m, taken.length ? { line: taken[0] } : { newProject: true })}
            onDragStart={(m) => { dragRef.current = m; }}
          />
        );
      })()}
      {dropping && (
        <DropBox
          key={`${dropping.meeting.id}|${dropping.meeting.date}`}
          meeting={dropping.meeting}
          target={dropping.target}
          catalog={data.catalog}
          taken={taken}
          lastNotes={data.lastNotes}
          hourStep={data.hourStep}
          error={dropError}
          onSave={saveDrop}
          onCancel={() => setDropping(null)}
        />
      )}
      {!target && !ptoOpen && !dayOpen && !picking && <div class="details hint">Click a cell for details, or a day for its meetings.</div>}
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
      {waitingLines > 0 && (
        <p>{waitingLines} more new line(s) still to save: Sync again after the page reloads (SPP takes one new line per save).</p>
      )}
      {errors.map((e) => <p class="error">{e}</p>)}
      {asking && !blocked && (
        <div class="details spp-question">
          <b>SPP changed since your last Sync</b> ({changed.lines.length} {changed.lines.length === 1 ? "entry" : "entries"}):
          <ul>{changed.lines.map((l) => <li>{l}</li>)}</ul>
          {changed.removed > 0 && <p>Overwrite removes {changed.removed} {changed.removed === 1 ? "entry" : "entries"} from SPP.</p>}
          <button onClick={() => sync("overwrite")}>Overwrite with my timelog</button>
          <button onClick={() => sync("keep")}>Keep SPP's (copy to my timelog)</button>
          <button onClick={() => setAsking(false)}>Cancel</button>
        </div>
      )}
      <button disabled={blocked} class={unsaved ? "danger" : ""} onClick={() => sync()}>Sync</button>
      <Tip text={data.aliases.pto ? null : "Needs a 'pto' alias: timelog alias set pto --project … --task … --time-type …"}>
        <button disabled={busy || !data.aliases.pto} onClick={() => { setSelected(null); setPicking(null); setDayOpen(null); setPtoOpen(true); }}>Enter PTO</button>
      </Tip>
    </div>
  );
}
