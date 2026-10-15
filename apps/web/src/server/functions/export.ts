import { exportAccountData } from "@plumas/auth";
import { createServerFn } from "@tanstack/react-start";

import { requireUser } from "../auth";
import { getDb } from "../db";

/** FR-MOD-06: everything this member owns - never another member's data. DM history is a
 * separate, client-only export (dm-client.ts's exportAllConversations) since the server only
 * ever holds ciphertext. */
export const exportAccountDataFn = createServerFn({ method: "GET" }).handler(async () => {
  const user = await requireUser();
  return exportAccountData(getDb(), user.id);
});
