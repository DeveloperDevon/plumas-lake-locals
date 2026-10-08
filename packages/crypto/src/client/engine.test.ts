/**
 * Exercises engine.ts against a real IndexedDB (via fake-indexeddb, since Node has none built
 * in) rather than the spike's in-memory-only ClientState objects - this is what actually proves
 * persistence/reload works, which the spike never needed to.
 *
 * Alice and Bob are simulated as two separate devices by giving each their own IndexedDB
 * database name (storage.ts's module-level db handle is swapped via `__setDatabaseNameForTests`
 * before each one's calls) - a real deployment never does this, since one browser profile has
 * exactly one IndexedDB.
 */
import "fake-indexeddb/auto";

import { beforeEach, describe, expect, it } from "vitest";

import {
  addDeviceToConversation,
  createConversation,
  encryptMessage,
  generateKeyPackages,
  processIncoming,
} from "./engine.js";
import { __setDatabaseNameForTests } from "./storage.js";

const ALICE_DB = "test-alice";
const BOB_DB = "test-bob";

async function asAlice(): Promise<void> {
  await __setDatabaseNameForTests(ALICE_DB);
}
async function asBob(): Promise<void> {
  await __setDatabaseNameForTests(BOB_DB);
}

describe("DM client engine", () => {
  const conversationId = "11111111-1111-1111-1111-111111111111";

  beforeEach(async () => {
    await asAlice();
    indexedDB.deleteDatabase(ALICE_DB);
    await asBob();
    indexedDB.deleteDatabase(BOB_DB);
  });

  it("creates a 1:1 conversation, joins from a Welcome, and exchanges messages both ways", async () => {
    await asBob();
    const [bobKeyPackage] = await generateKeyPackages("bob", 1);
    if (!bobKeyPackage) throw new Error("Expected a generated KeyPackage");

    await asAlice();
    const created = await createConversation(
      "alice",
      conversationId,
      bobKeyPackage.publicPackageBytes,
    );

    await asBob();
    const joinResult = await processIncoming("msg-welcome", conversationId, created.welcomeBytes);
    expect(joinResult).toEqual({ kind: "joined" });

    await asAlice();
    const wireToBob = (await encryptMessage(conversationId, "Hello Bob, this is Alice.")).wireBytes;

    await asBob();
    const bobReceived = await processIncoming("msg-to-bob", conversationId, wireToBob);
    expect(bobReceived).toEqual({
      kind: "applicationMessage",
      plaintext: "Hello Bob, this is Alice.",
    });

    const wireToAlice = (await encryptMessage(conversationId, "Hi Alice, Bob here.")).wireBytes;

    await asAlice();
    const aliceReceived = await processIncoming("msg-to-alice", conversationId, wireToAlice);
    expect(aliceReceived).toEqual({
      kind: "applicationMessage",
      plaintext: "Hi Alice, Bob here.",
    });
  });

  it("replays the cached result instead of re-touching MLS state for a message id already processed", async () => {
    // Regression test: a real two-account browser run surfaced this - decryptMessages gets
    // called more than once for the same history (a second effect run, a re-render, a plain
    // refetch), and MLS state only ever moves forward, so decrypting the same application
    // message a second time failed outright ("desired generation in the past").
    await asBob();
    const [bobKeyPackage] = await generateKeyPackages("bob", 1);
    if (!bobKeyPackage) throw new Error("Expected a generated KeyPackage");

    await asAlice();
    const created = await createConversation(
      "alice",
      conversationId,
      bobKeyPackage.publicPackageBytes,
    );
    const wireToBob = (await encryptMessage(conversationId, "Hello Bob, this is Alice.")).wireBytes;

    await asBob();
    await processIncoming("msg-welcome", conversationId, created.welcomeBytes);
    const first = await processIncoming("msg-to-bob", conversationId, wireToBob);
    const second = await processIncoming("msg-to-bob", conversationId, wireToBob);
    expect(first).toEqual({ kind: "applicationMessage", plaintext: "Hello Bob, this is Alice." });
    expect(second).toEqual(first);
  });

  it("lets an existing member add a second device, and has the new device decrypt history", async () => {
    await asBob();
    const [bobKeyPackage] = await generateKeyPackages("bob", 1);
    if (!bobKeyPackage) throw new Error("Expected a generated KeyPackage");

    await asAlice();
    const created = await createConversation(
      "alice",
      conversationId,
      bobKeyPackage.publicPackageBytes,
    );

    await asBob();
    await processIncoming("msg-welcome-1", conversationId, created.welcomeBytes);

    const BOB_SECOND_DEVICE_DB = "test-bob-second-device";
    await __setDatabaseNameForTests(BOB_SECOND_DEVICE_DB);
    indexedDB.deleteDatabase(BOB_SECOND_DEVICE_DB);
    await __setDatabaseNameForTests(BOB_SECOND_DEVICE_DB);
    const [bobSecondDeviceKeyPackage] = await generateKeyPackages("bob", 1);
    if (!bobSecondDeviceKeyPackage) throw new Error("Expected a generated KeyPackage");

    await asBob();
    const addResult = await addDeviceToConversation(
      conversationId,
      bobSecondDeviceKeyPackage.publicPackageBytes,
    );

    await __setDatabaseNameForTests(BOB_SECOND_DEVICE_DB);
    const secondDeviceJoin = await processIncoming(
      "msg-welcome-2",
      conversationId,
      addResult.welcomeBytes,
    );
    expect(secondDeviceJoin).toEqual({ kind: "joined" });

    await asAlice();
    // Alice's client must also apply the add commit to stay in sync.
    const aliceAppliesCommit = await processIncoming(
      "msg-add-commit",
      conversationId,
      addResult.commitBytes,
    );
    expect(aliceAppliesCommit).toEqual({ kind: "stateUpdated" });

    const wireFromAlice = (await encryptMessage(conversationId, "Welcome to your new device, Bob!"))
      .wireBytes;

    await __setDatabaseNameForTests(BOB_SECOND_DEVICE_DB);
    const secondDeviceReceived = await processIncoming(
      "msg-from-alice",
      conversationId,
      wireFromAlice,
    );
    expect(secondDeviceReceived).toEqual({
      kind: "applicationMessage",
      plaintext: "Welcome to your new device, Bob!",
    });
  });

  it("ignores the Add commit a Welcome was generated from, since joinGroup already applied it", async () => {
    // Regression test: a real two-account browser run surfaced this - a freshly joined device
    // that later re-fetches full history (including the creator's own Add commit row) must not
    // try to re-apply that commit, since joinGroup already produced the post-commit state
    // directly from the Welcome. Processing it again was failing because its epoch (the
    // pre-commit epoch) is behind the joined device's current epoch.
    await asBob();
    const [bobKeyPackage] = await generateKeyPackages("bob", 1);
    if (!bobKeyPackage) throw new Error("Expected a generated KeyPackage");

    await asAlice();
    const created = await createConversation(
      "alice",
      conversationId,
      bobKeyPackage.publicPackageBytes,
    );

    await asBob();
    await processIncoming("msg-welcome", conversationId, created.welcomeBytes);

    const result = await processIncoming("msg-commit", conversationId, created.commitBytes);
    expect(result).toEqual({ kind: "ignored" });
  });

  it("ignores a Welcome meant for someone else when local state already exists", async () => {
    await asBob();
    const [bobKeyPackage] = await generateKeyPackages("bob", 1);
    if (!bobKeyPackage) throw new Error("Expected a generated KeyPackage");

    await asAlice();
    const created = await createConversation(
      "alice",
      conversationId,
      bobKeyPackage.publicPackageBytes,
    );

    await asBob();
    await processIncoming("msg-welcome-1", conversationId, created.welcomeBytes);

    // Bob (already joined) later sees a DIFFERENT row carrying a welcome - this models e.g. a
    // Welcome for one of his other devices showing up in the same conversation's history, not a
    // refetch of the exact same row (that case is covered by the idempotency-cache test above).
    const result = await processIncoming("msg-welcome-2", conversationId, created.welcomeBytes);
    expect(result).toEqual({ kind: "ignored" });
  });
});
