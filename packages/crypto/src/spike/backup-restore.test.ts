import { describe, expect, it } from "vitest";

import { runBackupRestore } from "./backup-restore.js";

describe("MLS spike: encrypted backup and restore (PRD pass criterion)", () => {
  it("a brand new client restored purely from an encrypted backup can decrypt and resume participation", async () => {
    const result = await runBackupRestore();

    expect(result.restoredCanDecryptPriorMessage).toBe("Still on the same epoch as your backup.");
    expect(result.restoredCanSendAndReceiveNewMessage).toBe("Back online on my new device.");
  });
});
