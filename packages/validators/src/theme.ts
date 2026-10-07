import { z } from "zod";

export const themes = ["system", "light", "dark"] as const;
export type Theme = (typeof themes)[number];
export const themeSchema = z.enum(themes);

export const setThemeSchema = z.object({
  theme: themeSchema,
});
export type SetThemeInput = z.infer<typeof setThemeSchema>;
