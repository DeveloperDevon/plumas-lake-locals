import { createDb, schema } from "@plumas/db";
import { describe, expect, it } from "vitest";

import { createBusiness } from "./business-service";
import {
  addGroupMember,
  createGroupConversation,
  DmGroupPermissionError,
  DmGroupSizeError,
  findBusinessConversationForUser,
  getConversationSummary,
  listConversationSummariesForUser,
  listMessages,
  listPendingDepartures,
  publishKeyPackages,
  registerDevice,
  removeGroupMember,
  requestToLeaveGroup,
  searchMembers,
  sendMessage,
} from "./dm-service";

const { users } = schema;

function mustGetEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name} - run tests with .env sourced`);
  return value;
}

function uniqueEmail(label: string): string {
  return `${label}-${crypto.randomUUID()}@example.test`;
}

describe("dm-service groups (integration, against the real local Postgres)", () => {
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

  async function makeGroupWithThreeMembers() {
    const alice = await makeMember("alice-group");
    const bob = await makeMember("bob-group");
    const carol = await makeMember("carol-group");
    const aliceDevice = await makeDeviceWithKeyPackage(alice.id);
    await makeDeviceWithKeyPackage(bob.id);
    await makeDeviceWithKeyPackage(carol.id);

    const conversation = await createGroupConversation(db, {
      conversationId: crypto.randomUUID(),
      creatorId: alice.id,
      creatorDeviceId: aliceDevice.id,
      name: "Lopez family",
      memberUserIds: [bob.id, carol.id],
      epoch: 1,
      welcomeBytes: Buffer.from("welcome"),
    });

    return { alice, bob, carol, aliceDevice, conversation };
  }

  it("creates a group conversation with the creator and every invited member active", async () => {
    const { alice, bob, carol, conversation } = await makeGroupWithThreeMembers();

    expect(conversation.kind).toBe("group");
    expect(conversation.name).toBe("Lopez family");
    expect(conversation.creatorId).toBe(alice.id);

    const aliceInbox = await listConversationSummariesForUser(db, alice.id);
    const bobInbox = await listConversationSummariesForUser(db, bob.id);
    const carolInbox = await listConversationSummariesForUser(db, carol.id);
    for (const inbox of [aliceInbox, bobInbox, carolInbox]) {
      const summary = inbox.find((row) => row.id === conversation.id);
      expect(summary).toBeDefined();
      expect(summary?.kind).toBe("group");
      expect(summary?.displayName).toBe("Lopez family");
      expect(summary?.memberCount).toBe(3);
    }
  });

  it("rejects creating a group over the 50-member cap", async () => {
    const alice = await makeMember("alice-cap");
    const aliceDevice = await makeDeviceWithKeyPackage(alice.id);
    const memberUserIds = Array.from({ length: 50 }, () => crypto.randomUUID());

    await expect(
      createGroupConversation(db, {
        conversationId: crypto.randomUUID(),
        creatorId: alice.id,
        creatorDeviceId: aliceDevice.id,
        name: "Too big",
        memberUserIds,
        epoch: 1,
        welcomeBytes: Buffer.from("welcome"),
      }),
    ).rejects.toThrow(DmGroupSizeError);
  });

  it("only lets the creator add a member", async () => {
    const { bob, carol, conversation } = await makeGroupWithThreeMembers();
    const dave = await makeMember("dave-group");
    const bobDevice = await makeDeviceWithKeyPackage(bob.id);

    await expect(
      addGroupMember(db, {
        conversationId: conversation.id,
        actingUserId: bob.id,
        actingDeviceId: bobDevice.id,
        newUserId: dave.id,
        epoch: 2,
        welcomeBytes: Buffer.from("welcome-2"),
        commitBytes: Buffer.from("commit-2"),
      }),
    ).rejects.toThrow(DmGroupPermissionError);

    const summaryBefore = await getConversationSummary(db, conversation.id, carol.id);
    expect(summaryBefore.memberCount).toBe(3);
  });

  it("lets the creator remove another member, but not a non-creator member", async () => {
    const { alice, bob, carol, aliceDevice, conversation } = await makeGroupWithThreeMembers();
    const bobDevice = await makeDeviceWithKeyPackage(bob.id);

    await expect(
      removeGroupMember(db, {
        conversationId: conversation.id,
        actingUserId: bob.id,
        actingDeviceId: bobDevice.id,
        targetUserId: carol.id,
        epoch: 2,
        commitBytes: Buffer.from("commit"),
      }),
    ).rejects.toThrow(DmGroupPermissionError);

    await removeGroupMember(db, {
      conversationId: conversation.id,
      actingUserId: alice.id,
      actingDeviceId: aliceDevice.id,
      targetUserId: carol.id,
      epoch: 2,
      commitBytes: Buffer.from("commit"),
    });

    const summary = await getConversationSummary(db, conversation.id, bob.id);
    expect(summary.memberCount).toBe(2);
  });

  it("lets a member request to leave, and any other member finalize it", async () => {
    const { bob, carol, conversation } = await makeGroupWithThreeMembers();
    const carolDevice = await makeDeviceWithKeyPackage(carol.id);

    await requestToLeaveGroup(db, conversation.id, bob.id);
    expect(await listPendingDepartures(db, conversation.id)).toContain(bob.id);

    // Carol isn't the creator, but finalizing a voluntary departure is allowed for any member.
    await removeGroupMember(db, {
      conversationId: conversation.id,
      actingUserId: carol.id,
      actingDeviceId: carolDevice.id,
      targetUserId: bob.id,
      epoch: 2,
      commitBytes: Buffer.from("commit"),
    });

    const summary = await getConversationSummary(db, conversation.id, carol.id);
    expect(summary.memberCount).toBe(2);
  });

  it("labels each message row with its sender's display name", async () => {
    const { bob, conversation } = await makeGroupWithThreeMembers();
    const bobDevice = await makeDeviceWithKeyPackage(bob.id);

    const ciphertext = Buffer.from("opaque-group-message-bytes");
    await sendMessage(db, {
      conversationId: conversation.id,
      senderUserId: bob.id,
      senderDeviceId: bobDevice.id,
      epoch: 1,
      ciphertext,
    });

    const history = await listMessages(db, {
      conversationId: conversation.id,
      userId: bob.id,
      limit: 10,
    });
    const sentRow = history.find((row) => row.ciphertext?.equals(ciphertext));
    expect(sentRow?.senderUserId).toBe(bob.id);
    expect(sentRow?.senderDisplayName).toBe("Test bob-group");
  });

  it("searches active members by name, excluding the searcher and suspended members", async () => {
    const searcher = await makeMember("searcher");
    const findable = await makeMember("findable-target");
    const [suspended] = await db
      .insert(users)
      .values({
        email: uniqueEmail("suspended-target"),
        displayName: "Findable Suspended",
        role: "member",
        status: "suspended",
      })
      .returning();
    if (!suspended) throw new Error("setup failed");

    const results = await searchMembers(db, "findable", searcher.id);
    const ids = results.map((row) => row.id);
    expect(ids).toContain(findable.id);
    expect(ids).not.toContain(suspended.id);
    expect(ids).not.toContain(searcher.id);
  });

  it("tags a group conversation with its businessId, findable and reused on a second lookup (FR-DM-15)", async () => {
    const customer = await makeMember("customer-biz-dm");
    const owner = await makeMember("owner-biz-dm");
    const customerDevice = await makeDeviceWithKeyPackage(customer.id);
    await makeDeviceWithKeyPackage(owner.id);
    const business = await createBusiness(db, {
      ownerId: owner.id,
      name: "Lopez Landscaping",
      serviceArea: "Plumas Lake",
    });

    expect(await findBusinessConversationForUser(db, business.id, customer.id)).toBeNull();

    const conversation = await createGroupConversation(db, {
      conversationId: crypto.randomUUID(),
      creatorId: customer.id,
      creatorDeviceId: customerDevice.id,
      name: business.name,
      memberUserIds: [owner.id],
      epoch: 1,
      welcomeBytes: Buffer.from("welcome"),
      businessId: business.id,
    });

    const found = await findBusinessConversationForUser(db, business.id, customer.id);
    expect(found?.id).toBe(conversation.id);
    // Not a participant in this business's thread - no match for someone else.
    expect(await findBusinessConversationForUser(db, business.id, owner.id)).not.toBeNull();
    const stranger = await makeMember("stranger-biz-dm");
    expect(await findBusinessConversationForUser(db, business.id, stranger.id)).toBeNull();
  });
});
