/**
 * PRD pass criterion: "device linking by QR code." Matches this app's actual schema design
 * (packages/db/src/schema/devices.ts: "linking a device is a membership change" - a new
 * device publishes a single-use KeyPackage, an already-linked device adds it via a normal
 * commit) rather than an MLS external-join - the new device can't act on its own behalf until
 * something already in the group vouches for it.
 *
 * The data that actually has to cross the QR code is the new device's encoded KeyPackage -
 * everything else (the resulting commit/Welcome) travels back through the server as usual.
 * `encodeKeyPackageForQr`/`decodeKeyPackageFromQr` are the byte-level half of that exchange,
 * exercised here with plain byte arrays; the pixel-level QR generate/scan round-trip is
 * exercised separately in the browser harness (packages/crypto/harness/), since jsqr/qrcode
 * are about image pixels, not MLS.
 */
import type { ClientState, KeyPackage } from "ts-mls";
import {
  createApplicationMessage,
  createCommit,
  createGroup,
  emptyPskIndex,
  joinGroup,
  makePskIndex,
  processPrivateMessage,
} from "ts-mls";
// Not re-exported from ts-mls's public index - imported via the package's own "./*.js"
// subpath export instead (its package.json exposes every dist/src/*.js module that way).
import { decodeKeyPackage, encodeKeyPackage } from "ts-mls/keyPackage.js";

import { createMember, decodeText, encodeText, getImpl } from "./common.js";

export function encodeKeyPackageForQr(keyPackage: KeyPackage): Uint8Array {
  return encodeKeyPackage(keyPackage);
}

export function decodeKeyPackageFromQr(bytes: Uint8Array): KeyPackage {
  const decoded = decodeKeyPackage(bytes, 0);
  if (!decoded) throw new Error("Could not decode a KeyPackage from the scanned QR payload");
  return decoded[0];
}

export interface DeviceLinkingResult {
  newDeviceReceivedHistoryMessage: string;
  qrPayloadBytes: number;
}

export async function runDeviceLinking(): Promise<DeviceLinkingResult> {
  const impl = await getImpl();

  // "existing device" = the user's already-linked phone, already in a 1:1 group with a friend.
  const existingDevice = await createMember("devon-phone", impl);
  let existingDeviceGroup: ClientState = await createGroup(
    encodeText("spike-device-link-group"),
    existingDevice.publicPackage,
    existingDevice.privatePackage,
    [],
    impl,
  );

  const friend = await createMember("friend", impl);
  const addFriendCommit = await createCommit(
    { state: existingDeviceGroup, cipherSuite: impl },
    { extraProposals: [{ proposalType: "add", add: { keyPackage: friend.publicPackage } }] },
  );
  existingDeviceGroup = addFriendCommit.newState;
  if (!addFriendCommit.welcome) throw new Error("Expected a welcome for the friend");
  let friendGroup: ClientState = await joinGroup(
    addFriendCommit.welcome,
    friend.publicPackage,
    friend.privatePackage,
    emptyPskIndex,
    impl,
    existingDeviceGroup.ratchetTree,
  );

  // "new device" = the user's new laptop. It has no group membership yet - it only generates a
  // KeyPackage and shows it as a QR code for the existing device to scan.
  const newDevice = await createMember("devon-laptop", impl);
  const qrPayload = encodeKeyPackageForQr(newDevice.publicPackage);

  // The existing device scans the QR and uses the decoded KeyPackage in a normal add commit -
  // exactly the same mechanism as a brand new 1:1 join (one-to-one.ts), just initiated from
  // the already-linked device instead of from the server relaying a request.
  const scannedKeyPackage = decodeKeyPackageFromQr(qrPayload);
  const addDeviceCommit = await createCommit(
    { state: existingDeviceGroup, cipherSuite: impl },
    { extraProposals: [{ proposalType: "add", add: { keyPackage: scannedKeyPackage } }] },
  );
  existingDeviceGroup = addDeviceCommit.newState;
  if (!addDeviceCommit.welcome) throw new Error("Expected a welcome for the new device");
  if (addDeviceCommit.commit.wireformat !== "mls_private_message") {
    throw new Error("Expected the add-device commit as a private message");
  }

  // The friend's existing device also has to apply the same commit to stay in sync.
  const friendProcessResult = await processPrivateMessage(
    friendGroup,
    addDeviceCommit.commit.privateMessage,
    makePskIndex(friendGroup, {}),
    impl,
  );
  friendGroup = friendProcessResult.newState;

  const newDeviceGroup: ClientState = await joinGroup(
    addDeviceCommit.welcome,
    newDevice.publicPackage,
    newDevice.privatePackage,
    emptyPskIndex,
    impl,
    existingDeviceGroup.ratchetTree,
  );

  // Prove the new device can actually participate: the friend sends a message, the brand new
  // laptop (which never had any prior group state) decrypts it.
  const messageFromFriend = encodeText("Welcome to your new laptop!");
  const friendSend = await createApplicationMessage(friendGroup, messageFromFriend, impl);
  const newDeviceReceive = await processPrivateMessage(
    newDeviceGroup,
    friendSend.privateMessage,
    makePskIndex(newDeviceGroup, {}),
    impl,
  );
  if (newDeviceReceive.kind !== "applicationMessage")
    throw new Error("Expected application message");

  return {
    newDeviceReceivedHistoryMessage: decodeText(newDeviceReceive.message),
    qrPayloadBytes: qrPayload.byteLength,
  };
}
