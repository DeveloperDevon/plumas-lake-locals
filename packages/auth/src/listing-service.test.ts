import { createDb, schema } from "@plumas/db";
import { describe, expect, it } from "vitest";

import { BusinessForbiddenError, createBusiness } from "./business-service";
import { ListingNotFoundError } from "./listing-service";
import {
  createListing,
  createListingComment,
  deleteListing,
  listCommentsForListing,
  ListingForbiddenError,
  listListings,
  listMyListings,
  renewListing,
  setListingStatus,
  updateListing,
} from "./listing-service";
import { listAuditLog } from "./moderation-service";

const { users } = schema;

function mustGetEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name} - run tests with .env sourced`);
  return value;
}

function uniqueEmail(label: string): string {
  return `${label}-${crypto.randomUUID()}@example.test`;
}

describe("listing-service (integration, against the real local Postgres)", () => {
  const db = createDb(mustGetEnv("DATABASE_URL"));

  async function makeMember(label: string, role: "member" | "admin" = "member") {
    const [user] = await db
      .insert(users)
      .values({ email: uniqueEmail(label), displayName: `Test ${label}`, role })
      .returning();
    if (!user) throw new Error("setup failed");
    return user;
  }

  it("creates a sale listing with the given fields", async () => {
    const seller = await makeMember("seller-sale");
    const listing = await createListing(db, {
      sellerId: seller.id,
      kind: "item",
      type: "sale",
      title: "Toddler bike",
      category: "kids_baby",
      condition: "Like new",
      priceCents: 2500,
    });

    expect(listing.title).toBe("Toddler bike");
    expect(listing.priceCents).toBe(2500);
    expect(listing.status).toBe("available");
    expect(listing.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("forces price to 0 for a free listing, even if priceCents was somehow passed", async () => {
    const seller = await makeMember("seller-free");
    const listing = await createListing(db, {
      sellerId: seller.id,
      kind: "item",
      type: "free",
      title: "Toddler bike",
      category: "kids_baby",
      priceCents: 2500,
    });

    expect(listing.priceCents).toBe(0);
    expect(listing.priceUnit).toBeNull();
  });

  it("creates a wanted listing with no price required", async () => {
    const seller = await makeMember("seller-wanted");
    const listing = await createListing(db, {
      sellerId: seller.id,
      kind: "service",
      type: "wanted",
      title: "Looking for a dog walker",
      category: "pet_care",
    });

    expect(listing.type).toBe("wanted");
    expect(listing.priceCents).toBeNull();
  });

  it("requires a manager role to attribute a listing to a business", async () => {
    const owner = await makeMember("owner-biz-listing");
    const outsider = await makeMember("outsider-biz-listing");
    const business = await createBusiness(db, {
      ownerId: owner.id,
      name: "Sam's Grooming",
      serviceArea: "Plumas Lake",
    });

    await expect(
      createListing(db, {
        sellerId: outsider.id,
        kind: "service",
        type: "sale",
        title: "Dog grooming",
        category: "pet_care",
        priceCents: 4000,
        priceUnit: "fixed",
        businessId: business.id,
      }),
    ).rejects.toThrow(BusinessForbiddenError);

    const listing = await createListing(db, {
      sellerId: owner.id,
      kind: "service",
      type: "sale",
      title: "Dog grooming",
      category: "pet_care",
      priceCents: 4000,
      priceUnit: "fixed",
      businessId: business.id,
    });
    expect(listing.businessId).toBe(business.id);
  });

  it("excludes closed and expired listings from the default browse results", async () => {
    const seller = await makeMember("seller-browse");
    const available = await createListing(db, {
      sellerId: seller.id,
      kind: "item",
      type: "sale",
      title: "Browse-visible lamp",
      category: "furniture",
      priceCents: 1000,
    });
    const closed = await createListing(db, {
      sellerId: seller.id,
      kind: "item",
      type: "sale",
      title: "Browse-hidden lamp (closed)",
      category: "furniture",
      priceCents: 1000,
    });
    await setListingStatus(db, closed.id, seller.id, "closed");

    const page = await listListings(db, { limit: 50 });
    expect(page.items.some((row) => row.id === available.id)).toBe(true);
    expect(page.items.some((row) => row.id === closed.id)).toBe(false);
  });

  it("filters browse results by kind, type, and category", async () => {
    const seller = await makeMember("seller-filter");
    const item = await createListing(db, {
      sellerId: seller.id,
      kind: "item",
      type: "free",
      title: "Filter-test free couch",
      category: "furniture",
    });
    const service = await createListing(db, {
      sellerId: seller.id,
      kind: "service",
      type: "sale",
      title: "Filter-test lawn mowing",
      category: "lawn_garden",
      priceCents: 3000,
      priceUnit: "fixed",
    });

    const freeFurniture = await listListings(db, {
      type: "free",
      category: "furniture",
      limit: 50,
    });
    expect(freeFurniture.items.some((row) => row.id === item.id)).toBe(true);
    expect(freeFurniture.items.some((row) => row.id === service.id)).toBe(false);

    const services = await listListings(db, { kind: "service", limit: 50 });
    expect(services.items.some((row) => row.id === service.id)).toBe(true);
    expect(services.items.some((row) => row.id === item.id)).toBe(false);
  });

  it("lists every status for the seller's own My Listings page", async () => {
    const seller = await makeMember("seller-mine");
    const closed = await createListing(db, {
      sellerId: seller.id,
      kind: "item",
      type: "sale",
      title: "My-listings closed item",
      category: "tools",
      priceCents: 500,
    });
    await setListingStatus(db, closed.id, seller.id, "closed");

    const mine = await listMyListings(db, seller.id);
    expect(mine.some((row) => row.id === closed.id && row.status === "closed")).toBe(true);
  });

  it("only the seller can update, change status, renew, or delete a listing", async () => {
    const seller = await makeMember("seller-update");
    const other = await makeMember("other-update");
    const listing = await createListing(db, {
      sellerId: seller.id,
      kind: "item",
      type: "sale",
      title: "Original title",
      category: "tools",
      priceCents: 1000,
    });

    await expect(
      updateListing(db, {
        listingId: listing.id,
        actingUserId: other.id,
        kind: "item",
        type: "sale",
        title: "Hijacked",
        category: "tools",
        priceCents: 1,
      }),
    ).rejects.toThrow(ListingForbiddenError);
    await expect(setListingStatus(db, listing.id, other.id, "closed")).rejects.toThrow(
      ListingForbiddenError,
    );
    await expect(renewListing(db, listing.id, other.id)).rejects.toThrow(ListingForbiddenError);
    await expect(deleteListing(db, listing.id, other.id)).rejects.toThrow(ListingForbiddenError);

    const updated = await updateListing(db, {
      listingId: listing.id,
      actingUserId: seller.id,
      kind: "item",
      type: "sale",
      title: "Updated title",
      category: "tools",
      priceCents: 1500,
    });
    expect(updated.title).toBe("Updated title");

    const renewed = await renewListing(db, listing.id, seller.id);
    expect(renewed.expiresAt.getTime()).toBeGreaterThan(updated.expiresAt.getTime());

    await deleteListing(db, listing.id, seller.id);
    const mine = await listMyListings(db, seller.id);
    expect(mine.some((row) => row.id === listing.id)).toBe(false);
  });

  it("lets a site admin delete someone else's listing, and audit-logs it", async () => {
    const seller = await makeMember("seller-admin-del");
    const admin = await makeMember("admin-admin-del", "admin");
    const listing = await createListing(db, {
      sellerId: seller.id,
      kind: "item",
      type: "sale",
      title: "Admin will delete this",
      category: "tools",
      priceCents: 1000,
    });

    await deleteListing(db, listing.id, admin.id);
    const mine = await listMyListings(db, seller.id);
    expect(mine.some((row) => row.id === listing.id)).toBe(false);

    const logged = await listAuditLog(db, admin.id, 50);
    expect(
      logged.some((row) => row.targetId === listing.id && row.action === "delete_listing"),
    ).toBe(true);
  });

  it("supports commenting on a listing", async () => {
    const seller = await makeMember("seller-comments");
    const commenter = await makeMember("commenter-comments");
    const listing = await createListing(db, {
      sellerId: seller.id,
      kind: "item",
      type: "sale",
      title: "Comment on me",
      category: "tools",
      priceCents: 1000,
    });

    await createListingComment(db, {
      listingId: listing.id,
      userId: commenter.id,
      body: "Is this still available?",
    });
    const comments = await listCommentsForListing(db, listing.id);
    expect(comments).toHaveLength(1);
    expect(comments[0]?.body).toBe("Is this still available?");
  });

  it("throws ListingNotFoundError for an update on a listing that doesn't exist", async () => {
    const seller = await makeMember("seller-notfound");
    await expect(
      updateListing(db, {
        listingId: crypto.randomUUID(),
        actingUserId: seller.id,
        kind: "item",
        type: "sale",
        title: "Ghost",
        category: "tools",
      }),
    ).rejects.toThrow(ListingNotFoundError);
  });
});
