import { describe, expect, it } from "vitest";

import { runOneToOne } from "./one-to-one.js";

describe("MLS spike: 1:1 chat (PRD pass criterion)", () => {
  it("forms a group, exchanges messages both ways, and the wire format carries no plaintext", async () => {
    const result = await runOneToOne();

    expect(result.aliceReceivedFromBob).toBe("Hi Alice, Bob here.");
    expect(result.bobReceivedFromAlice).toBe("Hello Bob, this is Alice.");
    expect(result.epochAuthenticatorsMatch).toBe(true);
    expect(result.wireLooksLikeCiphertext).toBe(true);
    // PRD budget is 2s send-to-receive over a real network; this measures only the in-process
    // crypto overhead (no network hop), which should be a small fraction of that budget.
    expect(result.sendToDecryptMs).toBeLessThan(500);
  });
});
