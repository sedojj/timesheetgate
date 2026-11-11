export type Cell = { hours: number; description: string; note: string };
export type SppCell = Cell & { col: number; origId: number | null };
export type SppLine = {
  row: number;
  projectId: string;
  project: string;
  taskId: string;
  task: string;
  timeTypeId: string;
  timeType: string;
  cells: Record<string, SppCell>; // by ISO date
};
export type SppWeek = {
  timesheetId: number;
  days: string[]; // 7 ISO dates, Sun..Sat
  dayCols: Record<string, number>;
  lines: SppLine[];
  emptyRow: number | null;
  locked: boolean;
  message: string | null;
  errors: string[];
};
export type LocalEntry = {
  id: string;
  date: string;
  project: string;
  task: string;
  time_type: string;
  hours: number;
  description: string;
  note: string;
};
export type BaseWeek = { week_start: string; synced_at: string; cells: Record<string, Cell> };
export type CellState = "same" | "toSpp" | "toLocal" | "conflict" | "invalid";
export type CellPlan = {
  key: string;
  project: string;
  task: string;
  timeType: string;
  date: string;
  state: CellState;
  reason?: string;
  spp: Cell | null;
  local: Cell | null;
  base: Cell | null;
};
export type Write = { project: string; task: string; timeType: string; date: string; value: Cell | null };
export type Catalog = {
  updated: string;
  source: "extension";
  projects: {
    name: string;
    id: string;
    time_types: string[];
    tasks: { name: string; id: string; time_types: string[] }[];
  }[];
  time_type_ids: Record<string, string>;
};
export type SaveResult = { errors: string[]; message: string | null; week: SppWeek | null };
