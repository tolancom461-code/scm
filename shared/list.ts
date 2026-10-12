import { z } from "zod";
export const listInput = z.object({
  search: z.string().trim().max(100).default(""),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(25),
});
export const idInput = z.object({ id: z.number().int().positive() });
export const reasonInput = z.object({
  id: z.number().int().positive(),
  reason: z.string().trim().min(3).max(1000),
});
