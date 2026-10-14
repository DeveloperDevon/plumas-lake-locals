import {
  searchBusinessesRanked,
  searchGroupsRanked,
  searchMembersRanked,
  searchPostsRanked,
} from "@plumas/auth";
import { searchSchema } from "@plumas/validators";
import { createServerFn } from "@tanstack/react-start";

import { requireUser } from "../auth";
import { getDb } from "../db";

/** FR-FEED-08: all four entity searches run in parallel, each already capped per-type. */
export const searchFn = createServerFn({ method: "GET" })
  .validator(searchSchema)
  .handler(async ({ data }) => {
    const user = await requireUser();
    const db = getDb();
    const [posts, members, groups, businesses] = await Promise.all([
      searchPostsRanked(db, data.query, user.id),
      searchMembersRanked(db, data.query, user.id),
      searchGroupsRanked(db, data.query),
      searchBusinessesRanked(db, data.query),
    ]);
    return { posts, members, groups, businesses };
  });
