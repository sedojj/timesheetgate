import { describe, expect, test } from "vitest";
import model from "./fixtures/model.json";
import formFieldsJson from "./fixtures/form-fields.json";
import { parseModel } from "../src/core/parseModel";
import { saveBody } from "../src/core/saveBody";
import type { Write } from "../src/core/types";
import { CATALOG } from "./fixtures/catalog";

const week = () => parseModel(JSON.parse(JSON.stringify(model)), true);
const fields = () => formFieldsJson as [string, string][];
const get = (body: [string, string][], k: string) => body.filter(([n]) => n === k).map(([, v]) => v);
const PTO = { project: "Example Co : Time Off", task: "1: PTO [Master Phase]", timeType: "Non-Billable" };

describe("saveBody", () => {
  test("writes into an existing cell", () => {
    const w: Write = { ...PTO, date: "2026-10-15", value: { hours: 3, description: "d", note: "n" } };
    const body = saveBody(fields(), week(), [w], CATALOG);
    expect(get(body, "_c8_r2")).toEqual(["3"]);
    expect(get(body, "_c8_r2_dialog_description")).toEqual(["d"]);
    expect(get(body, "_c8_r2_dialog_notes")).toEqual(["n"]);
    expect(get(body, "_c8_r2_dialog_sri")).toEqual(["undefined"]);
    expect(get(body, "_c6_r2_dialog_description")).toEqual(["desc"]);
    expect(get(body, "_c5_r1_dialog_notes")).toEqual(["note"]);
    expect(get(body, "_form_has_changed")).toEqual(["1"]);
    expect(body[body.length - 1]).toEqual(["_save_grid", "Save"]);
  });

  test("clears a cell", () => {
    const body = saveBody(fields(), week(), [{ ...PTO, date: "2026-10-15", value: null }], CATALOG);
    expect(get(body, "_c8_r2")).toEqual([""]);
    expect(get(body, "_c8_r2_dialog_description")).toEqual([]);
  });

  test("adds two new lines", () => {
    const acme = { project: "Acme Corp : Acme Impl", timeType: "Billable", date: "2026-10-16", value: { hours: 1, description: "d", note: "n" } };
    const body = saveBody(fields(), week(), [
      { ...acme, task: "15: Testing Support [Validate]" },
      { ...acme, task: "13: Configuration/Data Loads [Model]", value: { hours: 2, description: "e", note: "m" } },
    ], CATALOG);
    expect(get(body, "_c1_r5")).toEqual(["1160:11372"]);
    expect(get(body, "_c2_r5")).toEqual(["259870"]);
    expect(get(body, "_c3_r5")).toEqual(["9"]);
    expect(get(body, "_c9_r5")).toEqual(["1"]);
    expect(get(body, "_c1_r6")).toEqual(["1160:11372"]);
    expect(get(body, "_c2_r6")).toEqual(["259868"]);
    expect(get(body, "_c9_r6")).toEqual(["2"]);
    expect(get(body, "_c4_r6")).toEqual([""]);
    expect(get(body, "_c9_r6_dialog_notes")).toEqual(["m"]);
  });

  test("refuses unknown names", () => {
    const w: Write = { project: "Nope", task: "t", timeType: "Billable", date: "2026-10-16", value: { hours: 1, description: "d", note: "n" } };
    expect(() => saveBody(fields(), week(), [w], CATALOG)).toThrow("not in projects list: Nope");
  });
});
