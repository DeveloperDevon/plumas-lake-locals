import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));

// The dev server's stdout carries the console-fallback "email" for invites and magic links
// (no Resend account needed locally) - redirected to this file so tests can scrape links out
// of it the same way a person would click a link in their real inbox. See mail.ts.
export const webServerLogFile = path.join(dirname, "..", ".tmp", "web.log");
