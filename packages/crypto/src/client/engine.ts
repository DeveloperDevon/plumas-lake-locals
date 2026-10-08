/**
 * Core MLS client logic for direct messages - every function here is pure enough to unit test
 * directly in Node (see engine.test.ts), separate from `worker.ts`'s `self.onmessage` glue
 * (which only runs in a real Worker and is exercised through the browser harness instead).
 * Reuses the exact ts-mls API shapes proven in `../spike/` (task #21).
 *
 * Routing rule for incoming rows (the "messages" table holds every commit/welcome/application
 * message as opaque bytes - there's no separate commits/welcomes table):
 *   - a Welcome and we have no local state for this conversation yet -> we're the device being
 *     added; join from it.
 *   - a Welcome and we already have local state -> it was for a different device joining the
 *     same conversation; not ours, skip it.
 *   - a commit or application message -> process against our existing state (covers both
 *     commits, whose `kind` comes back "newState", and application messages, whose `kind`
 *     comes back "applicationMessage").
 * Callers also skip any row whose `senderDeviceId` is this device's own id before calling
 * `processIncoming` at all, since a device that authored an operation already has the
 * resulting state in hand from the call that produced it.
 *
 * `processIncoming` takes the row's server-assigned message id and is idempotent on it: MLS
 * state only ever moves forward (ratchet generations and epochs can't rewind), so a second call
 * for a row already processed - a duplicate effect run, a re-render, a refetch that re-walks
 * full history - replays the cached result instead of touching MLS state again. Without this, a
 * second concurrent/later call decrypting the same application message a second time fails
 * outright ("desired generation in the past"), caught by a real two-account browser run.
 *
 * A joining device needs the group's ratchet tree as of the epoch the Welcome targets - MLS
 * doesn't guarantee it travels inside the Welcome itself (that's only true for an external-join
 * GroupInfo, not this app's "already-trusted device commits an Add" flow) - so every row this
 * module stores is its own small envelope, not a bare `encodeMlsMessage` output: one kind byte,
 * then either the plain MLS wire message (commits, application messages) or a
 * length-prefixed ratchet tree followed by the Welcome's wire message (see `encodeRow`).
 */
import type { CiphersuiteImpl, ClientState, Credential, KeyPackage, RatchetTree } from "ts-mls";
import {
  createApplicationMessage,
  createCommit,
  createGroup,
  decodeGroupState,
  decodeMlsMessage,
  defaultCapabilities,
  defaultLifetime,
  emptyPskIndex,
  encodeGroupState,
  encodeMlsMessage,
  getCiphersuiteFromName,
  getCiphersuiteImpl,
  joinGroup,
  makePskIndex,
  processPrivateMessage,
} from "ts-mls";
import { defaultClientConfig } from "ts-mls/clientConfig.js";
import {
  decodeKeyPackage,
  encodeKeyPackage,
  generateKeyPackageWithKey,
} from "ts-mls/keyPackage.js";
import { decodeRatchetTree, encodeRatchetTree } from "ts-mls/ratchetTree.js";

import {
  deleteConversationState,
  getProcessedMessage,
  getSentPlaintext,
  listAllConversationStates,
  listUnconsumedKeyPackages,
  loadConversationState,
  loadDevice,
  markKeyPackageConsumed,
  saveConversationState,
  saveDevice,
  saveKeyPackage,
  saveProcessedMessage,
  saveSentPlaintext,
  type StoredKeyPackage,
} from "./storage.js";

// MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519 - RFC 9420's MTI ciphersuite, same one task
// #21's spike validated against all four pass criteria.
const CIPHERSUITE_NAME = "MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519";

let implPromise: Promise<CiphersuiteImpl> | null = null;
function getImpl(): Promise<CiphersuiteImpl> {
  implPromise ??= getCiphersuiteImpl(getCiphersuiteFromName(CIPHERSUITE_NAME));
  return implPromise;
}

function newLocalId(): string {
  return crypto.randomUUID();
}

export interface DeviceSigningKey {
  signaturePublicKey: Uint8Array;
  signaturePrivateKey: Uint8Array;
}

/**
 * Every KeyPackage this device ever publishes reuses this one signing keypair (schema:
 * `devices.signaturePublicKey`) - generated once, on first use, and persisted from then on.
 */
export async function getOrCreateDeviceSigningKey(): Promise<DeviceSigningKey> {
  const existing = await loadDevice();
  if (existing) return existing;
  const impl = await getImpl();
  const { publicKey, signKey } = await impl.signature.keygen();
  const device = {
    deviceId: undefined,
    signaturePublicKey: publicKey,
    signaturePrivateKey: signKey,
  };
  await saveDevice(device);
  return device;
}

