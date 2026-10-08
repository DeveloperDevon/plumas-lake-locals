/**
 * Full-device encrypted backup/restore (FR-DM-22), wiring the spike's proven wrap/unwrap
 * pattern (../spike/backup-restore.ts) to the real `dm_backups` schema
 * (packages/db/src/schema/dm-backups.ts: one `wrappedBackupKey` bytea column in Postgres, one
 * R2 object referenced by `r2Key`) and to a real recovery key shown once at setup (WebAuthn
 * PRF deferred - see the task's plan).
 *
 * Layout, since the schema has exactly one bytea column for the wrapped key and one R2 object
 * for everything else:
 *   - `dbWrappedBackupKey` (-> dm_backups.wrappedBackupKey): salt(16) || wrapIv(12) || wrapped
 *     AES key bytes.
 *   - `r2Blob` (-> the R2 object at dm_backups.r2Key): dataIv(12) || AES-GCM ciphertext.
 *
 * Backs up everything a device needs to keep participating: every unconsumed KeyPackage
 * (pending Welcomes that haven't arrived yet) and every conversation's current ClientState.
 * `PrivateKeyPackage` has no encoder in ts-mls (only the public `KeyPackage` does) - serialized
 * here with a generic Uint8Array<->base64 deep-walk instead of assuming a wire format, since
 * the blob only ever needs to round-trip through this same code.
 */
import type { PrivateKeyPackage } from "ts-mls";

import {
  listAllConversationStates,
  listAllProcessedMessages,
  listAllSentPlaintext,
  listUnconsumedKeyPackages,
  loadDevice,
  restoreConversationState,
  saveDevice,
  saveKeyPackage,
  saveProcessedMessage,
  saveSentPlaintext,
  type StoredDevice,
  type StoredKeyPackage,
} from "./storage.js";

const PBKDF2_ITERATIONS = 100_000;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;

export function generateRecoveryKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return (hex.match(/.{1,4}/g) ?? [hex]).join("-");
}

function normalizeRecoveryKey(recoveryKey: string): string {
  return recoveryKey.replace(/-/g, "").toLowerCase();
}

async function deriveWrappingKey(recoveryKey: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(normalizeRecoveryKey(recoveryKey)) as BufferSource,
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["wrapKey", "unwrapKey"],
  );
}

type JsonSafe = string | number | boolean | null | JsonSafe[] | { [key: string]: JsonSafe };

function toJsonSafe(value: unknown): JsonSafe {
  if (value instanceof Uint8Array) return { __bytes__: bytesToBase64(value) };
  if (Array.isArray(value)) return value.map(toJsonSafe);
  if (value && typeof value === "object") {
    const out: Record<string, JsonSafe> = {};
    for (const [key, v] of Object.entries(value)) out[key] = toJsonSafe(v);
    return out;
  }
  return value as JsonSafe;
}

function fromJsonSafe(value: JsonSafe): unknown {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, JsonSafe>;
    if (typeof record.__bytes__ === "string" && Object.keys(record).length === 1) {
      return base64ToBytes(record.__bytes__);
    }
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(record)) out[key] = fromJsonSafe(v);
    return out;
  }
  if (Array.isArray(value)) return value.map(fromJsonSafe);
  return value;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

interface BackupPayload {
  device?:
    | { deviceId: string | undefined; signaturePublicKey: string; signaturePrivateKey: string }
    | undefined;
  keyPackages: { localId: string; publicPackageBytes: string; privatePackage: JsonSafe }[];
  conversations: { conversationId: string; encodedGroupState: string }[];
  // Own sent messages aren't self-decryptable after the fact (see storage.ts's
  // StoredSentPlaintext doc comment), so without this a restored device would have working
  // conversations but blank spots where its own prior messages used to read.
  sentPlaintext: { messageId: string; plaintext: string }[];
  // Without this, a restored device re-walking full conversation history would try to decrypt
  // application messages it already consumed before the backup was taken - MLS ratchets only
  // move forward, so re-decrypting an old generation fails outright ("desired generation in the
  // past"). Carrying the processed-message cache across restore makes that history replay a
  // cache hit instead of a doomed second decrypt attempt.
  processedMessages: { messageId: string; result: unknown }[];
}

