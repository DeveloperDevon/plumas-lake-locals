import type { EventView } from "@plumas/auth";
import { Button, Card, CardContent, CardHeader, CardTitle, Textarea } from "@plumas/ui";
import type { ReactionType } from "@plumas/validators";
import { createFileRoute, Link, notFound, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { CalendarDays } from "lucide-react";
import { useState } from "react";

import { EventCommentsSection, EventReactionBar } from "../../../components/event-interactions";
import { ReportToggle } from "../../../components/report-toggle";
import {
  formatEventTime,
  pacificWallClockToUtc,
  utcToPacificWallClock,
} from "../../../lib/format-date";
import { mediaUrl } from "../../../lib/upload-image";
import {
  deleteEventFn,
  getEventByIdFn,
  getEventCommentCountsFn,
  getEventReactionsFn,
  updateEventFn,
} from "../../../server/functions/events";

export const Route = createFileRoute("/_app/calendar/$eventId")({
  loader: async ({ params }) => {
    const event = await getEventByIdFn({ data: { eventId: params.eventId } });
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack's own notFound().
    if (!event) throw notFound();

    const [commentCounts, reactions] = await Promise.all([
      getEventCommentCountsFn({ data: { eventIds: [event.id] } }),
      getEventReactionsFn({ data: { eventIds: [event.id] } }),
    ]);

    return {
      event,
      commentCount: commentCounts[event.id] ?? 0,
      reactionCounts: reactions.counts[event.id],
      myReaction: reactions.mine[event.id] ?? null,
    };
  },
  component: EventDetail,
  notFoundComponent: () => (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-2 p-6 text-center">
      <p className="text-lg font-medium">Event not found</p>
      <p className="text-sm text-muted-foreground">
        It may not exist, or it&apos;s hosted by a private group you&apos;re not a member of.
      </p>
      <Link to="/calendar" className="text-sm font-medium text-primary hover:underline">
        Back to the calendar
      </Link>
    </main>
  ),
});

const emptyReactionCounts: Record<ReactionType, number> = {
  like: 0,
  love: 0,
  laugh: 0,
  sad: 0,
  helpful: 0,
};

function EventDetail() {
  const { user } = Route.useRouteContext();
  const initial = Route.useLoaderData();
  const navigate = useNavigate();

  const doUpdateEvent = useServerFn(updateEventFn);
  const doDeleteEvent = useServerFn(deleteEventFn);
  const doGetReactions = useServerFn(getEventReactionsFn);
  const doGetCommentCounts = useServerFn(getEventCommentCountsFn);

  const [event, setEvent] = useState<EventView>(initial.event);
  const [commentCount, setCommentCount] = useState(initial.commentCount);
  const [reactionCounts, setReactionCounts] = useState(
    initial.reactionCounts ?? emptyReactionCounts,
  );
  const [myReaction, setMyReaction] = useState<ReactionType | null>(initial.myReaction);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isCreator = event.createdBy === user.id;

  async function refreshReactionsAndComments() {
    const [reactions, commentCounts] = await Promise.all([
      doGetReactions({ data: { eventIds: [event.id] } }),
      doGetCommentCounts({ data: { eventIds: [event.id] } }),
    ]);
    setReactionCounts(reactions.counts[event.id] ?? emptyReactionCounts);
    setMyReaction(reactions.mine[event.id] ?? null);
    setCommentCount(commentCounts[event.id] ?? 0);
  }

  async function handleCancel() {
    if (deleting) return;
    setDeleting(true);
    setError(null);
    try {
      await doDeleteEvent({ data: { eventId: event.id } });
      await navigate({ to: "/calendar" });
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Couldn't cancel this event.");
      setDeleting(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col gap-4 p-6">
      <Card>
        <CardContent className="flex flex-col gap-3 pt-6">
          {event.coverKey ? (
            <img
              src={mediaUrl(event.coverKey, "medium")}
              alt={event.coverAltText ?? ""}
              className="h-40 w-full rounded-md object-cover"
            />
          ) : (
            <div className="flex h-40 w-full items-center justify-center rounded-md bg-muted">
              <CalendarDays className="h-10 w-10 text-muted-foreground" />
            </div>
          )}
          <h1 className="text-xl font-semibold">{event.title}</h1>
          <p className="text-sm">
            {event.allDay
              ? formatEventTime(event.startsAt, { timeStyle: undefined })
              : event.endsAt
                ? `${formatEventTime(event.startsAt)} - ${formatEventTime(event.endsAt)}`
                : formatEventTime(event.startsAt)}
          </p>
          {event.location ? (
            <p className="text-sm text-muted-foreground">{event.location}</p>
          ) : null}
          <p className="text-xs text-muted-foreground">
            Posted by{" "}
            <Link
              to="/profile/$userId"
              params={{ userId: event.createdBy }}
              className="font-medium hover:underline"
            >
              {event.creatorDisplayName}
            </Link>
            {event.hostName && event.hostSlug ? (
              <>
                {" "}
                · Hosted by{" "}
                <Link
                  to={event.hostType === "group" ? "/groups/$slug" : "/businesses/$slug"}
                  params={{ slug: event.hostSlug }}
                  className="font-medium hover:underline"
                >
                  {event.hostName}
                </Link>
              </>
            ) : null}
          </p>
          {event.description ? <p className="text-sm">{event.description}</p> : null}
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        {isCreator ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setEditing((v) => !v);
            }}
          >
            Edit
          </Button>
        ) : null}
        {isCreator ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={deleting}
            onClick={() => void handleCancel()}
          >
            Cancel event
          </Button>
        ) : (
          <ReportToggle targetType="event" targetId={event.id} />
        )}
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {isCreator && editing ? (
        <EditEventPanel
          event={event}
          onSave={async (input) => {
            const updated = await doUpdateEvent({ data: { eventId: event.id, ...input } });
            setEvent((previous) => ({ ...previous, ...updated }));
            setEditing(false);
          }}
        />
      ) : null}

      <Card>
        <CardContent className="flex flex-col gap-3 pt-6">
          <EventReactionBar
            eventId={event.id}
            reactionCounts={reactionCounts}
            myReaction={myReaction}
            onChanged={refreshReactionsAndComments}
          />
          <EventCommentsSection
            eventId={event.id}
            commentCount={commentCount}
            currentUserId={user.id}
            onCountChanged={refreshReactionsAndComments}
          />
        </CardContent>
      </Card>
    </main>
  );
}

