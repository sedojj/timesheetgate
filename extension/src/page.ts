// MAIN-world script: asks the SPP page's own functions for tasks and time types, so we
// use exactly the parameters (user id, filters) the page uses itself.
type Pair = [string, string];
declare const project_tasks: (projectId: string) => (Pair | null)[];
declare const pt_to_timetype: (taskId: string) => (Pair | undefined)[];

const items = (arr: (Pair | null | undefined)[]): Pair[] =>
  arr.filter((x): x is Pair => Array.isArray(x)).map(([name, id]) => [String(name), String(id)]);

// The page's lookups are synchronous requests to find.pl, one per project and one per task.
// Yielding after each one lets SPP handle input and paint between requests instead of
// freezing the tab for the whole list (hundreds of requests for a dozen projects).
// Each pause also tells content.ts the load is alive, so a long list does not time out.
const yieldToPage = () => {
  document.dispatchEvent(new CustomEvent("timelog:catalog-progress"));
  return new Promise<void>((r) => setTimeout(r, 0));
};
let running = false; // a request while a load runs gets that load's response

document.addEventListener("timelog:catalog-request", async () => {
  if (running) return;
  running = true;
  let detail: string;
  try {
    const select = document.querySelector<HTMLSelectElement>('select[name^="_c1_r"]');
    if (!select) throw new Error("project list not found on the page");
    const projectOptions: Pair[] = [...select.options]
      .filter((o) => o.value && o.value !== ":")
      .map((o) => [o.value, o.text.trim()]);
    const tasks: Record<string, Pair[]> = {};
    const timeTypes: Record<string, Pair[]> = {};
    for (const [id] of projectOptions) {
      tasks[id] = items(project_tasks(id.slice(id.indexOf(":") + 1)));
      await yieldToPage();
      for (const [, taskId] of tasks[id]) {
        if (timeTypes[taskId]) continue;
        timeTypes[taskId] = items(pt_to_timetype(taskId));
        await yieldToPage();
      }
    }
    detail = JSON.stringify({ projectOptions, tasks, timeTypes });
  } catch (e) {
    detail = JSON.stringify({ error: String((e as Error)?.message ?? e) });
  } finally {
    running = false;
  }
  document.dispatchEvent(new CustomEvent("timelog:catalog-response", { detail }));
});
