/**
 * PRD pass criterion: "a 1:1 chat." Two simulated clients (Alice, Bob) exchange key packages
 * out of band, form a group, and exchange one application message each way. Also proves the
 * concrete reason `messages.ciphertext` (packages/db/src/schema/messages.ts) has no plaintext
 * column: the encoded wire bytes for an application message are opaque without the group's
 * keys, which `oneToOneResult.wireLooksLikeCiphertext` checks for directly.
 */
import type { ClientState } from "ts-mls";
import {
  createApplicationMessage,
  createCommit,
  createGroup,
  decodeMlsMessage,
  emptyPskIndex,
  encodeMlsMessage,
  joinGroup,
  makePskIndex,
  processPrivateMessage,
} from "ts-mls";

import { createMember, decodeText, encodeText, getImpl } from "./common.js";

export interface OneToOneResult {
  aliceReceivedFromBob: string;
  bobReceivedFromAlice: string;
  epochAuthenticatorsMatch: boolean;
  wireLooksLikeCiphertext: boolean;
  sendToDecryptMs: number;
}

export async function runOneToOne(): Promise<OneToOneResult> {
  const impl = await getImpl();

  const alice = await createMember("alice", impl);
  let aliceGroup: ClientState = await createGroup(
    encodeText("spike-1-1-group"),
    alice.publicPackage,
    alice.privatePackage,
    [],
    impl,
  );

  const bob = await createMember("bob", impl);

  // Bob's key package travels to Alice out of band (in the real app: via the server, same as
  // devices.ts's key_packages table) - round-tripped through the real wire encoding here.
  const keyPackageMessage = encodeMlsMessage({
    keyPackage: bob.publicPackage,
    wireformat: "mls_key_package",
    version: "mls10",
  });
  const decodedKeyPackage = decodeMlsMessage(keyPackageMessage, 0)?.[0];
  if (decodedKeyPackage?.wireformat !== "mls_key_package") throw new Error("Expected key package");

  const commitResult = await createCommit(
    { state: aliceGroup, cipherSuite: impl },
    {
      extraProposals: [{ proposalType: "add", add: { keyPackage: decodedKeyPackage.keyPackage } }],
    },
  );
  aliceGroup = commitResult.newState;
  if (!commitResult.welcome) throw new Error("Expected a welcome message for Bob");

  const encodedWelcome = encodeMlsMessage({
    welcome: commitResult.welcome,
    wireformat: "mls_welcome",
    version: "mls10",
  });
  const decodedWelcome = decodeMlsMessage(encodedWelcome, 0)?.[0];
  if (decodedWelcome?.wireformat !== "mls_welcome") throw new Error("Expected welcome");

  let bobGroup: ClientState = await joinGroup(
    decodedWelcome.welcome,
    bob.publicPackage,
    bob.privatePackage,
    emptyPskIndex,
    impl,
    aliceGroup.ratchetTree,
  );

  const epochAuthenticatorsMatch = bytesEqual(
    bobGroup.keySchedule.epochAuthenticator,
    aliceGroup.keySchedule.epochAuthenticator,
  );

  const started = performance.now();

  const plaintextToBob = encodeText("Hello Bob, this is Alice.");
  const aliceSend = await createApplicationMessage(aliceGroup, plaintextToBob, impl);
  aliceGroup = aliceSend.newState;
  const wireToBob = encodeMlsMessage({
    privateMessage: aliceSend.privateMessage,
    wireformat: "mls_private_message",
    version: "mls10",
  });

  // The actual proof that what would be stored server-side is opaque: the plaintext bytes
  // never appear anywhere in the encoded wire message.
  const wireLooksLikeCiphertext = !bufferIncludes(wireToBob, plaintextToBob);

  const decodedToBob = decodeMlsMessage(wireToBob, 0)?.[0];
  if (decodedToBob?.wireformat !== "mls_private_message")
    throw new Error("Expected private message");
  const bobReceive = await processPrivateMessage(
    bobGroup,
    decodedToBob.privateMessage,
    makePskIndex(bobGroup, {}),
    impl,
  );
  bobGroup = bobReceive.newState;
  if (bobReceive.kind !== "applicationMessage") throw new Error("Expected application message");

  const sendToDecryptMs = performance.now() - started;

  const plaintextToAlice = encodeText("Hi Alice, Bob here.");
  const bobSend = await createApplicationMessage(bobGroup, plaintextToAlice, impl);
  bobGroup = bobSend.newState;
  const wireToAlice = encodeMlsMessage({
    privateMessage: bobSend.privateMessage,
    wireformat: "mls_private_message",
    version: "mls10",
  });
  const decodedToAlice = decodeMlsMessage(wireToAlice, 0)?.[0];
  if (decodedToAlice?.wireformat !== "mls_private_message")
    throw new Error("Expected private message");
  const aliceReceive = await processPrivateMessage(
    aliceGroup,
    decodedToAlice.privateMessage,
    makePskIndex(aliceGroup, {}),
    impl,
  );
  aliceGroup = aliceReceive.newState;
  if (aliceReceive.kind !== "applicationMessage") throw new Error("Expected application message");

  return {
    aliceReceivedFromBob: decodeText(aliceReceive.message),
    bobReceivedFromAlice: decodeText(bobReceive.message),
    epochAuthenticatorsMatch,
    wireLooksLikeCiphertext,
    sendToDecryptMs,
  };
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function bufferIncludes(haystack: Uint8Array, needle: Uint8Array): boolean {
  if (needle.length === 0) return true;
  outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}
