import { z } from "zod";

import { commentBodySchema } from "./comment";
import { cursorPaginationSchema, uuidSchema } from "./common";

export const listingKinds = ["item", "service"] as const;
export type ListingKind = (typeof listingKinds)[number];
export const listingKindSchema = z.enum(listingKinds);

export const listingTypes = ["sale", "free", "wanted"] as const;
export type ListingType = (typeof listingTypes)[number];
export const listingTypeSchema = z.enum(listingTypes);

export const listingPriceUnits = ["fixed", "hourly", "quote"] as const;
export type ListingPriceUnit = (typeof listingPriceUnits)[number];
export const listingPriceUnitSchema = z.enum(listingPriceUnits);

export const listingStatuses = ["available", "pending", "closed", "expired"] as const;
export type ListingStatus = (typeof listingStatuses)[number];
export const listingStatusSchema = z.enum(listingStatuses);

/** FR-MKT-01/FR-MKT-12: v1 category lists, verbatim from the PRD. */
export const itemCategories = [
  "furniture",
  "home_garden",
  "kids_baby",
  "electronics",
  "clothing",
  "sports_outdoors",
  "tools",
  "vehicles_parts",
  "pet_supplies",
  "free_for_all_other",
] as const;
export type ItemCategory = (typeof itemCategories)[number];

export const serviceCategories = [
  "lawn_garden",
  "handyman_repairs",
  "cleaning",
  "pet_care",
  "tutoring_lessons",
  "childcare",
  "moving_hauling",
  "other_services",
] as const;
export type ServiceCategory = (typeof serviceCategories)[number];

export const listingCategories = [...itemCategories, ...serviceCategories] as const;
export type ListingCategory = (typeof listingCategories)[number];
export const listingCategorySchema = z.enum(listingCategories);

/** FR-MKT-01: up to 10 photos per listing - same cap as posts. */
export const MAX_LISTING_PHOTOS = 10;

export const listingTitleSchema = z.string().trim().min(1).max(150);
export const listingDescriptionSchema = z.string().trim().max(2000);
export const listingConditionSchema = z.string().trim().max(50);
export const listingAreaSchema = z.string().trim().max(200);
export const listingPriceCentsSchema = z.number().int().min(0).max(100_000_00);

const listingFields = z.object({
  kind: listingKindSchema,
  type: listingTypeSchema,
  title: listingTitleSchema,
  description: listingDescriptionSchema.optional(),
  category: listingCategorySchema,
  condition: listingConditionSchema.optional(),
  priceCents: listingPriceCentsSchema.optional(),
  priceUnit: listingPriceUnitSchema.optional(),
  area: listingAreaSchema.optional(),
});

/**
 * FR-MKT-02: Free locks price to $0 and hides the price field entirely - priceCents/priceUnit
 * are rejected, not just ignored, so the client can't send stale values from switching types.
 * FR-MKT-14: a service's price (when given) needs a priceUnit; an item's doesn't (items are a
 * flat price or nothing, never hourly/quote).
 */
function refineListingPrice(input: z.infer<typeof listingFields>, ctx: z.RefinementCtx) {
  if (input.type === "free") {
    if (input.priceCents !== undefined || input.priceUnit !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A free listing can't have a price.",
        path: ["priceCents"],
      });
    }
    return;
  }
  if (input.kind === "service" && input.priceCents !== undefined && !input.priceUnit) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Choose a price model for this service.",
      path: ["priceUnit"],
    });
  }
  if (input.kind === "item" && input.priceUnit !== undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Items don't use a price model.",
      path: ["priceUnit"],
    });
  }
}

export const createListingSchema = listingFields
  .extend({ businessId: uuidSchema.optional() })
  .superRefine(refineListingPrice);
export type CreateListingInput = z.infer<typeof createListingSchema>;

export const updateListingSchema = listingFields
  .extend({ listingId: uuidSchema })
  .superRefine(refineListingPrice);
export type UpdateListingInput = z.infer<typeof updateListingSchema>;

export const setListingStatusSchema = z.object({
  listingId: uuidSchema,
  status: z.enum(["available", "pending", "closed"]),
});
export type SetListingStatusInput = z.infer<typeof setListingStatusSchema>;

export const listListingsSchema = cursorPaginationSchema.extend({
  kind: listingKindSchema.optional(),
  type: listingTypeSchema.optional(),
  category: listingCategorySchema.optional(),
  condition: listingConditionSchema.optional(),
  minPriceCents: listingPriceCentsSchema.optional(),
  maxPriceCents: listingPriceCentsSchema.optional(),
});
export type ListListingsInput = z.infer<typeof listListingsSchema>;

export const listingIdSchema = z.object({ listingId: uuidSchema });

export const createListingCommentSchema = z.object({
  listingId: uuidSchema,
  body: commentBodySchema,
  parentId: uuidSchema.optional(),
});
export type CreateListingCommentInput = z.infer<typeof createListingCommentSchema>;
