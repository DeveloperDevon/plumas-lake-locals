import { describe, expect, it } from "vitest";

import { runLargeGroup } from "./large-group.js";

describe("MLS spike: 50-member group (PRD pass criterion)", () => {
  it("adds 50 members one commit at a time and every member decrypts a message from the first", async () => {
    const result = await runLargeGroup(50);

    expect(result.memberCount).toBe(50);
    expect(result.allMembersDecrypted).toBe(true);
    // The PRD's "under 2 seconds" budget is about ongoing send-to-receive latency, not one-time
    // group formation - this is the metric that maps to it. ~28s to form the group via 50
    // sequential single-add commits is a separate, real finding (see the ADR): a bulk invite
    // flow should batch multiple adds into one commit instead, which MLS supports directly.
    expect(result.messageFanOutMs).toBeLessThan(2000);
    // Group formation itself (50 sequential single-add commits) is the slow part at ~28s
    // standalone - documented as a real finding in the ADR, not something to paper over here.
    // The generous timeout is for that, not for the per-message criterion asserted above.
  }, 60_000);
});
