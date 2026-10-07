import { createDb, schema } from "@plumas/db";
import { describe, expect, it } from "vitest";

import { getProfile, updateProfile } from "./profile-service";
import { acceptRelationship, requestRelationship } from "./relationship-service";

const { users } = schema;

function mustGetEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name} - run tests with .env sourced`);
  return value;
}

function uniqueEmail(label: string): string {
  return `${label}-${crypto.randomUUID()}@example.test`;
}

describe("profile-service (integration, against the real local Postgres)", () => {
  const db = createDb(mustGetEnv("DATABASE_URL"));

  it("updates and reads back a full profile for its own owner", async () => {
    const [user] = await db
      .insert(users)
      .values({ email: uniqueEmail("profile"), displayName: "Before" })
      .returning();
    if (!user) throw new Error("setup failed");

    await updateProfile(db, user.id, {
      displayName: "After",
      bio: "Hello neighbors",
      street: "Oak St.",
      interests: ["hiking", "gardening"],
      occupation: "Teacher",
      pets: "One dog",
      website: "example.com",
      birthdayMonth: 6,
      birthdayDay: 15,
      fieldVisibility: { occupation: "connections" },
    });

    const profile = await getProfile(db, user.id, user.id);
    expect(profile).toMatchObject({
      displayName: "After",
      bio: "Hello neighbors",
      street: "Oak St.",
      interests: ["hiking", "gardening"],
      occupation: "Teacher",
      pets: "One dog",
      website: "example.com",
      birthdayMonth: 6,
      birthdayDay: 15,
      isOwner: true,
      fieldVisibility: { occupation: "connections" },
    });
  });

  it("normalizes empty strings to null so a field can be cleared", async () => {
    const [user] = await db
      .insert(users)
      .values({ email: uniqueEmail("clear"), displayName: "Clearable" })
      .returning();
    if (!user) throw new Error("setup failed");

    await updateProfile(db, user.id, { displayName: "Clearable", bio: "Something" });
    await updateProfile(db, user.id, { displayName: "Clearable", bio: "" });

    const profile = await getProfile(db, user.id, user.id);
    expect(profile?.bio).toBeNull();
  });

  it("hides a 'connections' field from a non-owner viewer, but shows it to the owner", async () => {
    const [owner] = await db
      .insert(users)
      .values({ email: uniqueEmail("owner"), displayName: "Owner" })
      .returning();
    const [viewer] = await db
      .insert(users)
      .values({ email: uniqueEmail("viewer"), displayName: "Viewer" })
      .returning();
    if (!owner || !viewer) throw new Error("setup failed");

    await updateProfile(db, owner.id, {
      displayName: "Owner",
      occupation: "Teacher",
      fieldVisibility: { occupation: "connections" },
    });

    const asOwner = await getProfile(db, owner.id, owner.id);
    expect(asOwner?.occupation).toBe("Teacher");

    const asViewer = await getProfile(db, owner.id, viewer.id);
    expect(asViewer?.occupation).toBeNull();
    // The raw visibility map itself is only ever handed back to the owner.
    expect(asViewer?.fieldVisibility).toBeNull();
  });

  it("shows a 'connections' field to a viewer with an accepted relationship (task #19)", async () => {
    const [owner] = await db
      .insert(users)
      .values({ email: uniqueEmail("owner-conn"), displayName: "Owner" })
      .returning();
    const [viewer] = await db
      .insert(users)
      .values({ email: uniqueEmail("viewer-conn"), displayName: "Viewer" })
      .returning();
    if (!owner || !viewer) throw new Error("setup failed");

    await updateProfile(db, owner.id, {
      displayName: "Owner",
      occupation: "Teacher",
      fieldVisibility: { occupation: "connections" },
    });

    const beforeConnecting = await getProfile(db, owner.id, viewer.id);
    expect(beforeConnecting?.occupation).toBeNull();

    const request = await requestRelationship(db, {
      fromUserId: viewer.id,
      toUserId: owner.id,
      type: "friend",
    });
    await acceptRelationship(db, request.id, owner.id);

    const afterConnecting = await getProfile(db, owner.id, viewer.id);
    expect(afterConnecting?.occupation).toBe("Teacher");
  });

  it("resolves the inviter's display name when invitedBy is set", async () => {
    const [inviter] = await db
      .insert(users)
      .values({ email: uniqueEmail("inviter"), displayName: "Inviter Name" })
      .returning();
    if (!inviter) throw new Error("setup failed");
    const [invitee] = await db
      .insert(users)
      .values({ email: uniqueEmail("invitee"), displayName: "Invitee", invitedBy: inviter.id })
      .returning();
    if (!invitee) throw new Error("setup failed");

    const profile = await getProfile(db, invitee.id, invitee.id);
    expect(profile?.inviterDisplayName).toBe("Inviter Name");
  });

  it("returns null for an unknown user id", async () => {
    await expect(getProfile(db, crypto.randomUUID(), crypto.randomUUID())).resolves.toBeNull();
  });
});
