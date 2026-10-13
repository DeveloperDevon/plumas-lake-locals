import type { EventSummary } from "@plumas/auth";
import { Button } from "@plumas/ui";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { CalendarDays, Repeat } from "lucide-react";
import { useState } from "react";

import { formatEventTime, pacificWallClockToUtc } from "../../../lib/format-date";
import { mediaUrl } from "../../../lib/upload-image";
import { getEventsInRangeFn } from "../../../server/functions/events";

type ViewMode = "agenda" | "week" | "month";

function ymd(date: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${date.getFullYear().toString()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// Grid math runs on the viewer's own local calendar (plain Date arithmetic) rather than
// re-deriving "today" in Pacific time - for this app's near-entirely-Plumas-Lake audience the
// two agree essentially always, and it keeps the view-switching UI simple. The Y-M-D numbers
// that come out are then treated as Pacific calendar dates (via pacificWallClockToUtc) only
// when turning a visible range into the UTC query boundary - that part does need to be exact,
// since it decides which events the query returns at all.
function startOfWeek(date: Date): Date {
  const result = new Date(date);
  result.setDate(result.getDate() - result.getDay());
  result.setHours(0, 0, 0, 0);
  return result;
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function monthGridStart(date: Date): Date {
  return startOfWeek(startOfMonth(date));
}

function rangeForView(view: ViewMode, refDate: Date): { start: Date; end: Date } {
  if (view === "week") {
    const start = startOfWeek(refDate);
    const end = addDays(start, 7);
    return {
      start: pacificWallClockToUtc(`${ymd(start)}T00:00`),
      end: pacificWallClockToUtc(`${ymd(end)}T00:00`),
    };
  }
  if (view === "month") {
    const start = monthGridStart(refDate);
    const end = addDays(start, 42);
    return {
      start: pacificWallClockToUtc(`${ymd(start)}T00:00`),
      end: pacificWallClockToUtc(`${ymd(end)}T00:00`),
    };
  }
  const start = new Date(refDate);
  start.setHours(0, 0, 0, 0);
  const end = addDays(start, 60);
  return {
    start: pacificWallClockToUtc(`${ymd(start)}T00:00`),
    end: pacificWallClockToUtc(`${ymd(end)}T00:00`),
  };
}

export const Route = createFileRoute("/_app/calendar/")({
  loader: async () => {
    const { start, end } = rangeForView("agenda", new Date());
    const events = await getEventsInRangeFn({
      data: { start: start.toISOString(), end: end.toISOString() },
    });
    return { events };
  },
  component: Calendar,
});

function EventCoverIcon({ coverKey }: { coverKey: string | null }) {
  if (coverKey) {
    return (
      <img
        src={mediaUrl(coverKey, "thumbnail")}
        alt=""
        className="h-12 w-12 shrink-0 rounded-md object-cover"
      />
    );
  }
  return (
    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-muted">
      <CalendarDays className="h-6 w-6 text-muted-foreground" />
    </div>
  );
}

function EventRow({ event }: { event: EventSummary }) {
  return (
    <Link
      to="/calendar/$eventId"
      params={{ eventId: event.id }}
      className="flex items-center gap-3 rounded-md border border-border p-3 hover:bg-muted"
    >
      <EventCoverIcon coverKey={event.coverKey} />
      <div className="min-w-0">
        <p className="flex items-center gap-1 truncate text-sm font-medium">
          {event.title}
          {event.recurrence !== "none" ? (
            <Repeat
              className="h-3 w-3 shrink-0 text-muted-foreground"
              aria-label={event.recurrence === "weekly" ? "Repeats weekly" : "Repeats monthly"}
            />
          ) : null}
        </p>
        <p className="text-xs text-muted-foreground">
          {event.allDay
            ? formatEventTime(event.startsAt, { timeStyle: undefined })
            : formatEventTime(event.startsAt)}
          {event.location ? ` · ${event.location}` : ""}
        </p>
        {event.hostName ? (
          <p className="text-xs text-muted-foreground">Hosted by {event.hostName}</p>
        ) : null}
      </div>
    </Link>
  );
}

function Calendar() {
  const initial = Route.useLoaderData();
  const doGetEvents = useServerFn(getEventsInRangeFn);

  const [view, setView] = useState<ViewMode>("agenda");
  const [refDate, setRefDate] = useState(() => new Date());
  const [events, setEvents] = useState<EventSummary[]>(initial.events);
  const [loading, setLoading] = useState(false);

  async function refresh(nextView: ViewMode, nextRefDate: Date) {
    setLoading(true);
    try {
      const { start, end } = rangeForView(nextView, nextRefDate);
      const page = await doGetEvents({
        data: { start: start.toISOString(), end: end.toISOString() },
      });
      setEvents(page);
    } finally {
      setLoading(false);
    }
  }

  function changeView(nextView: ViewMode) {
    setView(nextView);
    void refresh(nextView, refDate);
  }

  function navigate(direction: 1 | -1) {
    const next =
      view === "month"
        ? new Date(refDate.getFullYear(), refDate.getMonth() + direction, 1)
        : addDays(refDate, direction * 7);
    setRefDate(next);
    void refresh(view, next);
  }

  function goToday() {
    const next = new Date();
    setRefDate(next);
    void refresh(view, next);
  }

  const eventsByDay = new Map<string, EventSummary[]>();
  for (const event of events) {
    const key = ymd(event.startsAt);
    const list = eventsByDay.get(key) ?? [];
    list.push(event);
    eventsByDay.set(key, list);
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Calendar</h1>
        <Link to="/calendar/new" className="text-sm font-medium text-primary hover:underline">
          New event
        </Link>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1">
          {(["agenda", "week", "month"] as const).map((mode) => (
            <Button
              key={mode}
              type="button"
              size="sm"
              variant={view === mode ? "default" : "outline"}
              onClick={() => {
                changeView(mode);
              }}
            >
              {mode === "agenda" ? "Agenda" : mode === "week" ? "Week" : "Month"}
            </Button>
          ))}
        </div>
        {view !== "agenda" ? (
          <div className="flex gap-1">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                navigate(-1);
              }}
            >
              Prev
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={goToday}>
              Today
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                navigate(1);
              }}
            >
              Next
            </Button>
          </div>
        ) : null}
      </div>

      {loading ? <p className="text-sm text-muted-foreground">Loading...</p> : null}

      {view === "agenda" ? (
        <AgendaView eventsByDay={eventsByDay} />
      ) : view === "week" ? (
        <WeekView refDate={refDate} eventsByDay={eventsByDay} />
      ) : (
        <MonthView refDate={refDate} eventsByDay={eventsByDay} />
      )}
    </main>
  );
}

