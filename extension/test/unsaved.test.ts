import { expect, test } from "vitest";
import model from "./fixtures/model.json";
import formFieldsJson from "./fixtures/form-fields.json";
import { parseModel } from "../src/core/parseModel";
import { unsavedChanges } from "../src/core/unsaved";

const week = () => parseModel(JSON.parse(JSON.stringify(model)), true);
const fields = (change: Record<string, string> = {}) =>
  (formFieldsJson as [string, string][]).map(([k, v]): [string, string] => [k, k in change ? change[k] : v]);

test("the saved page has no unsaved changes", () => {
  expect(unsavedChanges(fields(), week())).toEqual([]);
});

test("typed hours on an existing line", () => {
  expect(unsavedChanges(fields({ _c5_r1: "9" }), week())).toEqual(["_c5_r1"]);
  expect(unsavedChanges(fields({ _c5_r1: "1.0" }), week())).toEqual([]);
  expect(unsavedChanges(fields({ _c9_r1: "2" }), week())).toEqual(["_c9_r1"]);
});

test("a started new line in the empty row", () => {
  expect(unsavedChanges(fields({ _c9_r5: "4" }), week())).toEqual(["_c9_r5"]);
  expect(unsavedChanges(fields({ _c1_r5: "915:483" }), week())).toEqual(["_c1_r5"]);
});

test("a changed project or task on an existing line", () => {
  expect(unsavedChanges(fields({ _c2_r1: "6151" }), week())).toEqual(["_c2_r1"]);
});
