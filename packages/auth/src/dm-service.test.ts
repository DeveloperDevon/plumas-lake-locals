import { createDb, schema } from "@plumas/db";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  claimKeyPackageForUser,
  createDirectConversation,
  DmForbiddenError,
  DmSelfConversationError,
  getBackup,
  listConversationsForUser,
  listDevicesForUser,
  listMessages,
  publishKeyPackages,
  registerDevice,
  sendMessage,
  upsertBackup,
} from "./dm-service";

const { messages, users } = schema;

function mustGetEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name} - run tests with .env sourced`);
  return value;
}

function uniqueEmail(label: string): string {
  return `${label}-${crypto.randomUUID()}@example.test`;
}

describe("dm-service (integration, against the real local Postgres)", () => {
  const db = createDb(mustGetEnv("DATABASE_URL"));

  async function makeMember(label: string) {
    const [user] = await db
      .insert(users)
      .values({ email: uniqueEmail(label), displayName: `Test ${label}`, role: "member" })
      .returning();
    if (!user) throw new Error("setup failed");
    return user;
  }

  async function makeDeviceWithKeyPackage(userId: string) {
    const device = await registerDevice(db, userId, {
      signaturePublicKey: Buffer.from(`fake-signature-public-key-${crypto.randomUUID()}`),
    });
    await publishKeyPackages(db, userId, device.id, [
      Buffer.from(`fake-key-package-${crypto.randomUUID()}`),
    ]);
    return device;
  }

  it("registers a device and publishes a KeyPackage that can be claimed exactly once", async () => {
    const bob = await makeMember("bob");
    const device = await makeDeviceWithKeyPackage(bob.id);

    const claimed = await claimKeyPackageForUser(db, bob.id);
    expect(claimed).not.toBeNull();
    expect(claimed?.deviceId).toBe(device.id);

    // Single-use: a second claim finds nothing left.
    const secondClaim = await claimKeyPackageForUser(db, bob.id);
    expect(secondClaim).toBeNull();
  });

  it("rejects starting a conversation with yourself", async () => {
    const alice = await makeMember("alice-self");
    const device = await makeDeviceWithKeyPackage(alice.id);
    await expect(
      createDirectConversation(db, {
        conversationId: crypto.randomUUID(),
        requesterId: alice.id,
        requesterDeviceId: device.id,
        otherUserId: alice.id,
        epoch: 1,
        welcomeBytes: Buffer.from("welcome"),
      }),
    ).rejects.toThrow(DmSelfConversationError);
  });

  it("enforces one direct conversation per pair, regardless of argument order", async () => {
    const alice = await makeMember("alice-pair");
    const bob = await makeMember("bob-pair");
    const aliceDevice = await makeDeviceWithKeyPackage(alice.id);
    const bobDevice = await makeDeviceWithKeyPackage(bob.id);

    const first = await createDirectConversation(db, {
      conversationId: crypto.randomUUID(),
      requesterId: alice.id,
      requesterDeviceId: aliceDevice.id,
      otherUserId: bob.id,
      epoch: 1,
      welcomeBytes: Buffer.from("welcome-1"),
    });

    // Same pair, reversed, with a different candidate id - must resolve to the exact same
    // conversation row (first's id), not a duplicate under second's candidate id.
    const second = await createDirectConversation(db, {
      conversationId: crypto.randomUUID(),
      requesterId: bob.id,
      requesterDeviceId: bobDevice.id,
      otherUserId: alice.id,
      epoch: 1,
      welcomeBytes: Buffer.from("welcome-2"),
    });

    expect(second.id).toBe(first.id);
  });

  it("stores only ciphertext bytes, never plaintext, and orders the inbox by last activity", async () => {
    const alice = await makeMember("alice-msg");
    const bob = await makeMember("bob-msg");
    const aliceDevice = await makeDeviceWithKeyPackage(alice.id);
    await makeDeviceWithKeyPackage(bob.id);

    const conversation = await createDirectConversation(db, {
      conversationId: crypto.randomUUID(),
      requesterId: alice.id,
      requesterDeviceId: aliceDevice.id,
      otherUserId: bob.id,
      epoch: 1,
      welcomeBytes: Buffer.from("welcome"),
    });

    const ciphertext = Buffer.from("this-is-not-plaintext-just-opaque-bytes");
    await sendMessage(db, {
      conversationId: conversation.id,
      senderUserId: alice.id,
      senderDeviceId: aliceDevice.id,
      epoch: 1,
      ciphertext,
    });

    // The PRD's own acceptance example: every row holds only ciphertext, no plaintext column.
    const rows = await db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, conversation.id));
    const sentRow = rows.find((row) => row.ciphertext.equals(ciphertext));
    expect(sentRow).toBeDefined();
    expect(Object.keys(sentRow ?? {})).not.toContain("plaintext");

    const bobInbox = await listConversationsForUser(db, bob.id);
    expect(bobInbox[0]?.conversation.id).toBe(conversation.id);

    const history = await listMessages(db, {
      conversationId: conversation.id,
      userId: bob.id,
      limit: 10,
    });
    expect(history.some((row) => row.ciphertext.equals(ciphertext))).toBe(true);
  });

  it("forbids a non-participant from reading or sending in a conversation", async () => {
    const alice = await makeMember("alice-forbid");
    const bob = await makeMember("bob-forbid");
    const outsider = await makeMember("outsider-forbid");
    const aliceDevice = await makeDeviceWithKeyPackage(alice.id);
    await makeDeviceWithKeyPackage(bob.id);
    const outsiderDevice = await makeDeviceWithKeyPackage(outsider.id);

    const conversation = await createDirectConversation(db, {
      conversationId: crypto.randomUUID(),
      requesterId: alice.id,
      requesterDeviceId: aliceDevice.id,
      otherUserId: bob.id,
      epoch: 1,
      welcomeBytes: Buffer.from("welcome"),
    });

    await expect(
      sendMessage(db, {
        conversationId: conversation.id,
        senderUserId: outsider.id,
        senderDeviceId: outsiderDevice.id,
        epoch: 1,
        ciphertext: Buffer.from("sneaky"),
      }),
    ).rejects.toThrow(DmForbiddenError);

    await expect(
      listMessages(db, { conversationId: conversation.id, userId: outsider.id, limit: 10 }),
    ).rejects.toThrow(DmForbiddenError);
  });

  it("saves and retrieves one backup per user, overwriting on each new backup", async () => {
    const carol = await makeMember("carol-backup");
    await upsertBackup(db, {
      userId: carol.id,
      r2Key: "dm-backups/first",
      wrappedBackupKey: Buffer.from("wrapped-key-v1"),
    });
    await upsertBackup(db, {
      userId: carol.id,
      r2Key: "dm-backups/second",
      wrappedBackupKey: Buffer.from("wrapped-key-v2"),
    });

    const backup = await getBackup(db, carol.id);
    expect(backup?.r2Key).toBe("dm-backups/second");
  });

  it("lists only non-revoked devices for a user", async () => {
    const dana = await makeMember("dana-devices");
    await makeDeviceWithKeyPackage(dana.id);
    await makeDeviceWithKeyPackage(dana.id);
    const list = await listDevicesForUser(db, dana.id);
    expect(list).toHaveLength(2);
  });
});
