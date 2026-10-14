import { createDb, schema } from "@plumas/db";
import { describe, expect, it } from "vitest";

import { createBusiness, unpublishBusiness } from "./business-service";
import { acceptGroupInvite, createGroup, inviteMember } from "./group-service";
import { createPost, deletePost } from "./post-service";
import {
  searchBusinessesRanked,
  searchGroupsRanked,
  searchMembersRanked,
  searchPostsRanked,
} from "./search-service";

const { users } = schema;

function mustGetEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name} - run tests with .env sourced`);
  return value;
}

function uniqueEmail(label: string): string {
  return `${label}-${crypto.randomUUID()}@example.test`;
}

describe("search-service (integration, against the real local Postgres)", () => {
  const db = createDb(mustGetEnv("DATABASE_URL"));

  async function makeMember(label: string, role: "member" | "admin" = "member") {
    const token = crypto.randomUUID().slice(0, 8);
    const [user] = await db
      .insert(users)
      .values({
        email: uniqueEmail(label),
        displayName: `Searchable-${token} ${label}`,
        role,
      })
      .returning();
    if (!user) throw new Error("setup failed");
    return user;
  }

  it("ranks matching posts and excludes soft-deleted ones", async () => {
    const author = await makeMember("author-post-search");
    const viewer = await makeMember("viewer-post-search");
    const token = `kumquat${crypto.randomUUID().slice(0, 8)}`;
    const post = await createPost(db, {
      authorId: author.id,
      body: `Lost a ${token} orchard map, please help`,
    });

    let results = await searchPostsRanked(db, token, viewer.id);
    expect(results.some((row) => row.id === post.id)).toBe(true);
    expect(results.find((row) => row.id === post.id)?.contextType).toBe("feed");

    await deletePost(db, post.id, author.id);
    results = await searchPostsRanked(db, token, viewer.id);
    expect(results.some((row) => row.id === post.id)).toBe(false);
  });

  it("excludes a private group's posts from search for a non-member, includes them for a member", async () => {
    const owner = await makeMember("owner-post-private");
    const member = await makeMember("member-post-private");
    const outsider = await makeMember("outsider-post-private");
    const token = `wombat${crypto.randomUUID().slice(0, 8)}`;
    const group = await createGroup(db, {
      ownerId: owner.id,
      name: `Secret ${token} club`,
      visibility: "private",
    });
    await inviteMember(db, group.id, member.id, owner.id);
    await acceptGroupInvite(db, group.id, member.id);
    const post = await createPost(db, {
      authorId: owner.id,
      body: `Announcing the ${token} potluck`,
      contextType: "group",
      contextId: group.id,
    });

    const outsiderResults = await searchPostsRanked(db, token, outsider.id);
    expect(outsiderResults.some((row) => row.id === post.id)).toBe(false);

    const memberResults = await searchPostsRanked(db, token, member.id);
    expect(memberResults.some((row) => row.id === post.id)).toBe(true);
  });

  it("excludes an unpublished business's posts from search entirely", async () => {
    const owner = await makeMember("owner-post-biz");
    const admin = await makeMember("admin-post-biz", "admin");
    const viewer = await makeMember("viewer-post-biz");
    const token = `platypus${crypto.randomUUID().slice(0, 8)}`;
    const business = await createBusiness(db, {
      ownerId: owner.id,
      name: `${token} Repair Co`,
      serviceArea: "Plumas Lake",
    });
    const post = await createPost(db, {
      authorId: owner.id,
      body: `We now offer ${token} tune-ups`,
      contextType: "business",
      contextId: business.id,
    });

    let results = await searchPostsRanked(db, token, viewer.id);
    expect(results.some((row) => row.id === post.id)).toBe(true);

    await unpublishBusiness(db, business.id, admin.id);
    results = await searchPostsRanked(db, token, viewer.id);
    expect(results.some((row) => row.id === post.id)).toBe(false);
  });

  it("ranks matching members, excluding the viewer themselves and suspended members", async () => {
    // "locatable", not "findable" - dm-service.test.ts's searchMembers test already searches
    // the literal substring "findable" across this same shared dev DB; reusing that word here
    // would add more matching rows to its result window every run and make that test flakier.
    const token = `narwhal${crypto.randomUUID().slice(0, 8)}`;
    const viewer = await makeMember("viewer-member-search");
    const locatable = await makeMember(`locatable-${token}`);
    const [suspended] = await db
      .insert(users)
      .values({
        email: uniqueEmail("suspended-member-search"),
        displayName: `Locatable-${token} suspended`,
        status: "suspended",
      })
      .returning();
    if (!suspended) throw new Error("setup failed");

    const results = await searchMembersRanked(db, `Locatable-${token}`, viewer.id);
    expect(results.some((row) => row.id === locatable.id)).toBe(true);
    expect(results.some((row) => row.id === suspended.id)).toBe(false);
    expect(results.some((row) => row.id === viewer.id)).toBe(false);
  });

  it("ranks matching public groups and excludes private ones", async () => {
    const owner = await makeMember("owner-group-search");
    const token = `armadillo${crypto.randomUUID().slice(0, 8)}`;
    const publicGroup = await createGroup(db, {
      ownerId: owner.id,
      name: `${token} Gardening Club`,
      visibility: "public",
    });
    const privateGroup = await createGroup(db, {
      ownerId: owner.id,
      name: `${token} Secret Society`,
      visibility: "private",
    });

    const results = await searchGroupsRanked(db, token);
    expect(results.some((row) => row.id === publicGroup.id)).toBe(true);
    expect(results.some((row) => row.id === privateGroup.id)).toBe(false);
  });

  it("ranks matching businesses and excludes unpublished ones", async () => {
    const owner = await makeMember("owner-biz-search");
    const admin = await makeMember("admin-biz-search", "admin");
    const token = `pangolin${crypto.randomUUID().slice(0, 8)}`;
    const business = await createBusiness(db, {
      ownerId: owner.id,
      name: `${token} Tutoring`,
      serviceArea: "Plumas Lake",
    });

    let results = await searchBusinessesRanked(db, token);
    expect(results.some((row) => row.id === business.id)).toBe(true);

    await unpublishBusiness(db, business.id, admin.id);
    results = await searchBusinessesRanked(db, token);
    expect(results.some((row) => row.id === business.id)).toBe(false);
  });
});
