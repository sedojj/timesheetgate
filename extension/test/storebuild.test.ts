// The Chrome Web Store build: same code, no "key" (the store assigns its own ID), zipped.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

const root = join(__dirname, "..");

test("npm run build:store writes dist-store without the key, and its zip", () => {
  execFileSync("node", ["build.js", "--store"], { cwd: root, stdio: "pipe" });
  const m = JSON.parse(readFileSync(join(root, "dist-store", "manifest.json"), "utf8"));
  expect(m.key).toBeUndefined();
  expect(m.version).toMatch(/^0\.\d+$/);
  expect(existsSync(join(root, "dist-store", "sidepanel", "index.js"))).toBe(true);
  const zip = join(root, `timesheetgate-${m.version}.zip`);
  expect(execFileSync("unzip", ["-Z1", zip]).toString().split("\n")).toContain("manifest.json"); // at the zip's root
  expect(JSON.parse(readFileSync(join(root, "manifest.json"), "utf8")).key).toBeTruthy(); // the unpacked build keeps its ID
}, 30000);
