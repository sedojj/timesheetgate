import { describe, expect, test, vi } from "vitest";
import model from "./fixtures/model.json";
import formFieldsJson from "./fixtures/form-fields.json";
import { formAction, loadCatalog, waitForWeek, formFields, parseResponse, readWeek } from "../src/content";

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

  test("waits for the Save button SPP draws after loading", async () => {
    const doc = page(false);
    setTimeout(() => {
      const save = doc.createElement("input");
      save.id = "timesheet_savebutton";
      doc.getElementById("timesheet_main_form")!.appendChild(save);
    }, 30);
    expect((await waitForWeek(doc, 1000))?.locked).toBe(false);
  });

  test("no Save button within the wait means locked", async () => {
    expect((await waitForWeek(page(false), 50))?.locked).toBe(true);
    expect(await waitForWeek(document.implementation.createHTMLDocument("list"), 50)).toBeNull();
  });
});

describe("loadCatalog", () => {
  const send = (name: string, detail?: string) => document.dispatchEvent(new CustomEvent(name, { detail }));
  const answer = JSON.stringify({ projectOptions: [["1:10", "Acme : One"]], tasks: { "1:10": [["T", "5"]] }, timeTypes: { "5": [["Billable", "9"]] } });

  test("a long load stays alive while page.ts reports progress", async () => {
    vi.useFakeTimers();
    try {
      const p = loadCatalog(1000);
      for (let i = 0; i < 5; i++) { await vi.advanceTimersByTimeAsync(900); send("timelog:catalog-progress"); } // 4.5 s in total
      send("timelog:catalog-response", answer);
      expect((await p).projects[0].tasks[0].time_types).toEqual(["Billable"]);
    } finally {
      vi.useRealTimers();
    }
  });

  test("no progress for the idle time times out, and a late answer is ignored", async () => {
    vi.useFakeTimers();
    try {
      const p = loadCatalog(1000);
      const caught = p.catch((e) => e.message);
      await vi.advanceTimersByTimeAsync(1001);
      expect(await caught).toBe("loading projects timed out");
      send("timelog:catalog-response", answer); // the listener is gone: nothing throws
    } finally {
      vi.useRealTimers();
    }
  });
});