/**
 * The public half to register with the server (`registerDevice`) - generates the keypair on
 * first call if none exists yet. Never returns the private half across the worker boundary.
 */
export async function getDeviceSigningPublicKey(): Promise<Uint8Array> {
  const key = await getOrCreateDeviceSigningKey();
  return key.signaturePublicKey;
}

/** Call once the server has assigned a `devices.id` row for this device's signing key. */
export async function confirmDeviceId(deviceId: string): Promise<void> {
  const device = await getOrCreateDeviceSigningKey();
  await saveDevice({ ...device, deviceId });
}

export async function getConfirmedDeviceId(): Promise<string | undefined> {
  const device = await loadDevice();
  return device?.deviceId;
}

/** Every conversation this device has local MLS state for (used when linking a new device). */
export async function listMyConversationIds(): Promise<string[]> {
  const states = await listAllConversationStates();
  return states.map((state) => state.conversationId);
}

export interface GeneratedKeyPackage {
  localId: string;
  publicPackageBytes: Uint8Array;
}

/**
 * Generates `count` fresh, single-use KeyPackages (one-time init/encryption keys) under this
 * device's persistent signing key, and stores their private halves locally.
 */
export async function generateKeyPackages(
  userId: string,
  count: number,
): Promise<GeneratedKeyPackage[]> {
  const impl = await getImpl();
  const signingKey = await getOrCreateDeviceSigningKey();
  const credential: Credential = {
    credentialType: "basic",
    identity: new TextEncoder().encode(userId),
  };
  const generated: GeneratedKeyPackage[] = [];
  for (let i = 0; i < count; i++) {
    const { publicPackage, privatePackage } = await generateKeyPackageWithKey(
      credential,
      defaultCapabilities(),
      defaultLifetime,
      [],
      { signKey: signingKey.signaturePrivateKey, publicKey: signingKey.signaturePublicKey },
      impl,
    );
    const localId = newLocalId();
    const publicPackageBytes = encodeKeyPackage(publicPackage);
    const entry: StoredKeyPackage = {
      localId,
      publicPackageBytes,
      privatePackage,
      consumed: false,
    };
    await saveKeyPackage(entry);
    generated.push({ localId, publicPackageBytes });
  }
  return generated;
}

async function persistState(conversationId: string, state: ClientState): Promise<void> {
  await saveConversationState(conversationId, state, encodeGroupState);
}

async function loadState(conversationId: string): Promise<ClientState | undefined> {
  const encoded = await loadConversationState(conversationId);
  if (!encoded) return undefined;
  const decoded = decodeGroupState(encoded, 0);
  if (!decoded) throw new Error(`Corrupt stored group state for conversation ${conversationId}`);
  return { ...decoded[0], clientConfig: defaultClientConfig };
}

export interface CreateConversationResult {
  welcomeBytes: Uint8Array;
  commitBytes: Uint8Array;
  epoch: number;
}

/**
 * Creates a brand-new group containing only the local member, then immediately commits one Add
 * per entry in `memberKeyPackagesBytes` (a single peer for a 1:1, 2-49 for a group - MLS puts
 * no special case on the count). One commit with N Add proposals produces ONE Welcome that
 * bundles per-recipient encrypted secrets for all N new members (confirmed against the
 * installed ts-mls's welcome.d.ts) - each joining device's `processIncoming` welcome-join loop
 * already tries every locally-unconsumed KeyPackage against a Welcome, so it needs no changes
 * to find its own entry inside a multi-recipient one. Returns the wire-encoded Welcome and
 * Commit, both meant to be written as `messages` rows (senderDeviceId = this device) for the
 * new members' other devices to pick up via `processIncoming`.
 */
