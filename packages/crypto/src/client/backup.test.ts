/**
 * Proves the full-device backup actually restores working state: a device with an unconsumed
 * KeyPackage and an active conversation backs up, a brand new "device" (fresh IndexedDB)
 * restores from the recovery key, and can both join a pending invite with the restored
 * KeyPackage and keep talking in the restored conversation.
 */
import "fake-indexeddb/auto";

import { beforeEach, describe, expect, it } from "vitest";

import { createFullBackup, generateRecoveryKey, restoreFullBackup } from "./backup.js";
import {
  createConversation,
  encryptMessage,
  generateKeyPackages,
  processIncoming,
} from "./engine.js";
import { __setDatabaseNameForTests } from "./storage.js";

const DEVICE_DB = "test-backup-device";
const RESTORED_DB = "test-backup-restored";
const PEER_DB = "test-backup-peer";

async function use(name: string): Promise<void> {
  await __setDatabaseNameForTests(name);
}

describe("full device backup/restore", () => {
  const conversationId = "22222222-2222-2222-2222-222222222222";

  beforeEach(async () => {
    for (const name of [DEVICE_DB, RESTORED_DB, PEER_DB]) {
      await use(name);
      indexedDB.deleteDatabase(name);
    }
  });

  it("restores an unconsumed KeyPackage and an active conversation onto a fresh device", async () => {
    await use(PEER_DB);
    const [peerKeyPackage] = await generateKeyPackages("peer", 1);
    if (!peerKeyPackage) throw new Error("Expected a generated KeyPackage");

    await use(DEVICE_DB);
    const created = await createConversation("me", conversationId, [
      peerKeyPackage.publicPackageBytes,
    ]);

    await use(PEER_DB);
    await processIncoming("msg-welcome", conversationId, created.welcomeBytes);
    const wireFromPeerBeforeBackup = (await encryptMessage(conversationId, "before the backup"))
      .wireBytes;

    await use(DEVICE_DB);
    await processIncoming("msg-before-backup", conversationId, wireFromPeerBeforeBackup);

    // A second, still-unconsumed KeyPackage represents a pending invite nobody has used yet.
    const [spareKeyPackage] = await generateKeyPackages("me", 1);
    if (!spareKeyPackage) throw new Error("Expected a generated KeyPackage");

    const recoveryKey = generateRecoveryKey();
    const backup = await createFullBackup(recoveryKey);

    await use(RESTORED_DB);
    await restoreFullBackup(recoveryKey, backup);

    // The restored device can still send/receive on the conversation it had before backup.
    const wireFromPeerAfterRestore = await (async () => {
      await use(PEER_DB);
      const wire = (await encryptMessage(conversationId, "after the restore")).wireBytes;
      await use(RESTORED_DB);
      return wire;
    })();
    const restoredReceives = await processIncoming(
      "msg-after-restore",
      conversationId,
      wireFromPeerAfterRestore,
    );
    expect(restoredReceives).toEqual({
      kind: "applicationMessage",
      plaintext: "after the restore",
    });

    // And the restored device can still join a brand new conversation using the spare
    // KeyPackage that was backed up before it was ever consumed.
    await use(PEER_DB);
    const secondConversationId = "33333333-3333-3333-3333-333333333333";
    const secondInvite = await createConversation("peer", secondConversationId, [
      spareKeyPackage.publicPackageBytes,
    ]);

    await use(RESTORED_DB);
    const joinResult = await processIncoming(
      "msg-second-welcome",
      secondConversationId,
      secondInvite.welcomeBytes,
    );
    expect(joinResult).toEqual({ kind: "joined" });
  });

  it("carries the processed-message cache across restore, so re-walking old history is a cache hit", async () => {
    // Regression test: a real two-account browser run surfaced this - decryptMessages re-walks
    // full conversation history on every load, and a restored device that re-processes a row it
    // already decrypted *before* the backup was taken hit the same "desired generation in the
    // past" failure as the same-session double-process case (engine.test.ts), just reached via
    // backup/restore instead of a duplicate effect run.
    await use(PEER_DB);
    const [peerKeyPackage] = await generateKeyPackages("peer", 1);
    if (!peerKeyPackage) throw new Error("Expected a generated KeyPackage");

    await use(DEVICE_DB);
    const created = await createConversation("me", conversationId, [
      peerKeyPackage.publicPackageBytes,
    ]);
    await processIncoming("msg-welcome", conversationId, created.welcomeBytes);

    await use(PEER_DB);
    await processIncoming("msg-welcome", conversationId, created.welcomeBytes);
    const wire = (await encryptMessage(conversationId, "hello before backup")).wireBytes;

    await use(DEVICE_DB);
    const firstProcess = await processIncoming("msg-1", conversationId, wire);
    expect(firstProcess).toEqual({ kind: "applicationMessage", plaintext: "hello before backup" });

    const recoveryKey = generateRecoveryKey();
    const backup = await createFullBackup(recoveryKey);

    await use(RESTORED_DB);
    await restoreFullBackup(recoveryKey, backup);

    // The restored device re-walks history from the top, as decryptMessages does on every load -
    // "msg-welcome" and "msg-1" are both rows it already has a cached result for.
    const replayedWelcome = await processIncoming(
      "msg-welcome",
      conversationId,
      created.welcomeBytes,
    );
    const replayedMessage = await processIncoming("msg-1", conversationId, wire);
    expect(replayedWelcome).toEqual({ kind: "ignored" });
    expect(replayedMessage).toEqual(firstProcess);
  });
});
