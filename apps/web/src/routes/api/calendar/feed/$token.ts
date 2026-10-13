import {
  buildIcsCalendar,
  eventToVevent,
  getUserIdForCalendarFeedToken,
  listAllVisibleEventsForFeed,
} from "@plumas/auth";
import { createFileRoute } from "@tanstack/react-router";

import { getDb } from "../../../../server/db";

/**
 * FR-CAL-06: the private ICS feed - no session check (a subscribing calendar app has no
 * cookies), token-authenticated instead, same "only the hash is stored, looked up by hash"
 * shape as invite tokens. No ".ics" suffix needed in the URL: calendar apps key off
 * Content-Type and the body, not the extension.
 */
export const Route = createFileRoute("/api/calendar/feed/$token")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const db = getDb();
        const userId = await getUserIdForCalendarFeedToken(db, params.token);
        if (!userId) return new Response("Not found", { status: 404 });

        const events = await listAllVisibleEventsForFeed(db, userId);
        const body = buildIcsCalendar(events.map((event) => eventToVevent(event)));
        return new Response(body, {
          headers: { "content-type": "text/calendar; charset=utf-8" },
        });
      },
    },
  },
});
