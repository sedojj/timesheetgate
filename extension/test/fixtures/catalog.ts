import type { Catalog } from "../../src/core/types";

export const CATALOG: Catalog = {
  updated: "x",
  source: "extension",
  projects: [
    { name: "Example Co : Time Off", id: "915:1093", time_types: ["Non-Billable"],
      tasks: [{ name: "1: PTO [Master Phase]", id: "29869", time_types: ["Non-Billable"] }] },
    { name: "Acme Corp : Acme Impl", id: "1160:11372", time_types: ["Billable"],
      tasks: [{ name: "15: Testing Support [Validate]", id: "259870", time_types: ["Billable"] },
              { name: "13: Configuration/Data Loads [Model]", id: "259868", time_types: ["Billable"] }] },
  ],
  time_type_ids: { Billable: "9", "Non-Billable": "7" },
};
