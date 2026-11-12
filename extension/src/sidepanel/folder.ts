// The data folder the user chose, through Chrome's File System Access API. The handle is kept in
// IndexedDB. Chrome drops the grant 5 s after it sees no tab of the extension's origin — a side
// panel is not a tab — so the panel asks again (silently, no dialog) on every click or key press.
import type { Dir } from "../core/store";

export type FolderState = "none" | "prompt" | "granted" | "denied";
export type Folder = {
  state(): Promise<FolderState>;
  /** Asks Chrome for access to the stored folder. Needs a user gesture (a click). */
  activate(): Promise<FolderState>;
  /** Opens the folder picker (needs a user gesture); null when the user cancels. */
  choose(): Promise<string | null>;
  name(): Promise<string | null>;
};

type Handle = FileSystemDirectoryHandle & {
  queryPermission(o: object): Promise<PermissionState>;
  requestPermission(o: object): Promise<PermissionState>;
};
const RW = { mode: "readwrite" };

function db(): Promise<IDBDatabase> {
  return new Promise((ok, fail) => {
    const r = indexedDB.open("timesheetgate", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("folder");
    r.onsuccess = () => ok(r.result);
    r.onerror = () => fail(r.error);
  });
}

async function stored(): Promise<Handle | null> {
  const d = await db();
  return new Promise((ok, fail) => {
    const q = d.transaction("folder").objectStore("folder").get("dir");
    q.onsuccess = () => ok(q.result ?? null);
    q.onerror = () => fail(q.error);
  });
}

async function store(h: Handle): Promise<void> {
  const d = await db();
  return new Promise((ok, fail) => {
    const t = d.transaction("folder", "readwrite");
    t.objectStore("folder").put(h, "dir");
    t.oncomplete = () => ok();
    t.onerror = () => fail(t.error);
  });
}

/** Files of one directory handle. createWritable writes a swap file and replaces on close(). */
export function dirOf(h: FileSystemDirectoryHandle): Dir {
  return {
    async read(name) {
      let file: File;
      try {
        file = await (await h.getFileHandle(name)).getFile();
      } catch (e) {
        if ((e as DOMException).name === "NotFoundError") return null;
        throw e;
      }
      return { text: await file.text(), stamp: `${file.lastModified}:${file.size}` };
    },
    async write(name, text) {
      const w = await (await h.getFileHandle(name, { create: true })).createWritable();
      await w.write(text);
      await w.close();
    },
  };
}

export const folder: Folder = {
  async state() {
    const h = await stored();
    return h ? h.queryPermission(RW) : "none";
  },
  async activate() {
    const h = await stored();
    return h ? h.requestPermission(RW) : "none";
  },
  async choose() {
    try {
      const h: Handle = await (window as any).showDirectoryPicker({ id: "timesheetgate", mode: "readwrite" });
      await store(h);
      return h.name;
    } catch (e) {
      if ((e as DOMException).name === "AbortError") return null;
      throw e;
    }
  },
  async name() {
    return (await stored())?.name ?? null;
  },
};

/** Access needs a user gesture that is not there: the panel shows "Click anywhere". */
export class NeedsClick extends Error {
  constructor() {
    super("Click in the panel to load your timesheet file.");
  }
}

/** The folder as a Dir. A dropped grant is asked for again when a click or key press is recent. */
export async function openDir(h: Handle | null, gesture: boolean): Promise<Dir> {
  if (!h) throw new Error("Choose the data folder in Settings (⚙).");
  let p = await h.queryPermission(RW);
  if (p !== "granted" && gesture) p = await h.requestPermission(RW);
  if (p !== "granted") throw new NeedsClick();
  return dirOf(h);
}

let granting: Promise<unknown> = Promise.resolve();

/** Asks again on every click or key press, so the action it starts finds the folder open. */
export function regrantOnInput(): void {
  const again = () => {
    granting = stored().then((h) => h?.requestPermission(RW)).catch(() => {});
  };
  document.addEventListener("pointerdown", again, true);
  document.addEventListener("keydown", again, true);
}

export async function currentDir(): Promise<Dir> {
  await granting;
  return openDir(await stored(), navigator.userActivation?.isActive ?? false);
}
