import { customType } from "drizzle-orm/pg-core";

/** Raw binary storage for message ciphertext, key packages, and wrapped backup keys. */
export const bytea = customType<{ data: Buffer }>({
  dataType() {
    return "bytea";
  },
});

/** FR-FEED-08: a generated, GIN-indexed full-text search column - see each table's searchVector. */
export const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});
