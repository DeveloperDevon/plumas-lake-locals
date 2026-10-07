import { Button, Card, CardContent, CardHeader, CardTitle } from "@plumas/ui";
import type { RelationshipType } from "@plumas/validators";
import { relationshipLabel, relationshipTypes } from "@plumas/validators";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { CircleUserRound } from "lucide-react";
import { useRef, useState } from "react";

import { mediaUrl, uploadImage } from "../../../lib/upload-image";
import { getUserMedia } from "../../../server/functions/media";
import { getProfileById } from "../../../server/functions/profile";
import {
  acceptRelationshipFn,
  getMyPendingRequests,
  getRelationshipsForProfile,
  getRelationshipStatus,
  removeRelationshipFn,
  requestRelationshipFn,
} from "../../../server/functions/relationships";

export const Route = createFileRoute("/_app/profile/$userId")({
  loader: async ({ params }) => {
    const profile = await getProfileById({ data: { userId: params.userId } });
    const [media, relationships, status, pending] = await Promise.all([
      getUserMedia({ data: { userId: params.userId } }),
      getRelationshipsForProfile({ data: { userId: params.userId } }),
      profile && !profile.isOwner
        ? getRelationshipStatus({ data: { otherUserId: params.userId } })
        : Promise.resolve(null),
      profile?.isOwner ? getMyPendingRequests() : Promise.resolve({ incoming: [], outgoing: [] }),
    ]);
    return { profile, media, relationships, status, pending };
  },
  component: ProfileView,
});

function formatBirthday(month: number | null, day: number | null): string | null {
  if (!month || !day) return null;
  // Year is arbitrary and never stored - only used to format month/day with Intl.
  return new Date(2000, month - 1, day).toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
  });
}

