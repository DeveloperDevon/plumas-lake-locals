/**
 * Orchestrates @plumas/crypto's worker-backed MLS client with the server's dm.ts functions.
 * Every export here is client-only - it touches `getDmClient()` (which starts a Web Worker),
 * so it must only ever be called from an effect or event handler, never from a route `loader`
 * or top-level render (both can run during SSR, where there is no Worker/IndexedDB).
 */
import { getDmClient } from "@plumas/crypto";

import {
  claimKeyPackageFn,
  createBackupFn,
  getBackupFn,
  publishKeyPackagesFn,
  recordDeviceLinkFn,
  registerDeviceFn,
  sendMessageFn,
  startDirectConversationFn,
} from "../server/functions/dm";

const KEY_PACKAGE_POOL_SIZE = 5;

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function requireDeviceId(): Promise<string> {
  const deviceId = await getDmClient().getConfirmedDeviceId();
  if (!deviceId) throw new Error("Messaging isn't set up on this device yet.");
  return deviceId;
}

export interface MessagingSetupResult {
  recoveryKey: string;
}

/**
 * Idempotent: if this device already has a confirmed deviceId, does nothing and returns null.
 * Otherwise generates a device identity, registers it, publishes a pool of KeyPackages, and
 * takes a first encrypted backup - returning the recovery key so the UI can show it exactly
 * once (it is never stored anywhere, client or server).
 */
export async function ensureMessagingSetup(userId: string): Promise<MessagingSetupResult | null> {
  const client = getDmClient();
  const existingDeviceId = await client.getConfirmedDeviceId();
  if (existingDeviceId) return null;

  const signaturePublicKey = await client.getDeviceSigningPublicKey();
  const { deviceId } = await registerDeviceFn({
    data: { signaturePublicKey: toBase64(signaturePublicKey) },
  });
  await client.confirmDeviceId(deviceId);

  const generated = await client.generateKeyPackages(userId, KEY_PACKAGE_POOL_SIZE);
  await publishKeyPackagesFn({
    data: {
      deviceId,
      keyPackages: generated.map((entry) => toBase64(entry.publicPackageBytes)),
    },
  });

  const recoveryKey = await client.generateRecoveryKey();
  const backup = await client.createFullBackup(recoveryKey);
  await createBackupFn({
    data: {
      dbWrappedBackupKey: toBase64(backup.dbWrappedBackupKey),
      r2Blob: toBase64(backup.r2Blob),
    },
  });

  return { recoveryKey };
}

/** FR-DM-22: re-takes a backup (e.g. after linking a device) under a freshly shown recovery key. */
export async function refreshBackup(): Promise<string> {
  const client = getDmClient();
  const recoveryKey = await client.generateRecoveryKey();
  const backup = await client.createFullBackup(recoveryKey);
  await createBackupFn({
    data: {
      dbWrappedBackupKey: toBase64(backup.dbWrappedBackupKey),
      r2Blob: toBase64(backup.r2Blob),
    },
  });
  return recoveryKey;
}

/** FR-DM-22: restores a brand-new device from a previously shown recovery key. */
export async function restoreFromRecoveryKey(recoveryKey: string): Promise<void> {
  const client = getDmClient();
  const backup = await getBackupFn();
  if (!backup) throw new Error("No backup found for this account.");
  await client.restoreFullBackup(recoveryKey, {
    dbWrappedBackupKey: fromBase64(backup.dbWrappedBackupKey),
    r2Blob: fromBase64(backup.r2Blob),
  });
}

/** FR-DM-01: starts (or finds the existing) 1:1 conversation with another member. */
export async function startConversationWithUser(
  myUserId: string,
  otherUserId: string,
): Promise<string> {
  const client = getDmClient();
  const requesterDeviceId = await requireDeviceId();
  const claimed = await claimKeyPackageFn({ data: { userId: otherUserId } });

  const conversationId = crypto.randomUUID();
  const created = await client.createConversation(
    myUserId,
    conversationId,
    fromBase64(claimed.keyPackage),
  );

  const response = await startDirectConversationFn({
    data: {
      conversationId,
      otherUserId,
      requesterDeviceId,
      epoch: created.epoch,
      welcomeBytes: toBase64(created.welcomeBytes),
    },
  });
  return response.conversationId;
}

