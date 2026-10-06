import { migrate } from "drizzle-orm/postgres-js/migrator";

import { createDb } from "../client";

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("Missing required env var: DATABASE_URL");

  const database = createDb(connectionString);
  await migrate(database, { migrationsFolder: "./migrations" });
  console.log("Migrations applied.");
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
