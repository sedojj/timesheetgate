import { expect, test, vi } from "vitest";

// page.ts runs in SPP's page and calls the page's own synchronous lookups.
const g = globalThis as any;
g.project_tasks = vi.fn((p: string) => [null, [`Task ${p}a`, `${p}a`], [`Task ${p}b`, `${p}b`]]);
g.pt_to_timetype = vi.fn((t: string) => [undefined, ["Billable", "9"], [`Type ${t}`, "7"]]);

const select = document.createElement("select");
select.name = "_c1_r1";
for (const [value, text] of [[":", ""], ["1:10", "Acme : One"], ["2:20", "Beta : Two"]]) select.add(new Option(text, value));
document.body.appendChild(select);
// @ts-expect-error page.ts is a plain script (no exports); importing it installs its listener
await import("../src/page");

const response = () =>
  new Promise<any>((r) =>
    document.addEventListener("timelog:catalog-response", (e) => r(JSON.parse((e as CustomEvent).detail)), { once: true }));

test("loads the catalog with a pause after each lookup, and ignores a second request meanwhile", async () => {
  const done = response();
  const seen: any[] = [];
  document.addEventListener("timelog:catalog-response", (e) => seen.push(e), {});
  document.dispatchEvent(new CustomEvent("timelog:catalog-request"));
  // The first lookup ran, then the script handed the tab back to the page.
  expect([g.project_tasks.mock.calls.length, g.pt_to_timetype.mock.calls.length]).toEqual([1, 0]);
  document.dispatchEvent(new CustomEvent("timelog:catalog-request")); // e.g. a retry: no second loop
  const r = await done;
  expect(r.projectOptions).toEqual([["1:10", "Acme : One"], ["2:20", "Beta : Two"]]);
  expect(r.tasks["2:20"]).toEqual([["Task 20a", "20a"], ["Task 20b", "20b"]]);
  expect(r.timeTypes["10a"]).toEqual([["Billable", "9"], ["Type 10a", "7"]]);
  expect([g.project_tasks.mock.calls.length, g.pt_to_timetype.mock.calls.length]).toEqual([2, 4]);
  await new Promise((r) => setTimeout(r, 10));
  expect(seen).toHaveLength(1);
});

test("finishes even when timers are throttled, as in a hidden SPP tab", async () => {
  const realTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (() => 0) as any; // Chrome delays timers in hidden tabs; here they never fire
  try {
    const r = await Promise.race([
      response(),
      new Promise((_, fail) => realTimeout(() => fail(new Error("the load waited on a timer")), 500)),
      Promise.resolve().then(() => document.dispatchEvent(new CustomEvent("timelog:catalog-request"))).then(() => new Promise(() => {})),
    ]);
    expect((r as any).projectOptions).toHaveLength(2);
  } finally {
    globalThis.setTimeout = realTimeout;
  }
});
