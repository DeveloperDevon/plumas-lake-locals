import { describe, expect, it } from "vitest";

import { runDeviceLinking } from "./device-linking.js";

describe("MLS spike: device linking by QR code (PRD pass criterion)", () => {
  it("links a new device via its scanned KeyPackage and it can decrypt a message right away", async () => {
    const result = await runDeviceLinking();

    expect(result.newDeviceReceivedHistoryMessage).toBe("Welcome to your new laptop!");
    // Sanity bound on what actually has to fit in a QR code - a typical QR version can carry
    // a few KB of binary data comfortably; this just confirms the KeyPackage is well within that.
    expect(result.qrPayloadBytes).toBeLessThan(2000);
  });
});
