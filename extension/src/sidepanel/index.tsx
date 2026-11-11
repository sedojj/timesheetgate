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
    } catch {
      return null; // not a timesheet page, or the content script is not there yet
    }
  },
  host: (msg) => chrome.runtime.sendNativeMessage("com.timelog.host", msg),
  catalog: async () => (await ask({ type: "catalog" })).catalog,
  save: (writes, catalog) => ask({ type: "save", writes, catalog }),
  async reload() {
    const tab = await activeTab();
    if (tab !== null) await chrome.tabs.reload(tab);
  },
};

render(<App api={api} />, document.getElementById("app")!);
