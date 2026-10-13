import { afterEach, describe, expect, it, vi } from "vitest";

import { sendInviteEmail, sendMagicLinkEmail, sendNotificationEmail } from "./send";

describe("send (console fallback)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("logs the magic link instead of sending when RESEND_API_KEY is unset", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await sendMagicLinkEmail({ to: "jordan@example.com", url: "https://app.test/verify?x=1" });

    expect(logSpy).toHaveBeenCalledOnce();
    const [line] = logSpy.mock.calls[0] as [string];
    expect(line).toContain("jordan@example.com");
    expect(line).toContain("https://app.test/verify?x=1");
  });

  it("logs the invite link and inviter name instead of sending when RESEND_API_KEY is unset", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await sendInviteEmail({
      to: "neighbor@example.com",
      url: "https://app.test/invite/accept?token=abc",
      inviterName: "Maria L.",
      note: "Welcome to the street!",
    });

    expect(logSpy).toHaveBeenCalledOnce();
    const [line] = logSpy.mock.calls[0] as [string];
    expect(line).toContain("neighbor@example.com");
    expect(line).toContain("Maria L.");
  });

  it("logs the notification title, body, and link instead of sending when RESEND_API_KEY is unset", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await sendNotificationEmail({
      to: "jordan@example.com",
      title: "Maria L. commented on your post",
      body: "Bringing folding chairs.",
      url: "https://app.test/feed",
    });

    expect(logSpy).toHaveBeenCalledOnce();
    const [line] = logSpy.mock.calls[0] as [string];
    expect(line).toContain("jordan@example.com");
    expect(line).toContain("Maria L. commented on your post");
    expect(line).toContain("Bringing folding chairs.");
    expect(line).toContain("https://app.test/feed");
  });
});
