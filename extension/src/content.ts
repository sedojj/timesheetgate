// Isolated-world content script on SPP timesheet pages: reads the week, loads the
// project catalog through page.ts, and saves with the page's own Save request.
import { buildCatalog } from "./core/catalog";
import { parseModel } from "./core/parseModel";
import { saveBody } from "./core/saveBody";
import type { Catalog, SppWeek, Write } from "./core/types";

const MODEL_ID = "oa_model_timesheet";

function form(doc: Document): HTMLFormElement {
  const f = doc.getElementById("timesheet_main_form");
  if (!f || f.tagName !== "FORM") throw new Error("timesheet form not found");
  return f as HTMLFormElement;
}

export function readWeek(doc: Document): SppWeek {
  const el = doc.getElementById(MODEL_ID);
  if (!el) throw new Error("timesheet model not found");
  return parseModel(JSON.parse(el.textContent ?? ""), !!doc.getElementById("timesheet_savebutton"));
}

export function formFields(doc: Document): [string, string][] {
  return [...new FormData(form(doc)).entries()].map(([k, v]) => [k, String(v)]);
}

export function parseResponse(html: string): { errors: string[]; message: string | null } {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const el = doc.getElementById(MODEL_ID);
  if (!el) return { errors: ["SPP did not return a timesheet (session expired?)"], message: null };
  const model = JSON.parse(el.textContent ?? "");
  return { errors: model.errors ?? [], message: model.message?.text ?? null };
}

function loadCatalog(): Promise<Catalog> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("loading projects timed out")), 60_000);
    document.addEventListener(
      "timelog:catalog-response",
      (e) => {
        clearTimeout(timer);
        const { projectOptions, tasks, timeTypes, error } = JSON.parse((e as CustomEvent).detail);
        if (error) reject(new Error(error));
        else resolve(buildCatalog(projectOptions, tasks, timeTypes, new Date().toISOString()));
      },
      { once: true },
    );
    document.dispatchEvent(new CustomEvent("timelog:catalog-request"));
  });
}

async function save(writes: Write[], catalog: Catalog): Promise<{ errors: string[]; message: string | null }> {
  const body = saveBody(formFields(document), readWeek(document), writes, catalog);
  const res = await fetch(form(document).action, {
    method: "POST",
    body: new URLSearchParams(body),
    credentials: "same-origin",
  });
  const result = parseResponse(await res.text());
  if (!res.ok) result.errors.unshift(`SPP answered HTTP ${res.status}`);
  if (!result.errors.length) setTimeout(() => location.reload(), 100);
  return result;
}

type Msg = { type: "week" } | { type: "catalog" } | { type: "save"; writes: Write[]; catalog: Catalog };

if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((msg: Msg, _sender, reply) => {
    const run = async () => {
      if (msg.type === "week") return { week: readWeek(document) };
      if (msg.type === "catalog") return { catalog: await loadCatalog() };
      if (msg.type === "save") return await save(msg.writes, msg.catalog);
      throw new Error("unknown message");
    };
    run().then(reply, (e) => reply({ error: String(e?.message ?? e) }));
    return true; // async reply
  });
}
