import { createDb, schema } from "@plumas/db";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createMedia, listUserMedia, setUserAvatar, setUserCover } from "./media-service";

const { users } = schema;

function mustGetEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name} - run tests with .env sourced`);
  return value;
}

function uniqueEmail(label: string): string {
  return `${label}-${crypto.randomUUID()}@example.test`;
}

describe("media-service (integration, against the real local Postgres)", () => {
  const db = createDb(mustGetEnv("DATABASE_URL"));

  it("creates a media row with the given id and a null albumId by default", async () => {
    const [user] = await db
      .insert(users)
      .values({ email: uniqueEmail("media-owner"), displayName: "Owner" })
      .returning();
    if (!user) throw new Error("setup failed");

    const id = crypto.randomUUID();
    const row = await createMedia(db, {
      id,
      ownerId: user.id,
      r2Key: `media/${id}`,
      width: 100,
      height: 80,
    });

    expect(row.id).toBe(id);
    expect(row.albumId).toBeNull();
    expect(row.r2Key).toBe(`media/${id}`);
  });

  it("lists a user's media, newest first", async () => {
    const [user] = await db
      .insert(users)
      .values({ email: uniqueEmail("media-list"), displayName: "Lister" })
      .returning();
    if (!user) throw new Error("setup failed");

    const first = crypto.randomUUID();
    await createMedia(db, {
      id: first,
      ownerId: user.id,
      r2Key: `media/${first}`,
      width: 1,
      height: 1,
    });
    const second = crypto.randomUUID();
    await createMedia(db, {
      id: second,
      ownerId: user.id,
      r2Key: `media/${second}`,
      width: 1,
      height: 1,
    });

    const list = await listUserMedia(db, user.id);
    expect(list.map((item) => item.id)).toEqual([second, first]);
  });

  it("setUserAvatar/setUserCover only ever touch the given userId", async () => {
    const [user] = await db
      .insert(users)
      .values({ email: uniqueEmail("avatar-cover"), displayName: "Avatar Cover" })
      .returning();
    if (!user) throw new Error("setup failed");

    await setUserAvatar(db, user.id, "media/avatar-key");
    await setUserCover(db, user.id, "media/cover-key");

    const [updated] = await db
      .select({ avatarKey: users.avatarKey, coverKey: users.coverKey })
      .from(users)
      .where(eq(users.id, user.id));
    expect(updated).toMatchObject({ avatarKey: "media/avatar-key", coverKey: "media/cover-key" });
  });
});