export async function createConversation(
  userId: string,
  conversationId: string,
  memberKeyPackagesBytes: Uint8Array[],
): Promise<CreateConversationResult> {
  const impl = await getImpl();
  const signingKey = await getOrCreateDeviceSigningKey();
  const credential: Credential = {
    credentialType: "basic",
    identity: new TextEncoder().encode(userId),
  };
  const { publicPackage, privatePackage } = await generateKeyPackageWithKey(
    credential,
    defaultCapabilities(),
    defaultLifetime,
    [],
    { signKey: signingKey.signaturePrivateKey, publicKey: signingKey.signaturePublicKey },
    impl,
  );

  let state: ClientState = await createGroup(
    new TextEncoder().encode(conversationId),
    publicPackage,
    privatePackage,
    [],
    impl,
  );

  const commitResult = await createCommit(
    { state, cipherSuite: impl },
    {
      extraProposals: memberKeyPackagesBytes.map((bytes) => ({
        proposalType: "add" as const,
        add: { keyPackage: decodePeerKeyPackage(bytes) },
      })),
    },
  );
  state = commitResult.newState;
  if (!commitResult.welcome) throw new Error("Expected a welcome message for the new members");
  if (commitResult.commit.wireformat !== "mls_private_message") {
    throw new Error("Expected the add commit as a private message");
  }

  await persistState(conversationId, state);

  return {
    welcomeBytes: encodeWelcomeBundleRow(
      state.ratchetTree,
      encodeMlsMessage({
        welcome: commitResult.welcome,
        wireformat: "mls_welcome",
        version: "mls10",
      }),
    ),
    commitBytes: encodePlainRow(
      encodeMlsMessage({
        privateMessage: commitResult.commit.privateMessage,
        wireformat: "mls_private_message",
        version: "mls10",
      }),
    ),
    epoch: Number(state.groupContext.epoch),
  };
}

// Peer KeyPackages are published and stored as the bare bytes `encodeKeyPackage` produces (see
// `generateKeyPackages` above), not wrapped in an MlsMessage envelope - decode them directly.
function decodePeerKeyPackage(bytes: Uint8Array): KeyPackage {
  const decoded = decodeKeyPackage(bytes, 0);
  if (!decoded) throw new Error("Could not decode peer KeyPackage");
  return decoded[0];
}

const ROW_KIND_PLAIN = 1;
const ROW_KIND_WELCOME_BUNDLE = 2;

/** A commit or application message - store the MLS wire message as-is, kind byte aside. */
function encodePlainRow(mlsWireBytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(1 + mlsWireBytes.length);
  out[0] = ROW_KIND_PLAIN;
  out.set(mlsWireBytes, 1);
  return out;
}

/** A Welcome plus the ratchet tree a joining device needs alongside it (see module doc). */
function encodeWelcomeBundleRow(
  ratchetTree: RatchetTree,
  welcomeWireBytes: Uint8Array,
): Uint8Array {
  const treeBytes = encodeRatchetTree(ratchetTree);
  const out = new Uint8Array(1 + 4 + treeBytes.length + welcomeWireBytes.length);
  out[0] = ROW_KIND_WELCOME_BUNDLE;
  new DataView(out.buffer).setUint32(1, treeBytes.length, false);
  out.set(treeBytes, 5);
  out.set(welcomeWireBytes, 5 + treeBytes.length);
  return out;
}

type DecodedRow =
  | { kind: "plain"; mlsWireBytes: Uint8Array }
  | { kind: "welcomeBundle"; ratchetTree: RatchetTree; welcomeWireBytes: Uint8Array };

function decodeRow(rowBytes: Uint8Array): DecodedRow {
  const kind = rowBytes[0];
  if (kind === ROW_KIND_PLAIN) {
    return { kind: "plain", mlsWireBytes: rowBytes.slice(1) };
  }
  if (kind === ROW_KIND_WELCOME_BUNDLE) {
    const treeLength = new DataView(rowBytes.buffer, rowBytes.byteOffset + 1, 4).getUint32(
      0,
      false,
    );
    const decodedTree = decodeRatchetTree(rowBytes.slice(5, 5 + treeLength), 0);
    if (!decodedTree) throw new Error("Could not decode stored ratchet tree");
    return {
      kind: "welcomeBundle",
      ratchetTree: decodedTree[0],
      welcomeWireBytes: rowBytes.slice(5 + treeLength),
    };
  }
  throw new Error(`Unknown stored message row kind: ${String(kind)}`);
}

export type ProcessIncomingResult =
  | { kind: "joined" }
  | { kind: "applicationMessage"; plaintext: string }
  | { kind: "stateUpdated" }
  | { kind: "ignored" };

/**
 * Processes one wire-format row from the `messages` table for this conversation. Callers must
 * skip any row whose `senderDeviceId` is this device's own id before calling this - a device
 * that authored an operation already has the resulting state from the call that produced it.
 */
export async function processIncoming(
  messageId: string,
  conversationId: string,
  wireBytes: Uint8Array,
): Promise<ProcessIncomingResult> {
  const cached = await getProcessedMessage(messageId);
  if (cached) return cached as ProcessIncomingResult;
  const result = await processIncomingUncached(conversationId, wireBytes);
  await saveProcessedMessage(messageId, result);
  return result;
}

