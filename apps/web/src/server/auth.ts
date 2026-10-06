import { createAuth } from "@plumas/auth";
import { getRequest } from "@tanstack/react-start/server";

export async function getSessionUser() {
  const session = await createAuth().api.getSession({ headers: getRequest().headers });
  return session?.user ?? null;
}

export async function requireUser() {
  const user = await getSessionUser();
  if (!user) throw new Error("Not authenticated");
  return user;
}
