import {
  addGroupMember,
  claimKeyPackageForUser,
  createDirectConversation,
  createGroupConversation,
  DmNoKeyPackageError,
  getBackup,
  getConversationSummary,
  listConversationSummariesForUser,
  listDevicesForUser,
  listGroupMembers,
  listMessages,
  listPendingDepartures,
  publishKeyPackages,
  recordDeviceLinkOperations,
  registerDevice,
  removeGroupMember,
  requestToLeaveGroup,
  searchMembers,
  sendMessage,
  upsertBackup,
} from "@plumas/auth";
import {
  addDeviceToConversationsSchema,
  addGroupMemberSchema,
  createBackupSchema,
  listMessagesSchema,
  publishKeyPackagesSchema,
  registerDeviceSchema,
  removeGroupMemberSchema,
  searchMembersSchema,
  sendMessageSchema,
  startDirectConversationSchema,
  startGroupConversationSchema,
} from "@plumas/validators";
import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { z } from "zod";

import { requireUser } from "../auth";
import { getDb } from "../db";

export const registerDeviceFn = createServerFn({ method: "POST" })
  .validator(registerDeviceSchema)
  .handler(async ({ data }) => {
    const user = await requireUser();
    const row = await registerDevice(getDb(), user.id, {
      label: data.label,
      signaturePublicKey: Buffer.from(data.signaturePublicKey, "base64"),
    });
    return { deviceId: row.id };
  });

export const publishKeyPackagesFn = createServerFn({ method: "POST" })
  .validator(publishKeyPackagesSchema)
  .handler(async ({ data }) => {
    const user = await requireUser();
    await publishKeyPackages(
      getDb(),
      user.id,
      data.deviceId,
      data.keyPackages.map((keyPackage) => Buffer.from(keyPackage, "base64")),
    );
    return { ok: true as const };
  });

export const getMyDevicesFn = createServerFn({ method: "GET" }).handler(async () => {
  const user = await requireUser();
  return listDevicesForUser(getDb(), user.id);
});

/** Hands out (and single-use-consumes) one of the target user's available KeyPackages. */
export const claimKeyPackageFn = createServerFn({ method: "POST" })
  .validator(z.object({ userId: z.string().uuid() }))
  .handler(async ({ data }) => {
    await requireUser();
    const claimed = await claimKeyPackageForUser(getDb(), data.userId);
    if (!claimed) throw new DmNoKeyPackageError();
    return { deviceId: claimed.deviceId, keyPackage: claimed.keyPackage.toString("base64") };
  });

export const startDirectConversationFn = createServerFn({ method: "POST" })
  .validator(
    startDirectConversationSchema.extend({
      requesterDeviceId: z.string().uuid(),
      epoch: z.number().int().min(0),
      welcomeBytes: z.string().base64(),
    }),
  )
  .handler(async ({ data }) => {
    const user = await requireUser();
    const conversation = await createDirectConversation(getDb(), {
      conversationId: data.conversationId,
      requesterId: user.id,
      requesterDeviceId: data.requesterDeviceId,
      otherUserId: data.otherUserId,
      epoch: data.epoch,
      welcomeBytes: Buffer.from(data.welcomeBytes, "base64"),
    });
    return { conversationId: conversation.id };
  });

export const sendMessageFn = createServerFn({ method: "POST" })
  .validator(sendMessageSchema)
  .handler(async ({ data }) => {
    const user = await requireUser();
    const row = await sendMessage(getDb(), {
      conversationId: data.conversationId,
      senderUserId: user.id,
      senderDeviceId: data.senderDeviceId,
      epoch: data.epoch,
      ciphertext: Buffer.from(data.ciphertext, "base64"),
    });
    return { id: row.id, createdAt: row.createdAt };
  });

export const getMyConversationsFn = createServerFn({ method: "GET" }).handler(async () => {
  const user = await requireUser();
  return listConversationSummariesForUser(getDb(), user.id);
});

