import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/legal/privacy")({ component: Privacy });

function Privacy() {
  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="text-2xl font-semibold">Privacy</h1>
      <p className="mt-4 text-muted-foreground">
        Photos are stripped of location data before storage. Direct messages are end-to-end
        encrypted: the server can see who is talking to whom and when, but never the content of a
        message. No content here is publicly indexed or visible outside the community.
      </p>
    </main>
  );
}
