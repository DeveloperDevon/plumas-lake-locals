import { z } from "zod";

import { cursorPaginationSchema, emailSchema, uuidSchema } from "./common";
import { websiteSchema } from "./user";

export const businessManagerRoles = ["owner", "manager"] as const;
export type BusinessManagerRole = (typeof businessManagerRoles)[number];
export const businessManagerRoleSchema = z.enum(businessManagerRoles);

export const businessNameSchema = z.string().trim().min(1).max(100);
export const businessDescriptionSchema = z.string().trim().max(2000);
export const businessCategorySchema = z.string().trim().max(50);
export const serviceAreaSchema = z.string().trim().min(1).max(200);
// A single free-text line (e.g. "Mon-Fri 9-5"), not a structured per-day schedule - stored as a
// JSON string in businesses.hours. A day-by-day editor is unnecessary scope for an MVP page.
export const hoursSchema = z.string().trim().max(200);
export const phoneSchema = z.string().trim().max(30);

export const createBusinessSchema = z.object({
  name: businessNameSchema,
  description: businessDescriptionSchema.optional(),
  category: businessCategorySchema.optional(),
  serviceArea: serviceAreaSchema,
  hours: hoursSchema.optional(),
  phone: phoneSchema.optional(),
  email: emailSchema.optional(),
  website: websiteSchema.optional(),
  // FR-BIZ-08: the owner confirms the business serves Plumas Lake - a UI-level checkbox gate,
  // asserted true here the same way invite/accept.tsx's age/terms checkbox is.
  confirmsServesPlumasLake: z.literal(true),
});
export type CreateBusinessInput = z.infer<typeof createBusinessSchema>;

export const updateBusinessSchema = z.object({
  businessId: uuidSchema,
  name: businessNameSchema,
  description: businessDescriptionSchema.optional(),
  category: businessCategorySchema.optional(),
  serviceArea: serviceAreaSchema,
  hours: hoursSchema.optional(),
  phone: phoneSchema.optional(),
  email: emailSchema.optional(),
  website: websiteSchema.optional(),
});
export type UpdateBusinessInput = z.infer<typeof updateBusinessSchema>;

export const listBusinessesSchema = cursorPaginationSchema.extend({
  search: z.string().trim().max(100).optional(),
  category: businessCategorySchema.optional(),
});
export type ListBusinessesInput = z.infer<typeof listBusinessesSchema>;

export const businessIdSchema = z.object({ businessId: uuidSchema });

export const addBusinessManagerSchema = z.object({
  businessId: uuidSchema,
  targetUserId: uuidSchema,
});
export type AddBusinessManagerInput = z.infer<typeof addBusinessManagerSchema>;
