import type { ListingCategory } from "@plumas/validators";
import { itemCategories, serviceCategories } from "@plumas/validators";

/** Human-readable labels for the PRD's v1 category slugs - shared by the browse filters, the create form, and the detail page. */
export const categoryLabels: Record<ListingCategory, string> = {
  furniture: "Furniture",
  home_garden: "Home & garden",
  kids_baby: "Kids & baby",
  electronics: "Electronics",
  clothing: "Clothing",
  sports_outdoors: "Sports & outdoors",
  tools: "Tools",
  vehicles_parts: "Vehicles & parts",
  pet_supplies: "Pet supplies",
  free_for_all_other: "Free-for-all / Other",
  lawn_garden: "Lawn & garden",
  handyman_repairs: "Handyman & repairs",
  cleaning: "Cleaning",
  pet_care: "Pet care",
  tutoring_lessons: "Tutoring & lessons",
  childcare: "Childcare",
  moving_hauling: "Moving & hauling",
  other_services: "Other services",
};

export const itemCategoryOptions = itemCategories.map((value) => ({
  value,
  label: categoryLabels[value],
}));
export const serviceCategoryOptions = serviceCategories.map((value) => ({
  value,
  label: categoryLabels[value],
}));

export function formatPrice(priceCents: number | null, priceUnit: string | null): string {
  if (priceCents === null) return priceUnit === "quote" ? "Contact for quote" : "";
  const dollars = (priceCents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: priceCents % 100 === 0 ? 0 : 2,
  });
  if (priceUnit === "hourly") return `${dollars}/hr`;
  return dollars;
}