async function processIncomingUncached(
  conversationId: string,
  wireBytes: Uint8Array,
): Promise<ProcessIncomingResult> {
  const impl = await getImpl();
  const row = decodeRow(wireBytes);
  const existingState = await loadState(conversationId);

  if (row.kind === "welcomeBundle") {
    if (existingState) return { kind: "ignored" };
    const decodedWelcomeMessage = decodeMlsMessage(row.welcomeWireBytes, 0)?.[0];
    if (decodedWelcomeMessage?.wireformat !== "mls_welcome") {
      throw new Error("Expected a welcome message in the stored row");
    }
    const candidates = await listUnconsumedKeyPackages();
    for (const candidate of candidates) {
      try {
        const joined = await joinGroup(
          decodedWelcomeMessage.welcome,
          decodePeerKeyPackage(candidate.publicPackageBytes),
          candidate.privatePackage,
          emptyPskIndex,
          impl,
          row.ratchetTree,
        );
        await persistState(conversationId, joined);
        await markKeyPackageConsumed(candidate.localId);
        return { kind: "joined" };
      } catch {
        // Not the KeyPackage this Welcome targets - try the next one.
      }
    }
    throw new Error(
      `No locally stored KeyPackage could join the group for conversation ${conversationId}`,
    );
  }

  const decoded = decodeMlsMessage(row.mlsWireBytes, 0)?.[0];
  if (decoded?.wireformat !== "mls_private_message") {
    throw new Error("Expected a commit or application message in the stored row");
  }
  if (!existingState) {
    throw new Error(
      `Received a private message for conversation ${conversationId} with no local state`,
    );
  }
  // A commit from the same epoch this device already joined at (e.g. the Add commit a Welcome
  // was generated from) has already been folded into the state joinGroup produced - processing
  // it again would be processing a stale epoch and fail. Not every device needs every commit;
  // only ones strictly newer than what's locally known.
  if (decoded.privateMessage.epoch < existingState.groupContext.epoch) {
    return { kind: "ignored" };
  }
  const result = await processPrivateMessage(
    existingState,
    decoded.privateMessage,
    makePskIndex(existingState, {}),
    impl,
  );
  await persistState(conversationId, result.newState);
  if (result.kind === "applicationMessage") {
    return { kind: "applicationMessage", plaintext: new TextDecoder().decode(result.message) };
  }
  return { kind: "stateUpdated" };
}

export interface EncryptMessageResult {
  wireBytes: Uint8Array;
  epoch: number;
}

/** Encrypts a plaintext message for an existing conversation; returns wire bytes to store. */
export async function encryptMessage(
  conversationId: string,
  plaintext: string,
): Promise<EncryptMessageResult> {
  const impl = await getImpl();
  const state = await loadState(conversationId);
  if (!state) throw new Error(`No local state for conversation ${conversationId}`);
  const result = await createApplicationMessage(state, new TextEncoder().encode(plaintext), impl);
  await persistState(conversationId, result.newState);
  return {
    wireBytes: encodePlainRow(
      encodeMlsMessage({
        privateMessage: result.privateMessage,
        wireformat: "mls_private_message",
        version: "mls10",
      }),
    ),
    epoch: Number(state.groupContext.epoch),
  };
}

/** See storage.ts's StoredSentPlaintext doc comment: records what a message id's plaintext was. */
export async function cacheSentPlaintext(messageId: string, plaintext: string): Promise<void> {
  await saveSentPlaintext(messageId, plaintext);
}

export async function getCachedSentPlaintext(messageId: string): Promise<string | undefined> {
  return getSentPlaintext(messageId);
}

export interface AddDeviceResult {
  welcomeBytes: Uint8Array;
  commitBytes: Uint8Array;
  epoch: number;
}

/**
 * Adds a KeyPackage to an existing conversation via a single Add-proposal commit - used both
 * for linking another of the local user's own devices (scanned via QR) and, identically, for
 * adding a brand new member to a group (the MLS operation doesn't distinguish the two; only the
 * caller's intent differs).
 */
export async function addDeviceToConversation(
  conversationId: string,
  newDeviceKeyPackageBytes: Uint8Array,
): Promise<AddDeviceResult> {
  const impl = await getImpl();
  const state = await loadState(conversationId);
  if (!state) throw new Error(`No local state for conversation ${conversationId}`);

  const decodedPackage = decodePeerKeyPackage(newDeviceKeyPackageBytes);
  const commitResult = await createCommit(
    { state, cipherSuite: impl },
    { extraProposals: [{ proposalType: "add", add: { keyPackage: decodedPackage } }] },
  );
  if (!commitResult.welcome) throw new Error("Expected a welcome message for the new device");
  if (commitResult.commit.wireformat !== "mls_private_message") {
    throw new Error("Expected the add-device commit as a private message");
  }
  await persistState(conversationId, commitResult.newState);

  return {
    welcomeBytes: encodeWelcomeBundleRow(
      commitResult.newState.ratchetTree,
      encodeMlsMessage({
        welcome: commitResult.welcome,
        wireformat: "mls_welcome",
        version: "mls10",
      }),
    ),
    commitBytes: encodePlainRow(
      encodeMlsMessage({
        privateMessage: commitResult.commit.privateMessage,
        wireformat: "mls_private_message",
        version: "mls10",
      }),
    ),
    epoch: Number(commitResult.newState.groupContext.epoch),
  };
}

