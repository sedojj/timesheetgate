// MAIN-world script: asks the SPP page's own functions for tasks and time types, so we
// use exactly the parameters (user id, filters) the page uses itself.
type Pair = [string, string];
declare const project_tasks: (projectId: string) => (Pair | null)[];
declare const pt_to_timetype: (taskId: string) => (Pair | undefined)[];

const items = (arr: (Pair | null | undefined)[]): Pair[] =>
  arr.filter((x): x is Pair => Array.isArray(x)).map(([name, id]) => [String(name), String(id)]);

document.addEventListener("timelog:catalog-request", () => {
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
      for (const [, taskId] of tasks[id]) timeTypes[taskId] ??= items(pt_to_timetype(taskId));
    }
    detail = JSON.stringify({ projectOptions, tasks, timeTypes });
  } catch (e) {
    detail = JSON.stringify({ error: String((e as Error)?.message ?? e) });
  }
  document.dispatchEvent(new CustomEvent("timelog:catalog-response", { detail }));
});