function AgendaView({ eventsByDay }: { eventsByDay: Map<string, EventSummary[]> }) {
  const days = [...eventsByDay.keys()].sort();
  if (days.length === 0) {
    return <p className="text-sm text-muted-foreground">No upcoming events in the next 60 days.</p>;
  }
  return (
    <div className="flex flex-col gap-4">
      {days.map((day) => (
        <div key={day} className="flex flex-col gap-2">
          <p className="text-sm font-semibold text-muted-foreground">
            {new Date(`${day}T00:00`).toLocaleDateString("en-US", {
              weekday: "long",
              month: "long",
              day: "numeric",
            })}
          </p>
          {(eventsByDay.get(day) ?? []).map((event) => (
            <EventRow key={event.id} event={event} />
          ))}
        </div>
      ))}
    </div>
  );
}

function WeekView({
  refDate,
  eventsByDay,
}: {
  refDate: Date;
  eventsByDay: Map<string, EventSummary[]>;
}) {
  const start = startOfWeek(refDate);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  return (
    <div className="flex flex-col gap-4">
      {days.map((day) => {
        const key = ymd(day);
        const dayEvents = eventsByDay.get(key) ?? [];
        return (
          <div key={key} className="flex flex-col gap-2">
            <p className="text-sm font-semibold text-muted-foreground">
              {day.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}
            </p>
            {dayEvents.length === 0 ? (
              <p className="text-xs text-muted-foreground">No events.</p>
            ) : (
              dayEvents.map((event) => <EventRow key={event.id} event={event} />)
            )}
          </div>
        );
      })}
    </div>
  );
}

function MonthView({
  refDate,
  eventsByDay,
}: {
  refDate: Date;
  eventsByDay: Map<string, EventSummary[]>;
}) {
  const gridStart = monthGridStart(refDate);
  const days = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const currentMonth = refDate.getMonth();

  return (
    <div>
      <div className="grid grid-cols-7 gap-1 text-center text-xs font-medium text-muted-foreground">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((label) => (
          <div key={label}>{label}</div>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {days.map((day) => {
          const key = ymd(day);
          const dayEvents = eventsByDay.get(key) ?? [];
          const isCurrentMonth = day.getMonth() === currentMonth;
          return (
            <div
              key={key}
              className={`flex min-h-20 flex-col gap-1 rounded-md border border-border p-1 text-xs ${
                isCurrentMonth ? "" : "text-muted-foreground opacity-50"
              }`}
            >
              <span>{day.getDate()}</span>
              {dayEvents.slice(0, 2).map((event) => (
                <Link
                  key={event.id}
                  to="/calendar/$eventId"
                  params={{ eventId: event.id }}
                  className="truncate rounded bg-muted px-1 text-primary"
                  title={event.title}
                >
                  {event.title}
                </Link>
              ))}
              {dayEvents.length > 2 ? (
                <span className="text-muted-foreground">+{dayEvents.length - 2} more</span>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
