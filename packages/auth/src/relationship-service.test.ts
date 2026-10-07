import { createDb, schema } from "@plumas/db";
import { describe, expect, it } from "vitest";

import {
  acceptRelationship,
  getRelationshipBetween,
  hasAcceptedRelationship,
  listAcceptedRelationships,
  listIncomingRequests,
  listOutgoingRequests,
  RelationshipExistsError,
  RelationshipForbiddenError,
  RelationshipNotFoundError,
  RelationshipSelfError,
  removeRelationship,
  requestRelationship,
} from "./relationship-service";

const { users } = schema;

function mustGetEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name} - run tests with .env sourced`);
  return value;
}

function uniqueEmail(label: string): string {
  return `${label}-${crypto.randomUUID()}@example.test`;
}

describe("relationship-service (integration, against the real local Postgres)", () => {
  const db = createDb(mustGetEnv("DATABASE_URL"));

  async function makeMember(gender: "masculine" | "feminine" | "neutral" = "neutral") {
    const [user] = await db
      .insert(users)
      .values({
        email: uniqueEmail("member"),
        displayName: `Test ${gender}`,
        role: "member",
        relationshipLabelGender: gender,
      })
      .returning();
    if (!user) throw new Error("setup failed");
    return user;
  }

  it("rejects requesting a relationship with yourself", async () => {
    const maria = await makeMember();
    await expect(
      requestRelationship(db, { fromUserId: maria.id, toUserId: maria.id, type: "friend" }),
    ).rejects.toThrow(RelationshipSelfError);
  });

  it("rejects a duplicate request when a relationship already exists between the pair", async () => {
    const maria = await makeMember();
    const jordan = await makeMember();
    await requestRelationship(db, { fromUserId: maria.id, toUserId: jordan.id, type: "parent" });

    await expect(
      requestRelationship(db, { fromUserId: maria.id, toUserId: jordan.id, type: "friend" }),
    ).rejects.toThrow(RelationshipExistsError);
    // Also blocked in the reverse direction - one row per unordered pair.
    await expect(
      requestRelationship(db, { fromUserId: jordan.id, toUserId: maria.id, type: "friend" }),
    ).rejects.toThrow(RelationshipExistsError);
  });

  it("only the recipient can accept, and inverse labels are gendered by each person's own preference", async () => {
    const maria = await makeMember("feminine");
    const jordan = await makeMember("masculine");
    const someoneElse = await makeMember();

    const request = await requestRelationship(db, {
      fromUserId: maria.id,
      toUserId: jordan.id,
      type: "parent",
    });

    await expect(acceptRelationship(db, request.id, maria.id)).rejects.toThrow(
      RelationshipForbiddenError,
    );
    await expect(acceptRelationship(db, request.id, someoneElse.id)).rejects.toThrow(
      RelationshipForbiddenError,
    );

    const accepted = await acceptRelationship(db, request.id, jordan.id);
    expect(accepted.status).toBe("accepted");
    // Idempotent re-accept.
    await expect(acceptRelationship(db, request.id, jordan.id)).resolves.toMatchObject({
      status: "accepted",
    });

    const mariasFamily = await listAcceptedRelationships(db, maria.id);
    expect(mariasFamily).toContainEqual(
      expect.objectContaining({ otherUserId: jordan.id, label: "Son" }),
    );

    const jordansFamily = await listAcceptedRelationships(db, jordan.id);
    expect(jordansFamily).toContainEqual(
      expect.objectContaining({ otherUserId: maria.id, label: "Mother" }),
    );
  });

  it("either party can remove a pending or accepted relationship", async () => {
    const maria = await makeMember();
    const jordan = await makeMember();
    const someoneElse = await makeMember();

    const pending = await requestRelationship(db, {
      fromUserId: maria.id,
      toUserId: jordan.id,
      type: "friend",
    });
    await expect(removeRelationship(db, pending.id, someoneElse.id)).rejects.toThrow(
      RelationshipForbiddenError,
    );
    // The recipient can decline a pending request.
    await removeRelationship(db, pending.id, jordan.id);
    expect(await getRelationshipBetween(db, maria.id, jordan.id)).toBeNull();

    const accepted = await requestRelationship(db, {
      fromUserId: maria.id,
      toUserId: jordan.id,
      type: "friend",
    });
    await acceptRelationship(db, accepted.id, jordan.id);
    // The requester can also remove an already-accepted relationship.
    await removeRelationship(db, accepted.id, maria.id);
    expect(await getRelationshipBetween(db, maria.id, jordan.id)).toBeNull();

    await expect(removeRelationship(db, accepted.id, maria.id)).rejects.toThrow(
      RelationshipNotFoundError,
    );
  });

  it("lists incoming and outgoing pending requests with correctly-directed labels", async () => {
    const maria = await makeMember("feminine");
    const jordan = await makeMember("masculine");
    await requestRelationship(db, { fromUserId: maria.id, toUserId: jordan.id, type: "parent" });

    const jordansIncoming = await listIncomingRequests(db, jordan.id);
    expect(jordansIncoming).toContainEqual(
      expect.objectContaining({ otherUserId: maria.id, label: "Mother" }),
    );

    const mariasOutgoing = await listOutgoingRequests(db, maria.id);
    expect(mariasOutgoing).toContainEqual(
      expect.objectContaining({ otherUserId: jordan.id, myLabel: "Mother" }),
    );
  });

  it("hasAcceptedRelationship is false until accepted, true after", async () => {
    const maria = await makeMember();
    const jordan = await makeMember();
    expect(await hasAcceptedRelationship(db, maria.id, jordan.id)).toBe(false);

    const request = await requestRelationship(db, {
      fromUserId: maria.id,
      toUserId: jordan.id,
      type: "friend",
    });
    expect(await hasAcceptedRelationship(db, maria.id, jordan.id)).toBe(false);

    await acceptRelationship(db, request.id, jordan.id);
    expect(await hasAcceptedRelationship(db, maria.id, jordan.id)).toBe(true);
  });
});
