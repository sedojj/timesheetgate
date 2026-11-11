import { describe, expect, test } from "vitest";
import model from "./fixtures/model.json";
import { parseModel } from "../src/core/parseModel";

const clone = () => JSON.parse(JSON.stringify(model));

describe("parseModel", () => {
  test("parses days Sun..Sat", () => {
    const w = parseModel(clone(), true);
    expect(w.days).toHaveLength(7);
    expect(w.days[0]).toBe("2026-10-11");
    expect(w.days[6]).toBe("2026-10-17");
    expect(w.dayCols["2026-10-11"]).toBe(4);
    expect(w.dayCols["2026-10-17"]).toBe(10);
  });

  test("parses lines and cells", () => {
    const w = parseModel(clone(), true);
    expect(w.timesheetId).toBe(126795);
    expect(w.lines).toHaveLength(4);
    const line = w.lines.find((l) => l.row === 2)!;
    expect(Object.keys(line.cells)).toHaveLength(4);
    expect(line.cells["2026-10-13"]).toEqual({ hours: 2, col: 6, origId: 2142304, description: "desc", note: "note" });
    expect(line.projectId).toMatch(/^\d+:\d+$/);
    expect(line.project).toBe("Example Co : Time Off");
    expect(line.task).toBe("1: PTO [Master Phase]");
    expect(line.timeType).toBe("Non-Billable");
    expect(line.timeTypeId).toBe("7");
  });

  test("empty row and flags", () => {
    const w = parseModel(clone(), true);
    expect(w.emptyRow).toBe(5);
    expect(w.locked).toBe(false);
    expect(parseModel(clone(), false).locked).toBe(true);
    expect(w.errors).toEqual([]);
    expect(w.message).toBe("The timesheet was saved.");
  });

  test("entities decoded", () => {
    const m = clone();
    const f = m.rows[0].fields[0];
    f.html = f.html.replace(/(<option selected="selected" value="[^"]*">)[^<]*/, "$1A &amp; B");
    expect(parseModel(m, true).lines[0].project).toBe("A & B");
  });
});

test("a 0 h cell counts as empty", () => {
  const m = clone();
  const f = m.rows[0].fields.find((x: any) => x.type === "day" && x.value !== "");
  f.value = 0;
  const w = parseModel(m, true);
  expect(w.lines[0].cells[f.date]).toBeUndefined();
});

test("SPP's message is plain text, one line per <br>", () => {
  const m = clone();
  m.message = { text: "The timesheet was saved.<br>The following entries were rounded: 0.25 to 0.5.", type: "confirm" };
  expect(parseModel(m, true).message).toBe("The timesheet was saved.\nThe following entries were rounded: 0.25 to 0.5.");
});
