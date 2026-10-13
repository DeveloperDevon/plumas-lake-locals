import { Button, Textarea } from "@plumas/ui";
import type { EventHostType } from "@plumas/validators";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";

import { pacificWallClockToUtc } from "../../../lib/format-date";
import { uploadImage } from "../../../lib/upload-image";
import { getMyBusinessesFn } from "../../../server/functions/business";
import { createEventFn } from "../../../server/functions/events";
import { getMyHostableGroupsFn } from "../../../server/functions/groups";

export const Route = createFileRoute("/_app/calendar/new")({
  loader: async () => {
    const [myGroups, myBusinesses] = await Promise.all([
      getMyHostableGroupsFn(),
      getMyBusinessesFn(),
    ]);
    return { myGroups, myBusinesses };
  },
  component: NewEvent,
});

type HostChoice = "" | `group:${string}` | `business:${string}`;

function NewEvent() {
  const { myGroups, myBusinesses } = Route.useLoaderData();
  const navigate = useNavigate();

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [allDay, setAllDay] = useState(false);
  const [startLocal, setStartLocal] = useState("");
  const [endLocal, setEndLocal] = useState("");
  const [startDate, setStartDate] = useState("");
  const [location, setLocation] = useState("");
  const [hostChoice, setHostChoice] = useState<HostChoice>("");
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverAltText, setCoverAltText] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    setCreating(true);
    setError(null);
    try {
      const startsAt = allDay
        ? pacificWallClockToUtc(`${startDate}T00:00`)
        : pacificWallClockToUtc(startLocal);
      const endsAt = !allDay && endLocal ? pacificWallClockToUtc(endLocal) : undefined;

      let hostType: EventHostType | undefined;
      let hostId: string | undefined;
      if (hostChoice.startsWith("group:")) {
        hostType = "group";
        hostId = hostChoice.slice("group:".length);
      } else if (hostChoice.startsWith("business:")) {
        hostType = "business";
        hostId = hostChoice.slice("business:".length);
      }

      const event = await createEventFn({
        data: {
          title: title.trim(),
          description: description.trim() || undefined,
          startsAt: startsAt.toISOString(),
          endsAt: endsAt?.toISOString(),
          allDay,
          location: location.trim() || undefined,
          hostType,
          hostId,
        },
      });
      if (coverFile) {
        await uploadImage(coverFile, "event_cover", {
          eventId: event.id,
          altText: coverAltText || undefined,
        });
      }
      await navigate({ to: "/calendar/$eventId", params: { eventId: event.id } });
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Couldn't create the event.");
      setCreating(false);
    }
  }

  const canCreate =
    title.trim().length > 0 && (allDay ? startDate.length > 0 : startLocal.length > 0) && !creating;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-4 p-6">
      <h1 className="text-xl font-semibold">Add an event</h1>

      <div className="flex flex-col gap-1">
        <label htmlFor="event-title" className="text-sm font-medium">
          Title
        </label>
        <input
          id="event-title"
          type="text"
          value={title}
          maxLength={150}
          placeholder="Block party"
          className="h-11 rounded-md border border-border bg-background px-3 text-sm text-foreground"
          onChange={(event) => {
            setTitle(event.target.value);
          }}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="event-description" className="text-sm font-medium">
          Description
        </label>
        <Textarea
          id="event-description"
          maxLength={2000}
          value={description}
          onChange={(event) => {
            setDescription(event.target.value);
          }}
        />
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={allDay}
          onChange={(event) => {
            setAllDay(event.target.checked);
          }}
        />
        All-day event
      </label>

      {allDay ? (
        <div className="flex flex-col gap-1">
          <label htmlFor="event-start-date" className="text-sm font-medium">
            Date
          </label>
          <input
            id="event-start-date"
            type="date"
            value={startDate}
            className="h-11 rounded-md border border-border bg-background px-3 text-sm text-foreground"
            onChange={(event) => {
              setStartDate(event.target.value);
            }}
          />
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-1">
            <label htmlFor="event-start" className="text-sm font-medium">
              Starts (Pacific time)
            </label>
            <input
              id="event-start"
              type="datetime-local"
              value={startLocal}
              className="h-11 rounded-md border border-border bg-background px-3 text-sm text-foreground"
              onChange={(event) => {
                setStartLocal(event.target.value);
              }}
            />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="event-end" className="text-sm font-medium">
              Ends (optional)
            </label>
            <input
              id="event-end"
              type="datetime-local"
              value={endLocal}
              className="h-11 rounded-md border border-border bg-background px-3 text-sm text-foreground"
              onChange={(event) => {
                setEndLocal(event.target.value);
              }}
            />
          </div>
        </>
      )}

      <div className="flex flex-col gap-1">
        <label htmlFor="event-location" className="text-sm font-medium">
          Location
        </label>
        <input
          id="event-location"
          type="text"
          value={location}
          maxLength={200}
          placeholder="Plumas Lake Elementary lot"
          className="h-11 rounded-md border border-border bg-background px-3 text-sm text-foreground"
          onChange={(event) => {
            setLocation(event.target.value);
          }}
        />
      </div>

      {myGroups.length > 0 || myBusinesses.length > 0 ? (
        <div className="flex flex-col gap-1">
          <label htmlFor="event-host" className="text-sm font-medium">
            Host (optional)
          </label>
          <select
            id="event-host"
            value={hostChoice}
            className="h-11 rounded-md border border-border bg-background px-3 text-sm text-foreground"
            onChange={(event) => {
              setHostChoice(event.target.value as HostChoice);
            }}
          >
            <option value="">No host - just me</option>
            {myGroups.map((group) => (
              <option key={group.id} value={`group:${group.id}`}>
                {group.name} (group)
              </option>
            ))}
            {myBusinesses.map((business) => (
              <option key={business.id} value={`business:${business.id}`}>
                {business.name} (business)
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium">Cover photo</span>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            setCoverFile(file ?? null);
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-fit"
          onClick={() => fileInputRef.current?.click()}
        >
          {coverFile ? coverFile.name : "Add a cover photo"}
        </Button>
        {coverFile ? (
          <input
            type="text"
            placeholder="Describe this image for screen readers (optional)"
            value={coverAltText}
            maxLength={300}
            className="h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground"
            onChange={(event) => {
              setCoverAltText(event.target.value);
            }}
          />
        ) : null}
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <Button type="button" disabled={!canCreate} onClick={() => void handleCreate()}>
        {creating ? "Creating..." : "Add event"}
      </Button>
    </main>
  );
}
