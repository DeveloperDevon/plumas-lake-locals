import { createInvite, listMyInvites, resendInvite, revokeInvite } from "@plumas/auth";
import { db } from "@plumas/db";
import { inviteCreateSchema } from "@plumas/validators";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireUser } from "../auth";

const inviteIdSchema = z.object({ inviteId: z.string().uuid() });

export const getMyInvites = createServerFn({ method: "GET" }).handler(async () => {
  const user = await requireUser();
  return listMyInvites(db(), user.id);
});

export const sendInvite = createServerFn({ method: "POST" })
  .validator(inviteCreateSchema)
  .handler(async ({ data }) => {
    const user = await requireUser();
    return createInvite(db(), { inviterId: user.id, email: data.email, note: data.note });
  });

export const revokeMyInvite = createServerFn({ method: "POST" })
  .validator(inviteIdSchema)
  .handler(async ({ data }) => {
    const user = await requireUser();
    return revokeInvite(db(), data.inviteId, user.id);
  });

export const resendMyInvite = createServerFn({ method: "POST" })
  .validator(inviteIdSchema)
  .handler(async ({ data }) => {
    const user = await requireUser();
    return resendInvite(db(), data.inviteId, user.id);
  });
