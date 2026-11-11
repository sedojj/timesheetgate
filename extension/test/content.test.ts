import { describe, expect, test } from "vitest";
import model from "./fixtures/model.json";
import formFieldsJson from "./fixtures/form-fields.json";
import { findWeek, formAction, formFields, parseResponse, readWeek } from "../src/content";

function page(withSave = true): Document {
  const doc = document.implementation.createHTMLDocument("t");
  const script = doc.createElement("script");
  script.type = "text/html";
  script.id = "oa_model_timesheet";
  script.textContent = JSON.stringify(model);
  doc.body.appendChild(script);
  const form = doc.createElement("form");
  form.id = "timesheet_main_form";
  form.setAttribute("action", "/timesheet.pl?uid=UID;action=grid;r=TOKEN");
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
    const r = parseResponse(html, false);
    expect(r.errors).toEqual(["1. Notes are required"]);
    expect(r.message).toBeNull();
    expect(r.week?.lines).toHaveLength(4);
    // SPP draws the Save button with JavaScript, so the raw answer never has it.
    expect(r.week?.locked).toBe(false);
    expect(parseResponse("<html>login</html>", false)).toEqual({
      errors: ["SPP did not return a timesheet (session expired?)"], message: null, week: null,
    });
  });

  test("formAction ignores the hidden field named 'action'", () => {
    const doc = page();
    // In Chrome, form.action returns the hidden <input name="action"> (jsdom does not emulate that).
    expect(formAction(doc, "https://spp.example/timesheet.pl?x=1")).toBe("https://spp.example/timesheet.pl?uid=UID;action=grid;r=TOKEN");
  });

  test("a page without a timesheet model is not a timesheet", () => {
    const doc = document.implementation.createHTMLDocument("list");
    expect(findWeek(doc)).toBeNull();
    expect(findWeek(page())?.lines).toHaveLength(4);
  });
});
