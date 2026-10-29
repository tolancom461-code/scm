import { z } from "zod";
import { dateInput } from "./validation";
export const projectStates = [
  "draft",
  "pending",
  "returned",
  "rejected",
  "approved",
  "active",
] as const;
export const projectData = z.object({
  name: z.string().trim().min(2).max(255),
  site: z.string().trim().max(500).default(""),
  description: z.string().trim().max(10000).default(""),
  requirements: z.string().trim().max(10000).default(""),
});
const id = z.number().int().positive();
export const projectSaveInput = z.object({
  key: z.string().uuid(),
  id: id.optional(),
  version: z.number().int().nonnegative().default(0),
  data: projectData,
});
export const projectActionInput = z.object({
  key: z.string().uuid(),
  id,
  version: z.number().int().nonnegative(),
  action: z.enum(["submit", "approve", "return", "reject", "start"]),
  comment: z.string().trim().max(4000).default(""),
});
export function projectTransition(state: string, action: string) {
  const target: Record<string, string> = {
    submit: "pending",
    approve: "approved",
    return: "returned",
    reject: "rejected",
    start: "active",
  };
  const valid =
    action === "submit"
      ? ["draft", "returned"]
      : action === "start"
        ? ["approved"]
        : ["pending"];
  if (!valid.includes(state) || !target[action])
    throw Error("INVALID_TRANSITION");
  return target[action];
}
export const employeeInput = z.object({
  key: z.string().uuid(),
  id: id.optional(),
  version: z.number().int().nonnegative().default(0),
  name: z.string().trim().min(2).max(200),
  jobTitle: z.string().trim().max(200).default(""),
  active: z.boolean().default(true),
});
export const statusInput = z.object({
  key: z.string().uuid(),
  id: id.optional(),
  version: z.number().int().nonnegative().default(0),
  name: z.string().trim().min(2).max(100),
});
export const taskInput = z
  .object({
    key: z.string().uuid(),
    id: id.optional(),
    version: z.number().int().nonnegative().default(0),
    projectId: id,
    parentId: id.nullable().default(null),
    name: z.string().trim().min(2).max(255),
    statusId: id,
    startDate: dateInput,
    endDate: dateInput,
    priority: z.enum(["critical", "high", "medium", "low"]),
    employeeIds: z
      .array(id)
      .min(1)
      .max(50)
      .transform(v => [...new Set(v)]),
  })
  .refine(v => v.startDate <= v.endDate, {
    path: ["endDate"],
    message: "تاريخ النهاية يجب ألا يسبق البداية / End must not precede start",
  });
export type TaskPeriod = {
  id: number;
  parentId: number | null;
  name: string;
  startDate: string;
  endDate: string;
  level: number;
};
export function taskDateConflicts(
  task: {
    id?: number;
    parentId: number | null;
    startDate: string;
    endDate: string;
  },
  rows: TaskPeriod[]
) {
  const parent = rows.find(t => t.id === task.parentId);
  const conflicts: string[] = [];
  if (
    parent &&
    (task.startDate < parent.startDate || task.endDate > parent.endDate)
  )
    conflicts.push(parent.name);
  for (const child of rows.filter(
    t => t.parentId === task.id && task.id !== undefined
  ))
    if (child.startDate < task.startDate || child.endDate > task.endDate)
      conflicts.push(child.name);
  return conflicts;
}
export const projectFileExtensions = /\.(png|jpe?g|webp|gif|pdf|dwg)$/i;
export function validateProjectFile(name: string, bytes: Uint8Array) {
  const ext = name.split(".").at(-1)?.toLowerCase();
  const header = String.fromCharCode(...bytes.slice(0, 12));
  if (!projectFileExtensions.test(name)) return false;
  if (ext === "pdf") return header.startsWith("%PDF-");
  if (ext === "dwg") return /^AC10\d{2}/.test(header);
  if (ext === "png")
    return [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v);
  if (ext === "jpg" || ext === "jpeg")
    return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (ext === "gif") return /^GIF8[79]a/.test(header);
  return header.startsWith("RIFF") && header.slice(8, 12) === "WEBP";
}
