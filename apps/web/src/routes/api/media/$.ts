import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";

import { requireUser } from "../../../server/auth";

/**
 * Serves R2 objects behind a session check - the app is invite-only (NFR-07), so images stay
 * gated the same as every other page rather than living at a public bucket URL. Parses the
 * key straight off the URL rather than relying on the exact splat-param name, since the key
 * itself (e.g. "media/<uuid>/thumbnail.webp") contains slashes.
 */
export const Route = createFileRoute("/api/media/$")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        await requireUser();

        const url = new URL(request.url);
        const key = url.pathname.replace(/^\/api\/media\//, "");
        if (!key) return new Response("Not found", { status: 404 });

        const object = await env.MEDIA_BUCKET.get(key);
        if (!object) return new Response("Not found", { status: 404 });

        const headers = new Headers();
        object.writeHttpMetadata(headers);
        headers.set("etag", object.httpEtag);
        // Content-addressed by variant path, never mutated in place once written.
        headers.set("cache-control", "private, max-age=31536000, immutable");

        return new Response(object.body, { headers });
      },
    },
  },
});
