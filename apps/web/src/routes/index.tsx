import { Button } from "@plumas/ui";
import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/")({ component: Landing });

function Landing() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Plumas Lake Locals</h1>
        <p className="mt-2 text-slate-600">
          A private, invite-only community for Plumas Lake. You can only join if a neighbor invites
          you.
        </p>
      </div>
      <Button asChild>
        <Link to="/sign-in">Sign in</Link>
      </Button>
    </main>
  );
}