function ProfileView() {
  const { profile, media, relationships, status, pending } = Route.useLoaderData();
  const { userId } = Route.useParams();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploadState, setUploadState] = useState<
    { kind: "idle" } | { kind: "uploading" } | { kind: "error"; message: string }
  >({ kind: "idle" });

  if (!profile) {
    return (
      <main className="mx-auto flex min-h-screen max-w-xl flex-col gap-6 p-6">
        <p className="text-muted-foreground">This member couldn&apos;t be found.</p>
      </main>
    );
  }

  const birthday = formatBirthday(profile.birthdayMonth, profile.birthdayDay);

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col gap-6 p-6">
      {profile.coverKey ? (
        <img
          src={mediaUrl(profile.coverKey, "medium")}
          alt=""
          className="h-40 w-full rounded-md object-cover"
        />
      ) : null}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          {profile.avatarKey ? (
            <img
              src={mediaUrl(profile.avatarKey, "thumbnail")}
              alt=""
              className="h-16 w-16 rounded-full object-cover"
            />
          ) : (
            <CircleUserRound className="h-16 w-16 text-muted-foreground" />
          )}
          <div>
            <h1 className="text-2xl font-semibold">{profile.displayName}</h1>
            <p className="text-sm text-muted-foreground">
              Joined {profile.joinedAt.toLocaleDateString()}
              {profile.inviterDisplayName ? ` · Invited by ${profile.inviterDisplayName}` : null}
            </p>
          </div>
        </div>
        {profile.isOwner ? (
          <Link
            to="/settings/profile"
            className="text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            Edit profile
          </Link>
        ) : null}
      </div>

      {!profile.isOwner ? (
        <RelationshipWidget
          otherUserId={userId}
          otherDisplayName={profile.displayName}
          status={status}
          onChanged={() => {
            void router.invalidate();
          }}
        />
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>About</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          {profile.bio ? <p>{profile.bio}</p> : null}
          {profile.street ? <p className="text-muted-foreground">{profile.street}</p> : null}
          {profile.interests && profile.interests.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {profile.interests.map((interest) => (
                <span
                  key={interest}
                  className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground"
                >
                  {interest}
                </span>
              ))}
            </div>
          ) : null}
          {profile.occupation ? <p>{profile.occupation}</p> : null}
          {profile.pets ? <p>Pets: {profile.pets}</p> : null}
          {profile.website ? (
            <a
              href={
                profile.website.startsWith("http") ? profile.website : `https://${profile.website}`
              }
              target="_blank"
              rel="noreferrer"
              className="text-primary underline-offset-4 hover:underline"
            >
              {profile.website}
            </a>
          ) : null}
          {birthday ? <p className="text-muted-foreground">Birthday: {birthday}</p> : null}
          {!profile.bio &&
          !profile.street &&
          !profile.occupation &&
          !profile.pets &&
          !profile.website &&
          !birthday &&
          (!profile.interests || profile.interests.length === 0) ? (
            <p className="text-muted-foreground">
              {profile.isOwner
                ? "You haven't added anything to your profile yet."
                : "Nothing to show here yet."}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <FamilyCard
        relationships={relationships}
        pending={pending}
        isOwner={profile.isOwner}
        onChanged={() => {
          void router.invalidate();
        }}
      />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Photos</CardTitle>
          {profile.isOwner ? (
            <>
              <input
                ref={inputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (!file) return;
                  setUploadState({ kind: "uploading" });
                  void uploadImage(file, "gallery")
                    .then(() => {
                      setUploadState({ kind: "idle" });
                      return router.invalidate();
                    })
                    .catch((error: unknown) => {
                      setUploadState({
                        kind: "error",
                        message: error instanceof Error ? error.message : "Upload failed.",
                      });
                    });
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={uploadState.kind === "uploading"}
                onClick={() => {
                  inputRef.current?.click();
                }}
              >
                {uploadState.kind === "uploading" ? "Uploading..." : "Add photo"}
              </Button>
            </>
          ) : null}
        </CardHeader>
        <CardContent>
          {uploadState.kind === "error" ? (
            <p className="mb-3 text-sm text-destructive">{uploadState.message}</p>
          ) : null}
          {media.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {profile.isOwner ? "You haven't added any photos yet." : "No photos yet."}
            </p>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {media.map((item) => (
                <img
                  key={item.id}
                  src={mediaUrl(item.r2Key, "thumbnail")}
                  alt=""
                  className="aspect-square w-full rounded-md object-cover"
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}

interface RelationshipRow {
  id: string;
  otherUserId: string;
  otherDisplayName: string;
  label: string;
}

/** Shown on someone else's profile - the one action point to request/accept/decline/cancel. */
function RelationshipWidget({
  otherUserId,
  otherDisplayName,
  status,
  onChanged,
}: {
  otherUserId: string;
  otherDisplayName: string;
  status: { id: string; fromUser: string; toUser: string; status: string } | null;
  onChanged: () => void;
}) {
  const { user: currentUser } = Route.useRouteContext();
  const doRequest = useServerFn(requestRelationshipFn);
  const doAccept = useServerFn(acceptRelationshipFn);
  const doRemove = useServerFn(removeRelationshipFn);

  const [type, setType] = useState<RelationshipType>("friend");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function run(action: Promise<unknown>) {
    setBusy(true);
    setError(null);
    action
      .then(onChanged)
      .catch((actionError: unknown) => {
        setError(actionError instanceof Error ? actionError.message : "Something went wrong.");
      })
      .finally(() => {
        setBusy(false);
      });
  }

  if (!status) {
    return (
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 pt-6">
          <span className="text-sm text-muted-foreground">I am their</span>
          <select
            className="h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground"
            value={type}
            onChange={(event) => {
              setType(event.target.value as RelationshipType);
            }}
          >
            {relationshipTypes.map((value) => (
              <option key={value} value={value}>
                {relationshipLabel(value, "neutral")}
              </option>
            ))}
          </select>
          <Button
            type="button"
            size="sm"
            disabled={busy}
            onClick={() => {
              run(doRequest({ data: { toUserId: otherUserId, type } }));
            }}
          >
            Add family connection
          </Button>
          {error ? <p className="w-full text-sm text-destructive">{error}</p> : null}
        </CardContent>
      </Card>
    );
  }

  if (status.status === "accepted") return null;

  const iAmRequester = status.fromUser === currentUser.id;

  return (
    <Card>
      <CardContent className="flex flex-wrap items-center gap-3 pt-6">
        {iAmRequester ? (
          <>
            <span className="text-sm text-muted-foreground">Request pending</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => {
                run(doRemove({ data: { relationshipId: status.id } }));
              }}
            >
              Cancel
            </Button>
          </>
        ) : (
          <>
            <span className="text-sm text-muted-foreground">
              {otherDisplayName} wants to add you as their family
            </span>
            <Button
              type="button"
              size="sm"
              disabled={busy}
              onClick={() => {
                run(doAccept({ data: { relationshipId: status.id } }));
              }}
            >
              Accept
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => {
                run(doRemove({ data: { relationshipId: status.id } }));
              }}
            >
              Decline
            </Button>
          </>
        )}
        {error ? <p className="w-full text-sm text-destructive">{error}</p> : null}
      </CardContent>
    </Card>
  );
}

function FamilyCard({
  relationships,
  pending,
  isOwner,
  onChanged,
}: {
  relationships: RelationshipRow[];
  pending: {
    incoming: RelationshipRow[];
    outgoing: { id: string; otherUserId: string; otherDisplayName: string; myLabel: string }[];
  };
  isOwner: boolean;
  onChanged: () => void;
}) {
  const doAccept = useServerFn(acceptRelationshipFn);
  const doRemove = useServerFn(removeRelationshipFn);
  const [busyId, setBusyId] = useState<string | null>(null);

  function run(id: string, action: Promise<unknown>) {
    setBusyId(id);
    void action.finally(() => {
      setBusyId(null);
      onChanged();
    });
  }

  const hasAnything =
    relationships.length > 0 || pending.incoming.length > 0 || pending.outgoing.length > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Family</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 text-sm">
        {relationships.length > 0 ? (
          <div className="flex flex-col gap-2">
            {relationships.map((row) => (
              <div key={row.id} className="flex items-center justify-between gap-2">
                <Link
                  to="/profile/$userId"
                  params={{ userId: row.otherUserId }}
                  className="hover:underline"
                >
                  {row.otherDisplayName} — {row.label}
                </Link>
                {isOwner ? (
                  <button
                    type="button"
                    disabled={busyId === row.id}
                    className="text-xs text-muted-foreground hover:text-destructive"
                    onClick={() => {
                      run(row.id, doRemove({ data: { relationshipId: row.id } }));
                    }}
                  >
                    Remove
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}

        {isOwner && pending.incoming.length > 0 ? (
          <div className="flex flex-col gap-2 border-t border-border pt-3">
            <p className="text-xs font-medium text-muted-foreground">Pending requests</p>
            {pending.incoming.map((row) => (
              <div key={row.id} className="flex items-center justify-between gap-2">
                <span>
                  {row.otherDisplayName} wants to be your {row.label}
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={busyId === row.id}
                    className="text-xs text-primary hover:underline"
                    onClick={() => {
                      run(row.id, doAccept({ data: { relationshipId: row.id } }));
                    }}
                  >
                    Accept
                  </button>
                  <button
                    type="button"
                    disabled={busyId === row.id}
                    className="text-xs text-muted-foreground hover:text-destructive"
                    onClick={() => {
                      run(row.id, doRemove({ data: { relationshipId: row.id } }));
                    }}
                  >
                    Decline
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {isOwner && pending.outgoing.length > 0 ? (
          <div className="flex flex-col gap-2 border-t border-border pt-3">
            <p className="text-xs font-medium text-muted-foreground">Sent requests</p>
            {pending.outgoing.map((row) => (
              <div key={row.id} className="flex items-center justify-between gap-2">
                <span>
                  You&apos;ll be {row.otherDisplayName}&apos;s {row.myLabel}
                </span>
                <button
                  type="button"
                  disabled={busyId === row.id}
                  className="text-xs text-muted-foreground hover:text-destructive"
                  onClick={() => {
                    run(row.id, doRemove({ data: { relationshipId: row.id } }));
                  }}
                >
                  Cancel
                </button>
              </div>
            ))}
          </div>
        ) : null}

        {!hasAnything ? (
          <p className="text-muted-foreground">
            {isOwner ? "No family connections yet." : "No family connections yet."}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
