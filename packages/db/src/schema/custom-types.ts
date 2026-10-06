import { customType } from "drizzle-orm/pg-core";

/** Raw binary storage for message ciphertext, key packages, and wrapped backup keys. */
export const bytea = customType<{ data: Buffer }>({
  dataType() {
    return "bytea";
  },
});
