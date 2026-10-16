import { deleteOwnAccount } from "@plumas/auth";
import { createServerFn } from "@tanstack/react-start";

import { requireUser } from "../auth";
import { getDb } from "../db";

/**
 * FR-MOD-06: permanently deletes the caller's own account. No input - an active session is
 * sufficient proof of identity (many seeded/test accounts have no password to re-verify), and
 * the "are you sure" confirmation lives entirely in the client UI.
 */
export const deleteOwnAccountFn = createServerFn({ method: "POST" }).handler(async () => {
  const user = await requireUser();
  await deleteOwnAccount(getDb(), user.id);
});
