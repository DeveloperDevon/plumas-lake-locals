import {
  acceptRelationship,
  getRelationshipBetween,
  listAcceptedRelationships,
  listIncomingRequests,
  listOutgoingRequests,
  removeRelationship,
  requestRelationship,
} from "@plumas/auth";
import {
  acceptRelationshipSchema,
  relationshipRequestSchema,
  removeRelationshipSchema,
} from "@plumas/validators";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireUser } from "../auth";
import { getDb } from "../db";

export const getRelationshipsForProfile = createServerFn({ method: "GET" })
  .validator(z.object({ userId: z.string().uuid() }))
  .handler(async ({ data }) => {
    await requireUser();
    return listAcceptedRelationships(getDb(), data.userId);
  });

/** Used only on a non-owner profile, to decide which action widget to show. */
export const getRelationshipStatus = createServerFn({ method: "GET" })
  .validator(z.object({ otherUserId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const user = await requireUser();
    return getRelationshipBetween(getDb(), user.id, data.otherUserId);
  });

export const getMyPendingRequests = createServerFn({ method: "GET" }).handler(async () => {
  const user = await requireUser();
  const db = getDb();
  const [incoming, outgoing] = await Promise.all([
    listIncomingRequests(db, user.id),
    listOutgoingRequests(db, user.id),
  ]);
  return { incoming, outgoing };
});

export const requestRelationshipFn = createServerFn({ method: "POST" })
  .validator(relationshipRequestSchema)
  .handler(async ({ data }) => {
    const user = await requireUser();
    return requestRelationship(getDb(), { fromUserId: user.id, ...data });
  });

export const acceptRelationshipFn = createServerFn({ method: "POST" })
  .validator(acceptRelationshipSchema)
  .handler(async ({ data }) => {
    const user = await requireUser();
    return acceptRelationship(getDb(), data.relationshipId, user.id);
  });

export const removeRelationshipFn = createServerFn({ method: "POST" })
  .validator(removeRelationshipSchema)
  .handler(async ({ data }) => {
    const user = await requireUser();
    await removeRelationship(getDb(), data.relationshipId, user.id);
    return { ok: true as const };
  });
