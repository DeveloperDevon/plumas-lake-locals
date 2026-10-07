import { createAuth } from "@plumas/auth";
import { getRequest } from "@tanstack/react-start/server";

export async function getSessionUser() {
  const session = await createAuth().api.getSession({ headers: getRequest().headers });
  return session?.user ?? null;
}

export async function requireUser() {
  const user = await getSessionUser();
  if (!user) throw new Error("Not authenticated");
  // The real enforcement point for a suspension (FR-MOD-02) - takes effect on the very next
  // request, not just the next navigation. _app.tsx's beforeLoad checks the same field for a
  // clean redirect, but this is what actually blocks every mutating server function.
  if (user.status !== "active") throw new Error("Your account has been suspended.");
  return user;
}
