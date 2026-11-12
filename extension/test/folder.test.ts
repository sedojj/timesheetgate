// The Dir over a File System Access directory handle (faked: jsdom has none).
import { expect, test } from "vitest";
import { dirOf } from "../src/sidepanel/folder";

function fakeHandle(files: Record<string, { text: string; lastModified: number }>): any {
  return {
    async getFileHandle(name: string, o?: { create?: boolean }) {
      if (!(name in files) && !o?.create) throw new DOMException("missing", "NotFoundError");
      return {
        async getFile() {
          const f = files[name];
          return { text: async () => f.text, lastModified: f.lastModified, size: new TextEncoder().encode(f.text).length };
        },
        async createWritable() {
          let buf = "";
          return { write: async (t: string) => { buf += t; }, close: async () => { files[name] = { text: buf, lastModified: 2 }; } };
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