/**
 * A user's leaves within a group's current ratchet tree - every device they've linked occupies
 * its own leaf (the PRD's "every device is its own MLS member"), all sharing the same
 * credential identity (the userId this client always sets as `credential.identity`, see
 * `createConversation`/`generateKeyPackages`). Removing "a member" removes every leaf that
 * matches, not just one device.
 */
function findLeafIndexesForIdentity(tree: RatchetTree, userId: string): number[] {
  const target = new TextEncoder().encode(userId);
  const indexes: number[] = [];
  for (let nodeIndex = 0; nodeIndex < tree.length; nodeIndex += 2) {
    const node = tree[nodeIndex];
    if (node?.nodeType !== "leaf") continue;
    const { credential } = node.leaf;
    if (credential.credentialType === "basic" && bytesEqual(credential.identity, target)) {
      indexes.push(nodeIndex / 2);
    }
  }
  return indexes;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export interface RemoveMemberResult {
  commitBytes: Uint8Array;
  epoch: number;
}

/**
 * Removes every one of `targetUserId`'s devices from a group via a single commit (one Remove
 * proposal per matching leaf). No Welcome is produced - nobody is joining. Authorization (only
 * the conversation's creator may remove another member) is enforced server-side, not here; this
 * function only performs the MLS operation.
 *
 * The real ts-mls library rejects a commit whose Remove proposals include the committer's own
 * leaf ("Commit cannot contain a remove proposal removing committer" - confirmed empirically,
 * not just from the types) - this is standard MLS: a member cannot remove themselves in a
 * commit they author, since they wouldn't be a member of the tree the commit's own epoch
 * secrets are derived for. So this function must always be called by a DIFFERENT device than
 * `targetUserId`'s - see `leaveGroupLocally`'s doc comment for how a voluntary leave is handled.
 */
export async function removeGroupMember(
  conversationId: string,
  targetUserId: string,
): Promise<RemoveMemberResult> {
  const impl = await getImpl();
  const state = await loadState(conversationId);
  if (!state) throw new Error(`No local state for conversation ${conversationId}`);

  const leafIndexes = findLeafIndexesForIdentity(state.ratchetTree, targetUserId);
  if (leafIndexes.length === 0) {
    throw new Error(`${targetUserId} has no devices in this conversation's current tree`);
  }

  const commitResult = await createCommit(
    { state, cipherSuite: impl },
    {
      extraProposals: leafIndexes.map((removed) => ({
        proposalType: "remove" as const,
        remove: { removed },
      })),
    },
  );
  if (commitResult.commit.wireformat !== "mls_private_message") {
    throw new Error("Expected the remove commit as a private message");
  }
  await persistState(conversationId, commitResult.newState);

  return {
    commitBytes: encodePlainRow(
      encodeMlsMessage({
        privateMessage: commitResult.commit.privateMessage,
        wireformat: "mls_private_message",
        version: "mls10",
      }),
    ),
    epoch: Number(commitResult.newState.groupContext.epoch),
  };
}

/**
 * A member can't cryptographically remove themselves (see `removeGroupMember`'s doc comment),
 * so "leave" is two separate steps at the application level: the leaving member's own device
 * calls this to stop tracking the conversation locally and immediately (the server-side
 * `conversation_participants` status change that stops it being fetched for them at all is a
 * dm-service concern, not this module's); the actual MLS removal - excluding them from future
 * epochs' keys - happens later, the next time any OTHER member's client with local state for
 * this group notices the pending departure and calls `removeGroupMember` on their behalf (same
 * primitive the creator uses to remove someone involuntarily). Until that happens, the leaving
 * member's former device would still be cryptographically capable of decrypting messages it
 * somehow obtained, same inherent limitation as any poll-based (non-realtime) delivery system -
 * there is always a window before every client has caught up.
 */
export async function leaveGroupLocally(conversationId: string): Promise<void> {
  await deleteConversationState(conversationId);
}
