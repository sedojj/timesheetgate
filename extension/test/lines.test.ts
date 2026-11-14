// Which new lines a project can get: project list order, never twice, never an empty time type.
import { expect, test } from "vitest";
import { freeLines } from "../src/core/lines";
import type { Catalog } from "../src/core/types";

const P = "Example Co : Implementation";
const CAT: Catalog = {
  updated: "x", source: "extension", time_type_ids: {},
  projects: [{
    name: P, id: "1:2", time_types: ["Billable", "Non-Billable"],
    tasks: [
      { name: "8: Governance", id: "8", time_types: ["Billable"] },
      { name: "11: Business Process", id: "11", time_types: ["Billable", "Non-Billable"] },
      { name: "12: Integration", id: "12", time_types: [] }, // falls back to the project's types
      { name: "13: Configuration", id: "13", time_types: ["Billable", ""] },
    ],
  }],
};

test("offers only lines the project does not have", () => {
  const taken = [{ project: P, task: "8: Governance", timeType: "Billable" }, { project: "Other", task: "11: Business Process", timeType: "Billable" }];
  expect(freeLines(CAT, P, taken).map((l) => `${l.task} · ${l.timeType}`)).toEqual([
    "11: Business Process · Billable", "11: Business Process · Non-Billable",
    "12: Integration · Billable", "12: Integration · Non-Billable", "13: Configuration · Billable",
  ]);
});

test("a task with two time types gives two choices; one type gives one", () => {
  const lines = freeLines(CAT, P, []);
  expect(lines.filter((l) => l.task === "11: Business Process")).toHaveLength(2);
  expect(lines.filter((l) => l.task === "8: Governance")).toHaveLength(1);
});

test("never an empty time type; an unknown project has no lines", () => {
  expect(freeLines(CAT, P, []).some((l) => !l.timeType)).toBe(false);
  expect(freeLines(CAT, "Nope", [])).toEqual([]);
});
