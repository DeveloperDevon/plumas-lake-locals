/**
 * IndexedDB persistence for the MLS client - runs inside the Web Worker (worker.ts), never on
 * the main thread. Mirrors the PRD's "Key storage" design ("private keys are generated on the
 * device and kept in IndexedDB... they never leave the device unencrypted") with one honest
 * caveat: ts-mls (like every pure-JS or WASM MLS implementation - this isn't ts-mls-specific)
 * implements HPKE/signing itself rather than delegating to Web Crypto, so it needs raw key
 * bytes in JS memory to operate. True non-extractable `CryptoKey` objects aren't possible for
 * the MLS keys themselves; IndexedDB's per-origin sandboxed storage is the real security
 * boundary here, same as it would be for OpenMLS/WASM. `CryptoKey` is used for the one place
 * this client *does* call Web Crypto directly: wrapping the backup key (see `backup.ts`).
 */
import type { DBSchema, IDBPDatabase } from "idb";
import { openDB } from "idb";
import type { ClientState, PrivateKeyPackage } from "ts-mls";

const DEFAULT_DB_NAME = "plumas-dm";
const DB_VERSION = 3;
const DEVICE_RECORD_KEY = "device";

let dbName = DEFAULT_DB_NAME;

// One persistent MLS signing keypair per device (schema: devices.signaturePublicKey), reused
// across every KeyPackage this device ever publishes (generateKeyPackageWithKey, not
// generateKeyPackage - see engine.ts) - not a fresh key per KeyPackage. `deviceId` is the
// server-assigned `devices.id` row, cached locally once known; it's absent right after the
// signing key is first generated, before the server has had a chance to register it (see
// engine.ts's `getOrCreateDeviceSigningKey`/`confirmDeviceId`).
export interface StoredDevice {
  deviceId: string | undefined;
  signaturePublicKey: Uint8Array;
  signaturePrivateKey: Uint8Array;
}

export interface StoredKeyPackage {
  localId: string;
  publicPackageBytes: Uint8Array;
  privatePackage: PrivateKeyPackage;
  consumed: boolean;
}

export interface StoredConversationState {
  conversationId: string;
  encodedGroupState: Uint8Array;
}

// MLS application messages aren't self-decryptable by the sender after the fact (the sending
// ratchet secret used to encrypt isn't retained for decryption - that's forward secrecy working
// as intended), so a device has to remember what it sent, by the server-assigned message id,
// to redisplay its own messages after a reload.
export interface StoredSentPlaintext {
  messageId: string;
  plaintext: string;
}

// MLS state only moves forward (ratchet generations and epochs can't rewind), so calling
// processIncoming twice for the same row - a second effect run, a re-render, a refetch that
// re-walks full history - must not touch MLS state the second time. Keyed by the server
// message id and keyed on nothing else, so it's a simple presence check before doing any real
// work; `result` is JSON-safe (ProcessIncomingResult has no binary fields) so it's stored as-is.
export interface StoredProcessedMessage {
  messageId: string;
  result: unknown;
}

interface Schema extends DBSchema {
  device: { key: string; value: StoredDevice };
  keyPackages: { key: string; value: StoredKeyPackage };
  conversations: { key: string; value: StoredConversationState };
  sentPlaintext: { key: string; value: StoredSentPlaintext };
  processedMessages: { key: string; value: StoredProcessedMessage };
}

let dbPromise: Promise<IDBPDatabase<Schema>> | null = null;

/**
 * Test-only: a real deployment has exactly one IndexedDB per browser profile (one device), so
 * there's never a reason to call this outside tests - it exists so engine.test.ts can simulate
 * two separate devices' separate storage within one Node process. Closes the previously open
 * connection first - otherwise a later `indexedDB.deleteDatabase` on the same name blocks
 * forever waiting for a connection nothing ever closed.
 */
export async function __setDatabaseNameForTests(name: string): Promise<void> {
  if (dbPromise) {
    const db = await dbPromise;
    db.close();
  }
  dbName = name;
  dbPromise = null;
}

function getDb(): Promise<IDBPDatabase<Schema>> {
  dbPromise ??= openDB<Schema>(dbName, DB_VERSION, {
    upgrade(db) {
      db.createObjectStore("device");
      db.createObjectStore("keyPackages", { keyPath: "localId" });
      db.createObjectStore("conversations", { keyPath: "conversationId" });
      db.createObjectStore("sentPlaintext", { keyPath: "messageId" });
      db.createObjectStore("processedMessages", { keyPath: "messageId" });
    },
  });
  return dbPromise;
}

export async function loadDevice(): Promise<StoredDevice | undefined> {
  const db = await getDb();
  return db.get("device", DEVICE_RECORD_KEY);
}

export async function saveDevice(device: StoredDevice): Promise<void> {
  const db = await getDb();
  await db.put("device", device, DEVICE_RECORD_KEY);
}

export async function saveKeyPackage(entry: StoredKeyPackage): Promise<void> {
  const db = await getDb();
  await db.put("keyPackages", entry);
}

export async function listUnconsumedKeyPackages(): Promise<StoredKeyPackage[]> {
  const db = await getDb();
  const all = await db.getAll("keyPackages");
  return all.filter((entry) => !entry.consumed);
}

export async function markKeyPackageConsumed(localId: string): Promise<void> {
  const db = await getDb();
  const entry = await db.get("keyPackages", localId);
  if (!entry) return;
  await db.put("keyPackages", { ...entry, consumed: true });
}

export async function loadConversationState(
  conversationId: string,
): Promise<Uint8Array | undefined> {
  const db = await getDb();
  const record = await db.get("conversations", conversationId);
  return record?.encodedGroupState;
}

export async function saveConversationState(
  conversationId: string,
  state: ClientState,
  encode: (state: ClientState) => Uint8Array,
): Promise<void> {
  const db = await getDb();
  await db.put("conversations", { conversationId, encodedGroupState: encode(state) });
}

export async function listAllConversationStates(): Promise<StoredConversationState[]> {
  const db = await getDb();
  return db.getAll("conversations");
}

export async function deleteConversationState(conversationId: string): Promise<void> {
  const db = await getDb();
  await db.delete("conversations", conversationId);
}

export async function restoreConversationState(
  conversationId: string,
  encodedGroupState: Uint8Array,
): Promise<void> {
  const db = await getDb();
  await db.put("conversations", { conversationId, encodedGroupState });
}

export async function saveSentPlaintext(messageId: string, plaintext: string): Promise<void> {
  const db = await getDb();
  await db.put("sentPlaintext", { messageId, plaintext });
}

export async function getSentPlaintext(messageId: string): Promise<string | undefined> {
  const db = await getDb();
  const record = await db.get("sentPlaintext", messageId);
  return record?.plaintext;
}

export async function listAllSentPlaintext(): Promise<StoredSentPlaintext[]> {
  const db = await getDb();
  return db.getAll("sentPlaintext");
}

export async function getProcessedMessage(messageId: string): Promise<unknown> {
  const db = await getDb();
  const record = await db.get("processedMessages", messageId);
  return record?.result;
}

export async function saveProcessedMessage(messageId: string, result: unknown): Promise<void> {
  const db = await getDb();
  await db.put("processedMessages", { messageId, result });
}

export async function listAllProcessedMessages(): Promise<StoredProcessedMessage[]> {
  const db = await getDb();
  return db.getAll("processedMessages");
}
