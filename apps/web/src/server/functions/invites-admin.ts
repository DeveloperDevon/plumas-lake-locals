import { createInvite, listMyInvites, resendInvite, revokeInvite } from "@plumas/auth";
import { inviteCreateSchema } from "@plumas/validators";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireUser } from "../auth";
import { getDb } from "../db";

const inviteIdSchema = z.object({ inviteId: z.string().uuid() });

export const getMyInvites = createServerFn({ method: "GET" }).handler(async () => {
  const user = await requireUser();
  return listMyInvites(getDb(), user.id);
});

export const sendInvite = createServerFn({ method: "POST" })
  .validator(inviteCreateSchema)
  .handler(async ({ data }) => {
    const user = await requireUser();
    return createInvite(getDb(), { inviterId: user.id, email: data.email, note: data.note });
  });

export const revokeMyInvite = createServerFn({ method: "POST" })
  .validator(inviteIdSchema)
  .handler(async ({ data }) => {
    const user = await requireUser();
    return revokeInvite(getDb(), data.inviteId, user.id);
  });

export const resendMyInvite = createServerFn({ method: "POST" })
  .validator(inviteIdSchema)
  .handler(async ({ data }) => {
    const user = await requireUser();
    return resendInvite(getDb(), data.inviteId, user.id);
  });
