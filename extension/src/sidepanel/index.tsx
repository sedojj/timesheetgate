// Real Api for the side panel: the active tab's content script and the native host.
import { render } from "preact";
import { App, type Api } from "./App";

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
  host: (msg) => chrome.runtime.sendNativeMessage("com.timelog.host", msg),
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

render(<App api={api} />, document.getElementById("app")!);
