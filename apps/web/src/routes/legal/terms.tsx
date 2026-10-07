import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/legal/terms")({ component: Terms });

function Terms() {
  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="text-2xl font-semibold">Terms of use</h1>
      <p className="mt-4 text-muted-foreground">
        Plumas Lake Locals is a private, invite-only community. By joining, you agree to use the
        community guidelines in good faith, invite only people you know, and confirm you are 18
        years of age or older.
      </p>
    </main>
  );
}
