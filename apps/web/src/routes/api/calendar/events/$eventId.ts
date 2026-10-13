import { buildIcsCalendar, eventToVevent, getEventById } from "@plumas/auth";
import { createFileRoute } from "@tanstack/react-router";

import { requireUser } from "../../../../server/auth";
import { getDb } from "../../../../server/db";

/**
 * FR-CAL-06: a single event, as a downloadable .ics - a plain fetch-handler route, same pattern
 * as api/media/$.ts. Reuses getEventById's own FR-CAL-11 visibility check (404 on null), so a
 * private-group event can't be exported by someone who can't see it either.
 */
export const Route = createFileRoute("/api/calendar/events/$eventId")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const user = await requireUser();
        const event = await getEventById(getDb(), params.eventId, user.id);
        if (!event) return new Response("Not found", { status: 404 });

        const body = buildIcsCalendar([eventToVevent(event)]);
        const filename = `${event.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "event"}.ics`;
        return new Response(body, {
          headers: {
            "content-type": "text/calendar; charset=utf-8",
            "content-disposition": `attachment; filename="${filename}"`,
          },
        });
      },
    },
  },
});
