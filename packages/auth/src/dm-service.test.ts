import { createDb, schema } from "@plumas/db";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { blockUser } from "./block-service";
import {
  claimKeyPackageForUser,
  countUnreadForUser,
  createDirectConversation,
  DmConversationRateLimitError,
  DmForbiddenError,
  DmMessageRateLimitError,
  DmSelfConversationError,
  DmUnsendWindowExpiredError,
  getBackup,
  hideConversationForUser,
  listConversationsForUser,
  listDevicesForUser,
  listMessages,
  markConversationRead,
  publishKeyPackages,
  registerDevice,
  searchMembers,
  sendMessage,
  unsendMessage,
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
    const sentRow = rows.find((row) => row.ciphertext?.equals(ciphertext));
    expect(sentRow).toBeDefined();
    expect(Object.keys(sentRow ?? {})).not.toContain("plaintext");

    const bobInbox = await listConversationsForUser(db, bob.id);
    expect(bobInbox[0]?.conversation.id).toBe(conversation.id);

    const history = await listMessages(db, {
      conversationId: conversation.id,
      userId: bob.id,
      limit: 10,
    });
    expect(history.some((row) => row.ciphertext?.equals(ciphertext))).toBe(true);
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

  it("rejects starting a new conversation with a blocked member, either direction (FR-MOD-03)", async () => {
    const alice = await makeMember("alice-blocked-dm");
    const bob = await makeMember("bob-blocked-dm");
    const aliceDevice = await makeDeviceWithKeyPackage(alice.id);

    await blockUser(db, bob.id, alice.id);

    await expect(
      createDirectConversation(db, {
        conversationId: crypto.randomUUID(),
        requesterId: alice.id,
        requesterDeviceId: aliceDevice.id,
        otherUserId: bob.id,
        epoch: 1,
        welcomeBytes: Buffer.from("welcome"),
      }),
    ).rejects.toThrow(DmForbiddenError);
  });

  it("stops an existing conversation from accepting new messages once either side blocks the other (FR-MOD-03)", async () => {
    const alice = await makeMember("alice-blocked-send");
    const bob = await makeMember("bob-blocked-send");
    const aliceDevice = await makeDeviceWithKeyPackage(alice.id);
    const bobDevice = await makeDeviceWithKeyPackage(bob.id);

    const conversation = await createDirectConversation(db, {
      conversationId: crypto.randomUUID(),
      requesterId: alice.id,
      requesterDeviceId: aliceDevice.id,
      otherUserId: bob.id,
      epoch: 1,
      welcomeBytes: Buffer.from("welcome"),
    });

    await blockUser(db, bob.id, alice.id);

    await expect(
      sendMessage(db, {
        conversationId: conversation.id,
        senderUserId: alice.id,
        senderDeviceId: aliceDevice.id,
        epoch: 1,
        ciphertext: Buffer.from("hello"),
      }),
    ).rejects.toThrow(DmForbiddenError);
    await expect(
      sendMessage(db, {
        conversationId: conversation.id,
        senderUserId: bob.id,
        senderDeviceId: bobDevice.id,
        epoch: 1,
        ciphertext: Buffer.from("hello"),
      }),
    ).rejects.toThrow(DmForbiddenError);
  });

  it("excludes a blocked member from the DM composer's member search (FR-MOD-03)", async () => {
    const searcher = await makeMember("searcher-blocked-search");
    const token = `huckleberry${crypto.randomUUID().slice(0, 8)}`;
    const target = await makeMember(`${token}-target`);

    expect((await searchMembers(db, token, searcher.id)).some((row) => row.id === target.id)).toBe(
      true,
    );

    await blockUser(db, searcher.id, target.id);
    expect((await searchMembers(db, token, searcher.id)).some((row) => row.id === target.id)).toBe(
      false,
    );
  });

  it("hides a direct conversation from the inbox once either side blocks the other (FR-DM-07)", async () => {
    const alice = await makeMember("alice-hide-blocked");
    const bob = await makeMember("bob-hide-blocked");
    const aliceDevice = await makeDeviceWithKeyPackage(alice.id);

    const conversation = await createDirectConversation(db, {
      conversationId: crypto.randomUUID(),
      requesterId: alice.id,
      requesterDeviceId: aliceDevice.id,
      otherUserId: bob.id,
      epoch: 1,
      welcomeBytes: Buffer.from("welcome"),
    });

    const hasIt = async (userId: string) =>
      (await listConversationsForUser(db, userId)).some(
        (row) => row.conversation.id === conversation.id,
      );
    expect(await hasIt(alice.id)).toBe(true);
    expect(await hasIt(bob.id)).toBe(true);

    await blockUser(db, bob.id, alice.id);

    expect(await hasIt(alice.id)).toBe(false);
    expect(await hasIt(bob.id)).toBe(false);
  });

  it("rejects starting more than 20 new conversations/day, but reopening an existing one is free (FR-DM-10)", async () => {
    const alice = await makeMember("alice-conv-limit");
    const aliceDevice = await makeDeviceWithKeyPackage(alice.id);

    const firstOther = await makeMember("conv-limit-0");
    const firstPair = await createDirectConversation(db, {
      conversationId: crypto.randomUUID(),
      requesterId: alice.id,
      requesterDeviceId: aliceDevice.id,
      otherUserId: firstOther.id,
      epoch: 1,
      welcomeBytes: Buffer.from("welcome"),
    });
    for (let i = 1; i < 20; i++) {
      const other = await makeMember(`conv-limit-${i.toString()}`);
      await createDirectConversation(db, {
        conversationId: crypto.randomUUID(),
        requesterId: alice.id,
        requesterDeviceId: aliceDevice.id,
        otherUserId: other.id,
        epoch: 1,
        welcomeBytes: Buffer.from("welcome"),
      });
    }

    const oneTooMany = await makeMember("conv-limit-20");
    await expect(
      createDirectConversation(db, {
        conversationId: crypto.randomUUID(),
        requesterId: alice.id,
        requesterDeviceId: aliceDevice.id,
        otherUserId: oneTooMany.id,
        epoch: 1,
        welcomeBytes: Buffer.from("welcome"),
      }),
    ).rejects.toThrow(DmConversationRateLimitError);

    // Reopening a pair that already has a conversation never spends the daily budget.
    const reopened = await createDirectConversation(db, {
      conversationId: crypto.randomUUID(),
      requesterId: alice.id,
      requesterDeviceId: aliceDevice.id,
      otherUserId: firstOther.id,
      epoch: 1,
      welcomeBytes: Buffer.from("welcome"),
    });
    expect(reopened.id).toBe(firstPair.id);
  });

  it("rejects sending more than 60 messages/minute (FR-DM-10)", async () => {
    const alice = await makeMember("alice-msg-limit");
    const bob = await makeMember("bob-msg-limit");
    const aliceDevice = await makeDeviceWithKeyPackage(alice.id);

    const conversation = await createDirectConversation(db, {
      conversationId: crypto.randomUUID(),
      requesterId: alice.id,
      requesterDeviceId: aliceDevice.id,
      otherUserId: bob.id,
      epoch: 1,
      welcomeBytes: Buffer.from("welcome"),
    });

    // createDirectConversation's own Welcome row counts as one of the 60 too (same
    // can't-tell-it-apart-from-ciphertext tradeoff as countUnreadForUser), so only 59 more fit.
    for (let i = 0; i < 59; i++) {
      await sendMessage(db, {
        conversationId: conversation.id,
        senderUserId: alice.id,
        senderDeviceId: aliceDevice.id,
        epoch: 1,
        ciphertext: Buffer.from(`msg-${i.toString()}`),
      });
    }

    await expect(
      sendMessage(db, {
        conversationId: conversation.id,
        senderUserId: alice.id,
        senderDeviceId: aliceDevice.id,
        epoch: 1,
        ciphertext: Buffer.from("one-too-many"),
      }),
    ).rejects.toThrow(DmMessageRateLimitError);
  });

  it("unsends a message within the window, deleting its ciphertext, but rejects a non-sender and a late attempt (FR-DM-16)", async () => {
    const alice = await makeMember("alice-unsend");
    const bob = await makeMember("bob-unsend");
    const aliceDevice = await makeDeviceWithKeyPackage(alice.id);

    const conversation = await createDirectConversation(db, {
      conversationId: crypto.randomUUID(),
      requesterId: alice.id,
      requesterDeviceId: aliceDevice.id,
      otherUserId: bob.id,
      epoch: 1,
      welcomeBytes: Buffer.from("welcome"),
    });
    const sent = await sendMessage(db, {
      conversationId: conversation.id,
      senderUserId: alice.id,
      senderDeviceId: aliceDevice.id,
      epoch: 1,
      ciphertext: Buffer.from("oops"),
    });

    await expect(unsendMessage(db, sent.id, bob.id)).rejects.toThrow(DmForbiddenError);

    await unsendMessage(db, sent.id, alice.id);
    const [afterUnsend] = await db.select().from(messages).where(eq(messages.id, sent.id));
    expect(afterUnsend?.ciphertext).toBeNull();
    expect(afterUnsend?.unsentAt).not.toBeNull();

    const late = await sendMessage(db, {
      conversationId: conversation.id,
      senderUserId: alice.id,
      senderDeviceId: aliceDevice.id,
      epoch: 1,
      ciphertext: Buffer.from("too-late"),
    });
    await db
      .update(messages)
      .set({ createdAt: new Date(Date.now() - 16 * 60 * 1000) })
      .where(eq(messages.id, late.id));
    await expect(unsendMessage(db, late.id, alice.id)).rejects.toThrow(DmUnsendWindowExpiredError);
  });

  it("deletes a conversation from only the hiding participant's inbox, until a new message revives it (FR-DM-16)", async () => {
    const alice = await makeMember("alice-hide-own");
    const bob = await makeMember("bob-hide-own");
    const aliceDevice = await makeDeviceWithKeyPackage(alice.id);
    const bobDevice = await makeDeviceWithKeyPackage(bob.id);

    const conversation = await createDirectConversation(db, {
      conversationId: crypto.randomUUID(),
      requesterId: alice.id,
      requesterDeviceId: aliceDevice.id,
      otherUserId: bob.id,
      epoch: 1,
      welcomeBytes: Buffer.from("welcome"),
    });

    const hasIt = async (userId: string) =>
      (await listConversationsForUser(db, userId)).some(
        (row) => row.conversation.id === conversation.id,
      );

    await hideConversationForUser(db, conversation.id, alice.id);
    expect(await hasIt(alice.id)).toBe(false);
    expect(await hasIt(bob.id)).toBe(true);

    await sendMessage(db, {
      conversationId: conversation.id,
      senderUserId: bob.id,
      senderDeviceId: bobDevice.id,
      epoch: 1,
      ciphertext: Buffer.from("still here?"),
    });
    expect(await hasIt(alice.id)).toBe(true);
  });

  it("tracks unread counts per conversation and clears them on markConversationRead (FR-DM-04)", async () => {
    const alice = await makeMember("alice-unread");
    const bob = await makeMember("bob-unread");
    const aliceDevice = await makeDeviceWithKeyPackage(alice.id);

    const conversation = await createDirectConversation(db, {
      conversationId: crypto.randomUUID(),
      requesterId: alice.id,
      requesterDeviceId: aliceDevice.id,
      otherUserId: bob.id,
      epoch: 1,
      welcomeBytes: Buffer.from("welcome"),
    });
    const firstMessage = await sendMessage(db, {
      conversationId: conversation.id,
      senderUserId: alice.id,
      senderDeviceId: aliceDevice.id,
      epoch: 1,
      ciphertext: Buffer.from("hi"),
    });

    // The conversation's own creation Welcome is a `messages` row too (the server can't tell it
    // apart from a real chat message - see countUnreadForUser's doc comment), so bob starts at 2.
    const unreadAfterFirst = await countUnreadForUser(db, bob.id);
    expect(unreadAfterFirst.byConversation[conversation.id]).toBe(2);
    expect(unreadAfterFirst.total).toBe(2);

    await markConversationRead(db, conversation.id, bob.id, firstMessage.id);
    const unreadAfterRead = await countUnreadForUser(db, bob.id);
    expect(unreadAfterRead.byConversation[conversation.id] ?? 0).toBe(0);

    await sendMessage(db, {
      conversationId: conversation.id,
      senderUserId: alice.id,
      senderDeviceId: aliceDevice.id,
      epoch: 1,
      ciphertext: Buffer.from("again"),
    });
    const unreadAfterSecond = await countUnreadForUser(db, bob.id);
    expect(unreadAfterSecond.byConversation[conversation.id]).toBe(1);

    // The read cursor never moves backward.
    await markConversationRead(db, conversation.id, bob.id, firstMessage.id);
    const unreadStillOne = await countUnreadForUser(db, bob.id);
    expect(unreadStillOne.byConversation[conversation.id]).toBe(1);
  });
});
