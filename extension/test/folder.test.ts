// The Dir over a File System Access directory handle (faked: jsdom has none).
import { expect, test, vi } from "vitest";
import { dirOf, NeedsClick, openDir } from "../src/sidepanel/folder";

function fakeHandle(files: Record<string, { text: string; lastModified: number }>, prefix = ""): any {
  return {
    async getDirectoryHandle(name: string, o?: { create?: boolean }) {
      if (!o?.create && !Object.keys(files).some((k) => k.startsWith(prefix + name + "/")))
        throw new DOMException("missing", "NotFoundError");
      return fakeHandle(files, prefix + name + "/");
    },
    async getFileHandle(name: string, o?: { create?: boolean }) {
      if (name.includes("/")) throw new TypeError("Name is not allowed."); // as in Chrome
      const key = prefix + name;
      if (!(key in files) && !o?.create) throw new DOMException("missing", "NotFoundError");
      return {
        async getFile() {
          const f = files[key];
          return { text: async () => f.text, lastModified: f.lastModified, size: new TextEncoder().encode(f.text).length };
        },
        async createWritable() {
          let buf = "";
          return { write: async (t: string) => { buf += t; }, close: async () => { files[key] = { text: buf, lastModified: 2 }; } };
        },
      };
    },
  };
}

test("a missing file reads as null; the stamp is lastModified and size; write replaces the file", async () => {
  const files: Record<string, { text: string; lastModified: number }> = {};
  const dir = dirOf(fakeHandle(files));
  expect(await dir.read("entries.csv")).toBeNull();
  await dir.write("entries.csv", "č");
  expect(await dir.read("entries.csv")).toEqual({ text: "č", stamp: "2:2" });
});

test("a dropped grant is asked for again within a click, and needs a click otherwise", async () => {
  let perm = "prompt";
  const h = { ...fakeHandle({}), queryPermission: async () => perm, requestPermission: vi.fn(async () => (perm = "granted")) };
  await expect(openDir(h, false)).rejects.toBeInstanceOf(NeedsClick);
  expect(h.requestPermission).not.toHaveBeenCalled();
  expect(await (await openDir(h, true)).read("x")).toBeNull();
  await expect(openDir(null, true)).rejects.toThrow("Choose the data folder");
});

test("a name with a folder writes into that subfolder, creating it", async () => {
  const files: Record<string, { text: string; lastModified: number }> = {};
  const dir = dirOf(fakeHandle(files));
  expect(await dir.read("calendar/2026-11-08.json")).toBeNull();
  await dir.write("calendar/2026-11-08.json", "{}");
  expect(Object.keys(files)).toEqual(["calendar/2026-11-08.json"]);
  expect((await dir.read("calendar/2026-11-08.json"))?.text).toBe("{}");
});
