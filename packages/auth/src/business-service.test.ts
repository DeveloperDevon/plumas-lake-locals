import { createDb, schema } from "@plumas/db";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  addManager,
  BusinessForbiddenError,
  createBusiness,
  getBusinessBySlug,
  listBusinesses,
  listBusinessesForUser,
  listManagers,
  republishBusiness,
  unpublishBusiness,
  updateBusiness,
} from "./business-service";
import { listAuditLog } from "./moderation-service";

const { auditLog, users } = schema;

function mustGetEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name} - run tests with .env sourced`);
  return value;
}

function uniqueEmail(label: string): string {
  return `${label}-${crypto.randomUUID()}@example.test`;
}

describe("business-service (integration, against the real local Postgres)", () => {
  const db = createDb(mustGetEnv("DATABASE_URL"));

  async function makeMember(label: string, role: "member" | "admin" = "member") {
    const [user] = await db
      .insert(users)
      .values({ email: uniqueEmail(label), displayName: `Test ${label}`, role })
      .returning();
    if (!user) throw new Error("setup failed");
    return user;
  }

  it("creates a page with the creator as owner, and it shows up in the directory", async () => {
    const owner = await makeMember("owner-create");
    const business = await createBusiness(db, {
      ownerId: owner.id,
      name: "Sam's Mobile Grooming",
      serviceArea: "Plumas Lake",
    });

    const view = await getBusinessBySlug(db, business.slug, owner.id);
    expect(view?.myRole).toBe("owner");
    expect(view?.unpublishedAt).toBeNull();

    const directory = await listBusinesses(db, { limit: 50 });
    expect(directory.items.some((row) => row.id === business.id)).toBe(true);
  });

  it("a non-manager has no role, but the page is still visible while published", async () => {
    const owner = await makeMember("owner-visible");
    const outsider = await makeMember("outsider-visible");
    const business = await createBusiness(db, {
      ownerId: owner.id,
      name: "Open Page",
      serviceArea: "Plumas Lake",
    });

    const view = await getBusinessBySlug(db, business.slug, outsider.id);
    expect(view?.id).toBe(business.id);
    expect(view?.myRole).toBeNull();
  });

  it("only a manager can update the page", async () => {
    const owner = await makeMember("owner-update");
    const outsider = await makeMember("outsider-update");
    const business = await createBusiness(db, {
      ownerId: owner.id,
      name: "Original Name",
      serviceArea: "Plumas Lake",
    });

    await expect(
      updateBusiness(db, {
        businessId: business.id,
        actingUserId: outsider.id,
        name: "Hijacked",
        serviceArea: "Plumas Lake",
      }),
    ).rejects.toThrow(BusinessForbiddenError);

    const updated = await updateBusiness(db, {
      businessId: business.id,
      actingUserId: owner.id,
      name: "Updated Name",
      serviceArea: "Plumas Lake and Olivehurst",
      hours: "Mon-Fri 9-5",
    });
    expect(updated.name).toBe("Updated Name");
    expect(updated.hours).toBe("Mon-Fri 9-5");
  });

  it("only the owner can add a co-manager, who can then also manage the page", async () => {
    const owner = await makeMember("owner-addmgr");
    const notOwner = await makeMember("notowner-addmgr");
    const newManager = await makeMember("newmgr-addmgr");
    const business = await createBusiness(db, {
      ownerId: owner.id,
      name: "Family Shop",
      serviceArea: "Plumas Lake",
    });

    await addManager(db, business.id, newManager.id, owner.id);

    await expect(addManager(db, business.id, notOwner.id, newManager.id)).rejects.toThrow(
      BusinessForbiddenError,
    );

    const managers = await listManagers(db, business.id);
    expect(managers.map((m) => m.userId)).toContain(newManager.id);

    // The new co-manager can now update the page too.
    await updateBusiness(db, {
      businessId: business.id,
      actingUserId: newManager.id,
      name: "Family Shop",
      serviceArea: "Plumas Lake (updated by co-manager)",
    });
  });

  it("listBusinessesForUser returns every page the user manages", async () => {
    const owner = await makeMember("owner-mine");
    const business = await createBusiness(db, {
      ownerId: owner.id,
      name: "Mine",
      serviceArea: "Plumas Lake",
    });

    const mine = await listBusinessesForUser(db, owner.id);
    expect(mine.map((row) => row.id)).toContain(business.id);
  });

  it("unpublishing hides a page from the directory and from non-managers, but managers still see it", async () => {
    const owner = await makeMember("owner-unpublish");
    const outsider = await makeMember("outsider-unpublish");
    const admin = await makeMember("admin-unpublish", "admin");
    const business = await createBusiness(db, {
      ownerId: owner.id,
      name: "Reported Shop",
      serviceArea: "Plumas Lake",
    });

    await expect(unpublishBusiness(db, business.id, owner.id)).rejects.toThrow(
      BusinessForbiddenError,
    );

    await unpublishBusiness(db, business.id, admin.id);

    const directory = await listBusinesses(db, { limit: 50 });
    expect(directory.items.some((row) => row.id === business.id)).toBe(false);

    const outsiderView = await getBusinessBySlug(db, business.slug, outsider.id);
    expect(outsiderView).toBeNull();

    const ownerView = await getBusinessBySlug(db, business.slug, owner.id);
    expect(ownerView?.id).toBe(business.id);
    expect(ownerView?.unpublishedAt).not.toBeNull();

    const rows = await db.select().from(auditLog).where(eq(auditLog.targetId, business.id));
    expect(
      rows.some((row) => row.action === "unpublish_business" && row.actorId === admin.id),
    ).toBe(true);

    await republishBusiness(db, business.id, admin.id);
    const afterRepublish = await listBusinesses(db, { limit: 50 });
    expect(afterRepublish.items.some((row) => row.id === business.id)).toBe(true);

    const logged = await listAuditLog(db, admin.id, 50);
    expect(
      logged.some((row) => row.targetId === business.id && row.action === "republish_business"),
    ).toBe(true);
  });
});
