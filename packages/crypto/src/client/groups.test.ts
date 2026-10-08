/**
 * Verifies the group-conversation mechanics task #23 adds to engine.ts, against the real
 * installed ts-mls v1.6.4 (not just its `.d.ts` types) - the same "prove it against the actual
 * library" discipline as task #21's spike and task #22's engine.test.ts:
 *   - one commit with multiple Add proposals produces a single Welcome every new member can
 *     join from independently (nothing here was exercised by task #22's 1:1-only tests)
 *   - removing a member (by scanning the remover's own ratchet tree for the target's identity
 *     and committing a Remove) actually excludes them from future epochs - they can't decrypt
 *     a message sent after their removal
 *   - a member can't remove themselves (confirmed empirically - ts-mls rejects it), so leaving
 *     is two-phase: `leaveGroupLocally` on the leaver's own device, then another member's
 *     device calls `removeGroupMember` on their behalf
 */
import "fake-indexeddb/auto";

import { beforeEach, describe, expect, it } from "vitest";

import {
  createConversation,
  encryptMessage,
  generateKeyPackages,
  leaveGroupLocally,
  listMyConversationIds,
  processIncoming,
  removeGroupMember,
} from "./engine.js";
import { __setDatabaseNameForTests } from "./storage.js";

const ALICE_DB = "test-groups-alice";
const BOB_DB = "test-groups-bob";
const CAROL_DB = "test-groups-carol";

async function asAlice(): Promise<void> {
  await __setDatabaseNameForTests(ALICE_DB);
}
async function asBob(): Promise<void> {
  await __setDatabaseNameForTests(BOB_DB);
}
async function asCarol(): Promise<void> {
  await __setDatabaseNameForTests(CAROL_DB);
}

describe("group conversations", () => {
  const conversationId = "44444444-4444-4444-4444-444444444444";

  beforeEach(async () => {
    for (const name of [ALICE_DB, BOB_DB, CAROL_DB]) {
      await __setDatabaseNameForTests(name);
      indexedDB.deleteDatabase(name);
    }
  });

  async function createThreeMemberGroup() {
    await asBob();
    const [bobKeyPackage] = await generateKeyPackages("bob", 1);
    if (!bobKeyPackage) throw new Error("Expected a generated KeyPackage");

    await asCarol();
    const [carolKeyPackage] = await generateKeyPackages("carol", 1);
    if (!carolKeyPackage) throw new Error("Expected a generated KeyPackage");

    await asAlice();
    const created = await createConversation("alice", conversationId, [
      bobKeyPackage.publicPackageBytes,
      carolKeyPackage.publicPackageBytes,
    ]);

    await asBob();
    const bobJoin = await processIncoming("msg-welcome", conversationId, created.welcomeBytes);
    expect(bobJoin).toEqual({ kind: "joined" });

    await asCarol();
    const carolJoin = await processIncoming("msg-welcome", conversationId, created.welcomeBytes);
    expect(carolJoin).toEqual({ kind: "joined" });

    return created;
  }

  it("creates a group with two initial members from one commit, and both can join and decrypt", async () => {
    await createThreeMemberGroup();

    await asAlice();
    const wireFromAlice = (await encryptMessage(conversationId, "Welcome to the family chat!"))
      .wireBytes;

    await asBob();
    const bobReceives = await processIncoming("msg-1", conversationId, wireFromAlice);
    expect(bobReceives).toEqual({
      kind: "applicationMessage",
      plaintext: "Welcome to the family chat!",
    });

    await asCarol();
    const carolReceives = await processIncoming("msg-1", conversationId, wireFromAlice);
    expect(carolReceives).toEqual({
      kind: "applicationMessage",
      plaintext: "Welcome to the family chat!",
    });
  });

  it("removes a member so they can no longer decrypt messages sent afterward", async () => {
    await createThreeMemberGroup();

    await asAlice();
    const removeResult = await removeGroupMember(conversationId, "carol");

    await asBob();
    const bobAppliesRemoval = await processIncoming(
      "msg-remove-commit",
      conversationId,
      removeResult.commitBytes,
    );
    expect(bobAppliesRemoval).toEqual({ kind: "stateUpdated" });

    await asAlice();
    const wireAfterRemoval = (
      await encryptMessage(conversationId, "Alice here, now that it's just us")
    ).wireBytes;

    await asBob();
    const bobReceives = await processIncoming("msg-2", conversationId, wireAfterRemoval);
    expect(bobReceives).toEqual({
      kind: "applicationMessage",
      plaintext: "Alice here, now that it's just us",
    });

    // Carol's client never applies the removal commit (she's no longer fetched for this
    // conversation server-side once removed) - her stale state can't decrypt a post-removal
    // message, proving the removal actually excludes her from the new epoch's keys.
    await asCarol();
    await expect(processIncoming("msg-2", conversationId, wireAfterRemoval)).rejects.toThrow();
  });

  it("lets a member leave: their own device forgets it locally, another member finalizes the MLS removal", async () => {
    await createThreeMemberGroup();

    await asBob();
    await leaveGroupLocally(conversationId);
    expect(await listMyConversationIds()).not.toContain(conversationId);

    // Alice (any other member with local state - not necessarily the creator) notices Bob's
    // departure and performs the actual MLS removal on his behalf.
    await asAlice();
    const finalizeResult = await removeGroupMember(conversationId, "bob");

    await asCarol();
    const carolAppliesLeave = await processIncoming(
      "msg-leave-commit",
      conversationId,
      finalizeResult.commitBytes,
    );
    expect(carolAppliesLeave).toEqual({ kind: "stateUpdated" });

    await asAlice();
    const wireAfterLeaving = (await encryptMessage(conversationId, "Alice and Carol only now"))
      .wireBytes;

    await asCarol();
    const carolReceives = await processIncoming("msg-3", conversationId, wireAfterLeaving);
    expect(carolReceives).toEqual({
      kind: "applicationMessage",
      plaintext: "Alice and Carol only now",
    });
  });
});
