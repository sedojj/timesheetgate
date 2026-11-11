import { expect, test } from "vitest";
import { buildCatalog } from "../src/core/catalog";

test("builds projects with task time types", () => {
  const c = buildCatalog(
    [["1:2", "Acme : Impl"], ["3:4", "Co : Admin"]],
    { "1:2": [["9: Kickoff", "9"], ["34: Travel - Non-Billable", "34"]], "3:4": [["14: Tools", "14"]] },
    { "9": [["Billable", "9"]], "34": [["Non-Billable", "7"]], "14": [["Non-Billable", "7"]] },
    "2026-11-11T20:00:00Z",
  );
  expect(c.updated).toBe("2026-11-11T20:00:00Z");
  expect(c.source).toBe("extension");
  expect(c.projects[0]).toEqual({
    name: "Acme : Impl", id: "1:2", time_types: ["Billable", "Non-Billable"],
    tasks: [{ name: "9: Kickoff", id: "9", time_types: ["Billable"] },
            { name: "34: Travel - Non-Billable", id: "34", time_types: ["Non-Billable"] }],
  });
  expect(c.time_type_ids).toEqual({ Billable: "9", "Non-Billable": "7" });
});
