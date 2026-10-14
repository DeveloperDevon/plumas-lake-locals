import { createDb, schema } from "@plumas/db";
import { describe, expect, it } from "vitest";

import {
  blockUser,
  getBlockedUserIdSet,
  isBlockedEitherWay,
  listBlockedUsers,
  unblockUser,
} from "./block-service";

const { users } = schema;

function mustGetEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name} - run tests with .env sourced`);
  return value;
}

function uniqueEmail(label: string): string {
  return `${label}-${crypto.randomUUID()}@example.test`;
}

describe("block-service (integration, against the real local Postgres)", () => {
  const db = createDb(mustGetEnv("DATABASE_URL"));

  async function makeMember(label: string) {
    const [user] = await db
      .insert(users)
      .values({ email: uniqueEmail(label), displayName: `Test ${label}` })
      .returning();
    if (!user) throw new Error("setup failed");
    return user;
  }

  it("blocks and unblocks, and is idempotent to re-block", async () => {
    const blocker = await makeMember("blocker-basic");
    const blocked = await makeMember("blocked-basic");

    expect(await isBlockedEitherWay(db, blocker.id, blocked.id)).toBe(false);

    await blockUser(db, blocker.id, blocked.id);
    await blockUser(db, blocker.id, blocked.id); // re-block, should not throw
    expect(await isBlockedEitherWay(db, blocker.id, blocked.id)).toBe(true);

    await unblockUser(db, blocker.id, blocked.id);
    expect(await isBlockedEitherWay(db, blocker.id, blocked.id)).toBe(false);
  });

  it("isBlockedEitherWay is symmetric regardless of who blocked whom", async () => {
    const a = await makeMember("a-symmetric");
    const b = await makeMember("b-symmetric");

    await blockUser(db, a.id, b.id);
    expect(await isBlockedEitherWay(db, a.id, b.id)).toBe(true);
    expect(await isBlockedEitherWay(db, b.id, a.id)).toBe(true);
  });

  it("listBlockedUsers returns only who this user blocked, not who blocked them", async () => {
    const viewer = await makeMember("viewer-list");
    const blockedByViewer = await makeMember("blocked-by-viewer");
    const blockerOfViewer = await makeMember("blocker-of-viewer");

    await blockUser(db, viewer.id, blockedByViewer.id);
    await blockUser(db, blockerOfViewer.id, viewer.id);

    const list = await listBlockedUsers(db, viewer.id);
    expect(list.some((row) => row.id === blockedByViewer.id)).toBe(true);
    expect(list.some((row) => row.id === blockerOfViewer.id)).toBe(false);
  });

  it("getBlockedUserIdSet includes both directions", async () => {
    const viewer = await makeMember("viewer-set");
    const blockedByViewer = await makeMember("blocked-by-viewer-set");
    const blockerOfViewer = await makeMember("blocker-of-viewer-set");
    const unrelated = await makeMember("unrelated-set");

    await blockUser(db, viewer.id, blockedByViewer.id);
    await blockUser(db, blockerOfViewer.id, viewer.id);

    const ids = await getBlockedUserIdSet(db, viewer.id);
    expect(ids.has(blockedByViewer.id)).toBe(true);
    expect(ids.has(blockerOfViewer.id)).toBe(true);
    expect(ids.has(unrelated.id)).toBe(false);
  });
});