/** FR-DM-09: encrypts, sends, and caches the plaintext locally so this device can redisplay it. */
export async function sendDmMessage(conversationId: string, plaintext: string): Promise<void> {
  const client = getDmClient();
  const senderDeviceId = await requireDeviceId();
  const encrypted = await client.encryptMessage(conversationId, plaintext);
  const sent = await sendMessageFn({
    data: {
      conversationId,
      senderDeviceId,
      epoch: encrypted.epoch,
      ciphertext: toBase64(encrypted.wireBytes),
    },
  });
  await client.cacheSentPlaintext(sent.id, plaintext);
}

export interface DecryptedMessage {
  id: string;
  mine: boolean;
  plaintext: string | null;
  createdAt: Date;
}

/**
 * Decrypts a page of message rows (already fetched via getMessagesFn) into display-ready text.
 * Rows this device authored are read back from the local sent-plaintext cache, never
 * re-decrypted (MLS doesn't support a sender decrypting its own past ciphertext - see
 * storage.ts's StoredSentPlaintext doc comment). `plaintext: null` means a commit/welcome row
 * (device-join bookkeeping) with nothing to display.
 */
export async function decryptMessages(
  conversationId: string,
  rows: { id: string; senderDeviceId: string; ciphertext: string; createdAt: Date }[],
): Promise<DecryptedMessage[]> {
  const client = getDmClient();
  const myDeviceId = await client.getConfirmedDeviceId();

  const results: DecryptedMessage[] = [];
  for (const row of rows) {
    const mine = row.senderDeviceId === myDeviceId;
    if (mine) {
      const cached = await client.getCachedSentPlaintext(row.id);
      results.push({ id: row.id, mine, plaintext: cached ?? null, createdAt: row.createdAt });
      continue;
    }
    const result = await client.processIncoming(row.id, conversationId, fromBase64(row.ciphertext));
    results.push({
      id: row.id,
      mine,
      plaintext: result.kind === "applicationMessage" ? result.plaintext : null,
      createdAt: row.createdAt,
    });
  }
  return results;
}

interface DeviceLinkQrPayload {
  deviceId: string;
  keyPackage: string;
}

/**
 * Run on the NEW device being linked: completes its own messaging setup (so it's independently
 * useful once linked - its own backup, its own published KeyPackage pool for future
 * conversations), then generates one more KeyPackage that's never published to the server,
 * transmitted only through the QR code for the already-trusted device to consume directly.
 */
export async function prepareDeviceLinkQrPayload(userId: string): Promise<string> {
  const client = getDmClient();
  await ensureMessagingSetup(userId);
  const deviceId = await requireDeviceId();
  const [generated] = await client.generateKeyPackages(userId, 1);
  if (!generated) throw new Error("Failed to generate a KeyPackage for linking.");
  const payload: DeviceLinkQrPayload = {
    deviceId,
    keyPackage: toBase64(generated.publicPackageBytes),
  };
  return JSON.stringify(payload);
}

/**
 * Run on an EXISTING (already-trusted) device after scanning the new device's QR: adds the new
 * device to every conversation this device has local state for.
 */
export async function linkNewDevice(qrPayload: string): Promise<void> {
  const parsed = JSON.parse(qrPayload) as DeviceLinkQrPayload;
  const client = getDmClient();
  const senderDeviceId = await requireDeviceId();
  const newDeviceKeyPackage = fromBase64(parsed.keyPackage);
  const conversationIds = await client.listMyConversationIds();

  const operations: {
    conversationId: string;
    epoch: number;
    welcomeBytes: string;
    commitBytes: string;
  }[] = [];
  for (const conversationId of conversationIds) {
    const result = await client.addDeviceToConversation(conversationId, newDeviceKeyPackage);
    operations.push({
      conversationId,
      epoch: result.epoch,
      welcomeBytes: toBase64(result.welcomeBytes),
      commitBytes: toBase64(result.commitBytes),
    });
  }
  if (operations.length === 0) return;

  await recordDeviceLinkFn({
    data: { senderDeviceId, newDeviceId: parsed.deviceId, operations },
  });
}

export { fromBase64, toBase64 };
