/**
 * PRD pass criterion: "a 50-member group." Starts with one member and adds the rest one
 * commit at a time (the same add-and-fan-out-the-commit shape every real add in this app
 * will use), then confirms every member can send and every other member can decrypt, and
 * records timing for both the commit fan-out and the full message fan-out.
 */
import type { ClientState, KeyPackage, PrivateKeyPackage } from "ts-mls";
import {
  createApplicationMessage,
  createCommit,
  createGroup,
  emptyPskIndex,
  joinGroup,
  makePskIndex,
  processPrivateMessage,
} from "ts-mls";

import { createMember, decodeText, encodeText, getImpl } from "./common.js";

interface MemberState {
  name: string;
  state: ClientState;
  publicPackage: KeyPackage;
  privatePackage: PrivateKeyPackage;
}

export interface LargeGroupResult {
  memberCount: number;
  allMembersDecrypted: boolean;
  addFanOutMs: number;
  messageFanOutMs: number;
}

export async function runLargeGroup(targetSize = 50): Promise<LargeGroupResult> {
  const impl = await getImpl();

  const creator = await createMember("member-0", impl);
  const creatorState = await createGroup(
    encodeText("spike-large-group"),
    creator.publicPackage,
    creator.privatePackage,
    [],
    impl,
  );
  const creatorMember: MemberState = {
    name: "member-0",
    state: creatorState,
    publicPackage: creator.publicPackage,
    privatePackage: creator.privatePackage,
  };
  const members: MemberState[] = [creatorMember];

  const addStarted = performance.now();

  for (let i = 1; i < targetSize; i++) {
    const newMember = await createMember(`member-${i.toString()}`, impl);
    const adder = creatorMember;

    const commitResult = await createCommit(
      { state: adder.state, cipherSuite: impl },
      { extraProposals: [{ proposalType: "add", add: { keyPackage: newMember.publicPackage } }] },
    );
    adder.state = commitResult.newState;
    if (!commitResult.welcome) throw new Error(`Expected a welcome for ${newMember.name}`);
    if (commitResult.commit.wireformat !== "mls_private_message") {
      throw new Error("Expected the add commit as a private message");
    }

    const newState = await joinGroup(
      commitResult.welcome,
      newMember.publicPackage,
      newMember.privatePackage,
      emptyPskIndex,
      impl,
      adder.state.ratchetTree,
    );

    // Fan the commit out to every other existing member so their tree stays in sync.
    for (const existing of members.slice(1)) {
      const result = await processPrivateMessage(
        existing.state,
        commitResult.commit.privateMessage,
        makePskIndex(existing.state, {}),
        impl,
      );
      existing.state = result.newState;
    }

    members.push({
      name: newMember.name,
      state: newState,
      publicPackage: newMember.publicPackage,
      privatePackage: newMember.privatePackage,
    });
  }

  const addFanOutMs = performance.now() - addStarted;

  const messageFanOutStarted = performance.now();

  const sender = creatorMember;
  const plaintext = encodeText(`Hello from ${sender.name}, group size ${targetSize.toString()}`);
  const send = await createApplicationMessage(sender.state, plaintext, impl);
  sender.state = send.newState;

  let allMembersDecrypted = true;
  for (const receiver of members.slice(1)) {
    const result = await processPrivateMessage(
      receiver.state,
      send.privateMessage,
      makePskIndex(receiver.state, {}),
      impl,
    );
    receiver.state = result.newState;
    if (
      result.kind !== "applicationMessage" ||
      decodeText(result.message) !== decodeText(plaintext)
    ) {
      allMembersDecrypted = false;
    }
  }

  const messageFanOutMs = performance.now() - messageFanOutStarted;

  return { memberCount: members.length, allMembersDecrypted, addFanOutMs, messageFanOutMs };
}
