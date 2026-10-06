import { readFileSync } from "node:fs";

import { webServerLogFile } from "./log-path";

/** Current size of the dev server's log, so a test only matches links sent after this point. */
export function logCheckpoint(): number {
  try {
    return readFileSync(webServerLogFile, "utf8").length;
  } catch {
    return 0;
  }
}

/**
 * Polls the dev server's log (its console-fallback "email" transport - see
 * packages/email/src/send.tsx) for a link matching `pattern`, appended after `since`. This is
 * what a person clicking a link in their real inbox is standing in for.
 */
export async function waitForLink(
  pattern: RegExp,
  since: number,
  timeoutMs = 10_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const content = readFileSync(webServerLogFile, "utf8");
    const match = pattern.exec(content.slice(since));
    if (match?.[1]) return match[1].replace(/&amp;/g, "&");
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for a link matching ${String(pattern)} in the server log`);
}

export async function waitForInviteLink(since: number): Promise<string> {
  return waitForLink(/href="(http:\/\/localhost:3000\/invite\/accept\?[^"]*)"/, since);
}

export async function waitForMagicLink(since: number): Promise<string> {
  return waitForLink(
    /href="(http:\/\/localhost:3000\/api\/auth\/magic-link\/verify\?[^"]*)"/,
    since,
  );
}
