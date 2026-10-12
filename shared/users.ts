import { z } from "zod";
import { accessProfileInput } from "./policy";

export const userAccessInput = accessProfileInput.omit({ userId: true });
export const userCreateInput = z.object({
  username: z
    .string()
    .trim()
    .min(3)
    .max(80)
    .regex(/^[a-zA-Z0-9._-]+$/)
    .transform(v => v.toLowerCase()),
  password: z.string().min(12).max(128),
  name: z.string().trim().min(2).max(150),
  email: z.string().email().optional(),
  locale: z.enum(["ar", "en", "ur"]).default("ar"),
  permissions: z.array(z.string().min(3).max(120)).default([]),
  accessPolicy: userAccessInput.omit({ version: true }).optional(),
});

export const userProfileInput = z.object({
  userId: z.number().int().positive(),
  username: z
    .string()
    .trim()
    .min(3)
    .max(80)
    .regex(/^[a-zA-Z0-9._-]+$/)
    .transform(v => v.toLowerCase()),
  name: z.string().trim().min(2).max(150),
  email: z
    .union([z.string().trim().email().max(320), z.literal("")])
    .default(""),
  locale: z.enum(["ar", "en", "ur"]),
  accessPolicy: userAccessInput.optional(),
});
export const userPasswordInput = z
  .object({
    userId: z.number().int().positive(),
    password: z.string().min(12).max(128),
    confirmation: z.string().min(12).max(128),
  })
  .refine(v => v.password === v.confirmation, {
    path: ["confirmation"],
    message: "Passwords do not match",
  });
export const userStatusInput = z.object({
  userId: z.number().int().positive(),
  active: z.boolean(),
});