export const getConversationSummaryFn = createServerFn({ method: "GET" })
  .validator(z.object({ conversationId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const user = await requireUser();
    return getConversationSummary(getDb(), data.conversationId, user.id);
  });

export const getMessagesFn = createServerFn({ method: "GET" })
  .validator(listMessagesSchema)
  .handler(async ({ data }) => {
    const user = await requireUser();
    const rows = await listMessages(getDb(), {
      conversationId: data.conversationId,
      userId: user.id,
      cursor: data.cursor,
      limit: data.limit,
    });
    return rows.map((row) => ({
      id: row.id,
      senderDeviceId: row.senderDeviceId,
      senderUserId: row.senderUserId,
      senderDisplayName: row.senderDisplayName,
      epoch: row.epoch,
      ciphertext: row.ciphertext.toString("base64"),
      createdAt: row.createdAt,
    }));
  });

export const recordDeviceLinkFn = createServerFn({ method: "POST" })
  .validator(addDeviceToConversationsSchema)
  .handler(async ({ data }) => {
    const user = await requireUser();
    await recordDeviceLinkOperations(
      getDb(),
      user.id,
      data.senderDeviceId,
      data.operations.map((op) => ({
        conversationId: op.conversationId,
        epoch: op.epoch,
        welcomeBytes: Buffer.from(op.welcomeBytes, "base64"),
        commitBytes: Buffer.from(op.commitBytes, "base64"),
      })),
    );
    return { ok: true as const };
  });

function backupR2Key(userId: string): string {
  return `dm-backups/${userId}`;
}

/** FR-DM-22: uploads the encrypted blob to R2, then points dm_backups at it. */
export const createBackupFn = createServerFn({ method: "POST" })
  .validator(createBackupSchema)
  .handler(async ({ data }) => {
    const user = await requireUser();
    const r2Key = backupR2Key(user.id);
    await env.MEDIA_BUCKET.put(r2Key, Buffer.from(data.r2Blob, "base64"));
    await upsertBackup(getDb(), {
      userId: user.id,
      r2Key,
      wrappedBackupKey: Buffer.from(data.dbWrappedBackupKey, "base64"),
    });
    return { ok: true as const };
  });

export const getBackupFn = createServerFn({ method: "GET" }).handler(async () => {
  const user = await requireUser();
  const row = await getBackup(getDb(), user.id);
  if (!row) return null;
  const object = await env.MEDIA_BUCKET.get(row.r2Key);
  if (!object) return null;
  const r2Blob = Buffer.from(await object.arrayBuffer());
  return {
    dbWrappedBackupKey: row.wrappedBackupKey.toString("base64"),
    r2Blob: r2Blob.toString("base64"),
  };
});

export const searchMembersFn = createServerFn({ method: "GET" })
  .validator(searchMembersSchema)
  .handler(async ({ data }) => {
    const user = await requireUser();
    return searchMembers(getDb(), data.query, user.id);
  });

export const startGroupConversationFn = createServerFn({ method: "POST" })
  .validator(startGroupConversationSchema)
  .handler(async ({ data }) => {
    const user = await requireUser();
    const conversation = await createGroupConversation(getDb(), {
      conversationId: data.conversationId,
      creatorId: user.id,
      creatorDeviceId: data.creatorDeviceId,
      name: data.name,
      memberUserIds: data.members.map((member) => member.userId),
      epoch: data.epoch,
      welcomeBytes: Buffer.from(data.welcomeBytes, "base64"),
    });
    return { conversationId: conversation.id };
  });

export const addGroupMemberFn = createServerFn({ method: "POST" })
  .validator(addGroupMemberSchema)
  .handler(async ({ data }) => {
    const user = await requireUser();
    await addGroupMember(getDb(), {
      conversationId: data.conversationId,
      actingUserId: user.id,
      actingDeviceId: data.actingDeviceId,
      newUserId: data.newUserId,
      epoch: data.epoch,
      welcomeBytes: Buffer.from(data.welcomeBytes, "base64"),
      commitBytes: Buffer.from(data.commitBytes, "base64"),
    });
    return { ok: true as const };
  });

export const removeGroupMemberFn = createServerFn({ method: "POST" })
  .validator(removeGroupMemberSchema)
  .handler(async ({ data }) => {
    const user = await requireUser();
    await removeGroupMember(getDb(), {
      conversationId: data.conversationId,
      actingUserId: user.id,
      actingDeviceId: data.actingDeviceId,
      targetUserId: data.targetUserId,
      epoch: data.epoch,
      commitBytes: Buffer.from(data.commitBytes, "base64"),
    });
    return { ok: true as const };
  });

export const requestToLeaveGroupFn = createServerFn({ method: "POST" })
  .validator(z.object({ conversationId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const user = await requireUser();
    await requestToLeaveGroup(getDb(), data.conversationId, user.id);
    return { ok: true as const };
  });

export const getPendingDeparturesFn = createServerFn({ method: "GET" })
  .validator(z.object({ conversationId: z.string().uuid() }))
  .handler(async ({ data }) => {
    await requireUser();
    return listPendingDepartures(getDb(), data.conversationId);
  });

export const getGroupMembersFn = createServerFn({ method: "GET" })
  .validator(z.object({ conversationId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const user = await requireUser();
    return listGroupMembers(getDb(), data.conversationId, user.id);
  });
