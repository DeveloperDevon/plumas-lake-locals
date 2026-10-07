import { Button, Card, CardContent, CardHeader, CardTitle } from "@plumas/ui";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { CircleUserRound } from "lucide-react";
import { useRef, useState } from "react";

import { mediaUrl, uploadImage } from "../../../lib/upload-image";
import { getUserMedia } from "../../../server/functions/media";
import { getProfileById } from "../../../server/functions/profile";

export const Route = createFileRoute("/_app/profile/$userId")({
  loader: async ({ params }) => ({
    profile: await getProfileById({ data: { userId: params.userId } }),
    media: await getUserMedia({ data: { userId: params.userId } }),
  }),
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
  const { profile, media } = Route.useLoaderData();
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
