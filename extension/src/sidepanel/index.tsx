// Real Api for the side panel: the active tab's content script and the data folder.
import { render } from "preact";
import { handle } from "../core/store";
import { App, type Api } from "./App";
import { currentDir, folder, NeedsClick, regrantOnInput } from "./folder";

async function activeTab(): Promise<number | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id ?? null;
}

async function ask(msg: object): Promise<any> {
  const tab = await activeTab();
  if (tab === null) throw new Error("no active tab");
  const r = await chrome.tabs.sendMessage(tab, msg);
  if (r?.error) throw new Error(r.error);
  return r;
}

const api: Api = {
  async week() {
    try {
      return (await ask({ type: "week" })).week;
    } catch (e) {
      // No content script: not a timesheet page, or the page is still loading.
      if (/Receiving end does not exist|Could not establish connection|no active tab/.test(String(e))) return null;
      throw e; // a real error (e.g. the page model changed) must be visible
    }
  },
  async host(msg) {
    try {
      return await handle(await currentDir(), msg);
    } catch (e) {
      return { ok: false, error: String((e as Error).message ?? e), needs_click: e instanceof NeedsClick };
    }
  },
  folder,
  calendar: {
    url: async () => ((await chrome.storage.local.get("calendarUrl")).calendarUrl as string | undefined) ?? null,
    setUrl: (url) => chrome.storage.local.set({ calendarUrl: url }),
    async fetch(url, start, end) {
      const u = new URL(url);
      if (u.host !== "script.google.com") throw new Error("the address must start with https://script.google.com/");
      u.searchParams.set("start", start.toISOString());
      u.searchParams.set("end", end.toISOString());
      // credentials: your Google login in this Chrome profile; the script is shared with "Only myself".
      const r = await fetch(u, { credentials: "include" });
      const text = await r.text();
      try {
        return JSON.parse(text);
      } catch {
        // A login page, or the script's own error page (old script version, bad deployment).
        const page = new DOMParser().parseFromString(text, "text/html").body?.textContent?.replace(/\s+/g, " ").trim() ?? "";
        throw new Error(`Google did not return the calendar (HTTP ${r.status} from ${new URL(r.url).host}): ${page.slice(0, 200)}`);
      }
    },
  },
  openTab: () => void chrome.tabs.create({ url: chrome.runtime.getURL("sidepanel/sidepanel.html") }),
  catalog: async () => (await ask({ type: "catalog" })).catalog,
  save: (writes, catalog) => ask({ type: "save", writes, catalog }),
  async reload() {
    const tab = await activeTab();
    if (tab !== null) await chrome.tabs.reload(tab);
  },
  async unsaved() {
    try {
      return (await ask({ type: "unsaved" })).unsaved === true;
    } catch {
      return false; // not a timesheet page
    }
  },
  onUnsaved(cb) {
    chrome.runtime.onMessage.addListener(async (msg, sender) => {
      if (msg?.type === "timelog:unsaved" && sender.tab?.id === (await activeTab())) cb(msg.unsaved === true);
    });
  },
  onTabChange(cb) {
    chrome.tabs.onActivated.addListener(() => cb());
    chrome.tabs.onUpdated.addListener(async (tabId, info) => {
      if (info.status === "complete" && tabId === (await activeTab())) cb();
    });
  },
};

regrantOnInput();
render(<App api={api} />, document.getElementById("app")!);