export interface EncryptedBackup {
  dbWrappedBackupKey: Uint8Array;
  r2Blob: Uint8Array;
}

export async function createFullBackup(recoveryKey: string): Promise<EncryptedBackup> {
  const device = await loadDevice();
  const keyPackages = await listUnconsumedKeyPackages();
  const conversations = await listAllConversationStates();
  const sentPlaintext = await listAllSentPlaintext();
  const processedMessages = await listAllProcessedMessages();

  const payload: BackupPayload = {
    device: device && {
      deviceId: device.deviceId,
      signaturePublicKey: bytesToBase64(device.signaturePublicKey),
      signaturePrivateKey: bytesToBase64(device.signaturePrivateKey),
    },
    keyPackages: keyPackages.map((entry) => ({
      localId: entry.localId,
      publicPackageBytes: bytesToBase64(entry.publicPackageBytes),
      privatePackage: toJsonSafe(entry.privatePackage),
    })),
    conversations: conversations.map((entry) => ({
      conversationId: entry.conversationId,
      encodedGroupState: bytesToBase64(entry.encodedGroupState),
    })),
    sentPlaintext,
    processedMessages,
  };
  const serialized = new TextEncoder().encode(JSON.stringify(payload));

  const backupKey = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, [
    "encrypt",
    "decrypt",
  ]);
  const dataIv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: dataIv as BufferSource },
      backupKey,
      serialized,
    ),
  );

  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const wrappingKey = await deriveWrappingKey(recoveryKey, salt);
  const wrapIv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const wrappedBackupKeyBytes = new Uint8Array(
    await crypto.subtle.wrapKey("raw", backupKey, wrappingKey, {
      name: "AES-GCM",
      iv: wrapIv as BufferSource,
      additionalData: salt as BufferSource,
    }),
  );

  return {
    dbWrappedBackupKey: concat(salt, wrapIv, wrappedBackupKeyBytes),
    r2Blob: concat(dataIv, ciphertext),
  };
}

/** Decrypts the backup and writes everything it contains back into local storage. */
export async function restoreFullBackup(
  recoveryKey: string,
  backup: EncryptedBackup,
): Promise<void> {
  const salt = backup.dbWrappedBackupKey.slice(0, SALT_LENGTH);
  const wrapIv = backup.dbWrappedBackupKey.slice(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const wrappedBackupKeyBytes = backup.dbWrappedBackupKey.slice(SALT_LENGTH + IV_LENGTH);

  const wrappingKey = await deriveWrappingKey(recoveryKey, salt);
  const backupKey = await crypto.subtle.unwrapKey(
    "raw",
    wrappedBackupKeyBytes,
    wrappingKey,
    { name: "AES-GCM", iv: wrapIv as BufferSource, additionalData: salt as BufferSource },
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );

  const dataIv = backup.r2Blob.slice(0, IV_LENGTH);
  const ciphertext = backup.r2Blob.slice(IV_LENGTH);
  const decrypted = new Uint8Array(
    await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: dataIv as BufferSource },
      backupKey,
      ciphertext,
    ),
  );

  const payload = JSON.parse(new TextDecoder().decode(decrypted)) as BackupPayload;

  if (payload.device) {
    const restoredDevice: StoredDevice = {
      deviceId: payload.device.deviceId,
      signaturePublicKey: base64ToBytes(payload.device.signaturePublicKey),
      signaturePrivateKey: base64ToBytes(payload.device.signaturePrivateKey),
    };
    await saveDevice(restoredDevice);
  }

  for (const entry of payload.keyPackages) {
    const stored: StoredKeyPackage = {
      localId: entry.localId,
      publicPackageBytes: base64ToBytes(entry.publicPackageBytes),
      privatePackage: fromJsonSafe(entry.privatePackage) as PrivateKeyPackage,
      consumed: false,
    };
    await saveKeyPackage(stored);
  }

  for (const entry of payload.conversations) {
    await restoreConversationState(entry.conversationId, base64ToBytes(entry.encodedGroupState));
  }

  for (const entry of payload.sentPlaintext) {
    await saveSentPlaintext(entry.messageId, entry.plaintext);
  }

  for (const entry of payload.processedMessages) {
    await saveProcessedMessage(entry.messageId, entry.result);
  }
}
