import { describe, expect, test } from "vitest";
import model from "./fixtures/model.json";
import formFieldsJson from "./fixtures/form-fields.json";
import { formFields, parseResponse, readWeek } from "../src/content";

function page(withSave = true): Document {
  const doc = document.implementation.createHTMLDocument("t");
  const script = doc.createElement("script");
  script.type = "text/html";
  script.id = "oa_model_timesheet";
  script.textContent = JSON.stringify(model);
  doc.body.appendChild(script);
  const form = doc.createElement("form");
  form.id = "timesheet_main_form";
  form.action = "https://example.test/timesheet.pl?r=TOKEN";
  for (const [name, value] of formFieldsJson as [string, string][]) {
    const input = doc.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = value;
    form.appendChild(input);
  }
  if (withSave) {
    const save = doc.createElement("input");
    save.type = "submit";
    save.id = "timesheet_savebutton";
    save.name = "_save_grid";
    save.value = "Save";
    form.appendChild(save);
  }
  doc.body.appendChild(form);
  return doc;
}

describe("content", () => {
  test("readWeek reads the fixture", () => {
    const w = readWeek(page());
    expect(w.lines).toHaveLength(4);
    expect(w.locked).toBe(false);
    expect(readWeek(page(false)).locked).toBe(true);
  });

  test("formFields returns the form fields in order, without the save button", () => {
    expect(formFields(page())).toEqual(formFieldsJson);
  });

  test("parseResponse reads errors and message from a saved page", () => {
    const html = `<html><body><script type="text/html" id="oa_model_timesheet">${JSON.stringify({
      ...model, errors: ["1. Notes are required"], message: null,
    })}</script></body></html>`;
    expect(parseResponse(html)).toEqual({ errors: ["1. Notes are required"], message: null });
    expect(parseResponse("<html>login</html>")).toEqual({ errors: ["SPP did not return a timesheet (session expired?)"], message: null });
  });
});
