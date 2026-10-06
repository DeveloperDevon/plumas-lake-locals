import { createDb } from "../client";
import { ensureAdminUser, ensureSeedInvite } from "./admin-invites";

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("Missing required env var: DATABASE_URL");

  const adminEmail = process.env.ADMIN_SEED_EMAIL;
  if (!adminEmail) throw new Error("Missing required env var: ADMIN_SEED_EMAIL");

  const database = createDb(connectionString);

  const adminId = await ensureAdminUser(database, adminEmail);
  console.log(`Admin user ready: ${adminEmail} (${adminId})`);

  const inviteEmails = (process.env.ADMIN_SEED_INVITE_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim())
    .filter((email) => email.length > 0);

  if (inviteEmails.length === 0) {
    console.log("No ADMIN_SEED_INVITE_EMAILS set - skipping invite seeding.");
    return;
  }

  const appUrl = process.env.PUBLIC_APP_URL ?? "http://localhost:3000";
  for (const email of inviteEmails) {
    const token = await ensureSeedInvite(database, adminId, email);
    console.log(`Invite for ${email}: ${appUrl}/invite/accept?token=${token}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
