import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import model from "./fixtures/model.json";
import formFields from "./fixtures/form-fields.json";
import { parseModel } from "../src/core/parseModel";
import { saveBody } from "../src/core/saveBody";
import { CATALOG } from "./fixtures/catalog";

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}

describe("never submit", () => {
  test("no source file references the Submit button", () => {
    const src = files(join(__dirname, "..", "src"));
    expect(src.length).toBeGreaterThan(0);
    for (const f of src) {
      const text = readFileSync(f, "utf8");
      expect(text, f).not.toContain("save_grid_submit");
      expect(text, f).not.toContain("Save & Submit");
    }
  });

  test("save body has no submit key", () => {
    const week = parseModel(JSON.parse(JSON.stringify(model)), true);
    const writes = [
      { project: "Example Co : Time Off", task: "1: PTO [Master Phase]", timeType: "Non-Billable", date: "2026-10-15",
        value: { hours: 3, description: "d", note: "n" } },
      { project: "Acme Corp : Acme Impl", task: "15: Testing Support [Validate]", timeType: "Billable", date: "2026-10-16",
        value: { hours: 1, description: "d", note: "n" } },
    ];
    const body = saveBody(formFields as [string, string][], week, writes, CATALOG);
    for (const [k] of body) expect(k).not.toMatch(/submit/i);
  });
});