function EditEventPanel({
  event,
  onSave,
}: {
  event: EventView;
  onSave: (input: {
    title: string;
    description?: string | undefined;
    startsAt: string;
    endsAt?: string | undefined;
    allDay: boolean;
    location?: string | undefined;
  }) => Promise<void>;
}) {
  const [title, setTitle] = useState(event.title);
  const [description, setDescription] = useState(event.description ?? "");
  const [allDay, setAllDay] = useState(event.allDay);
  const [startLocal, setStartLocal] = useState(utcToPacificWallClock(event.startsAt));
  const [endLocal, setEndLocal] = useState(event.endsAt ? utcToPacificWallClock(event.endsAt) : "");
  const [location, setLocation] = useState(event.location ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Edit event</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <input
          type="text"
          value={title}
          maxLength={150}
          className="h-10 rounded-md border border-border bg-background px-3 text-sm text-foreground"
          onChange={(e) => {
            setTitle(e.target.value);
          }}
        />
        <Textarea
          maxLength={2000}
          value={description}
          onChange={(e) => {
            setDescription(e.target.value);
          }}
        />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={allDay}
            onChange={(e) => {
              setAllDay(e.target.checked);
            }}
          />
          All-day event
        </label>
        <input
          type="datetime-local"
          value={startLocal}
          className="h-10 rounded-md border border-border bg-background px-3 text-sm text-foreground"
          onChange={(e) => {
            setStartLocal(e.target.value);
          }}
        />
        {!allDay ? (
          <input
            type="datetime-local"
            value={endLocal}
            className="h-10 rounded-md border border-border bg-background px-3 text-sm text-foreground"
            onChange={(e) => {
              setEndLocal(e.target.value);
            }}
          />
        ) : null}
        <input
          type="text"
          value={location}
          maxLength={200}
          placeholder="Location"
          className="h-10 rounded-md border border-border bg-background px-3 text-sm text-foreground"
          onChange={(e) => {
            setLocation(e.target.value);
          }}
        />
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <Button
          type="button"
          size="sm"
          disabled={saving || !title.trim()}
          onClick={() => {
            setSaving(true);
            setError(null);
            void onSave({
              title: title.trim(),
              description: description.trim() || undefined,
              startsAt: pacificWallClockToUtc(startLocal).toISOString(),
              endsAt:
                !allDay && endLocal ? pacificWallClockToUtc(endLocal).toISOString() : undefined,
              allDay,
              location: location.trim() || undefined,
            })
              .catch((saveError: unknown) => {
                setError(saveError instanceof Error ? saveError.message : "Couldn't save changes.");
              })
              .finally(() => {
                setSaving(false);
              });
          }}
        >
          Save
        </Button>
      </CardContent>
    </Card>
  );
}
