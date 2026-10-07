import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_app/feed")({ component: Feed });

function Feed() {
  const { user } = Route.useRouteContext();

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col gap-6 p-6">
      <h1 className="text-2xl font-semibold">Welcome, {user.name}</h1>
      <p className="text-muted-foreground">Your feed will show up here soon.</p>
    </main>
  );
}
