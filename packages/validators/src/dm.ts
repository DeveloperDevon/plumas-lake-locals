import { z } from "zod";

import { cursorPaginationSchema, uuidSchema } from "./common";

// Key material and MLS wire messages are all transported as base64 in server-function JSON
// payloads - every one of them is small (a KeyPackage, a 2000-char message's ciphertext),
// so there's no reason for a separate binary route the way media/upload.ts needs for images.
export const base64BytesSchema = z.string().base64();

export const registerDeviceSchema = z.object({
  label: z.string().trim().min(1).max(100).optional(),
  signaturePublicKey: base64BytesSchema,
});
export type RegisterDeviceInput = z.infer<typeof registerDeviceSchema>;

export const publishKeyPackagesSchema = z.object({
  deviceId: uuidSchema,
  keyPackages: z.array(base64BytesSchema).min(1).max(20),
});
export type PublishKeyPackagesInput = z.infer<typeof publishKeyPackagesSchema>;

export const startDirectConversationSchema = z.object({
  // Client-generated (like media.ts's upload id) - it's also the MLS group id and has to be
  // known before the conversation row can exist, since the client runs createGroup first.
  conversationId: uuidSchema,
  otherUserId: uuidSchema,
});
export type StartDirectConversationInput = z.infer<typeof startDirectConversationSchema>;

export const sendMessageSchema = z.object({
  conversationId: uuidSchema,
  senderDeviceId: uuidSchema,
  epoch: z.number().int().min(0),
  ciphertext: base64BytesSchema,
});
export type SendMessageInput = z.infer<typeof sendMessageSchema>;

export const listMessagesSchema = z
  .object({
    conversationId: uuidSchema,
  })
  .merge(cursorPaginationSchema);
export type ListMessagesInput = z.infer<typeof listMessagesSchema>;

export const addDeviceToConversationsSchema = z.object({
  senderDeviceId: uuidSchema,
  newDeviceId: uuidSchema,
  // One welcome+commit pair per conversation the new device is being added to.
  operations: z
    .array(
      z.object({
        conversationId: uuidSchema,
        epoch: z.number().int().min(0),
        welcomeBytes: base64BytesSchema,
        commitBytes: base64BytesSchema,
      }),
    )
    .min(1),
});
export type AddDeviceToConversationsInput = z.infer<typeof addDeviceToConversationsSchema>;

export const createBackupSchema = z.object({
  dbWrappedBackupKey: base64BytesSchema,
  r2Blob: base64BytesSchema,
});
export type CreateBackupInput = z.infer<typeof createBackupSchema>;
