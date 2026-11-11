import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

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
});
