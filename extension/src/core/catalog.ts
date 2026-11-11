// Builds the projects.json shape from the page's own project / task / time type lists.
import type { Catalog } from "./types";

export function buildCatalog(
  projectOptions: [string, string][], // [id "cust:proj", name]
  tasks: Record<string, [string, string][]>, // project id → [name, task id]
  timeTypes: Record<string, [string, string][]>, // task id → [name, time type id]
  now: string,
): Catalog {
  const time_type_ids: Record<string, string> = {};
  const projects = projectOptions.map(([id, name]) => {
    const projectTypes: string[] = [];
    const projectTasks = (tasks[id] ?? []).map(([taskName, taskId]) => {
      const types = (timeTypes[taskId] ?? []).map(([typeName, typeId]) => {
        time_type_ids[typeName] = typeId;
        if (!projectTypes.includes(typeName)) projectTypes.push(typeName);
        return typeName;
      });
      return { name: taskName, id: taskId, time_types: types };
    });
    return { name, id, time_types: projectTypes, tasks: projectTasks };
  });
  return { updated: now, source: "extension", projects, time_type_ids };
}
