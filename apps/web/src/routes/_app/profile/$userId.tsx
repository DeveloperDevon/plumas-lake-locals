import { Card, CardContent, CardHeader, CardTitle } from "@plumas/ui";
import { createFileRoute, Link } from "@tanstack/react-router";
import { CircleUserRound } from "lucide-react";

import { getProfileById } from "../../../server/functions/profile";

export const Route = createFileRoute("/_app/profile/$userId")({
  loader: async ({ params }) => ({
    profile: await getProfileById({ data: { userId: params.userId } }),
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
  const { profile } = Route.useLoaderData();

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
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          {/* Placeholder avatar - the real one lands with task #16's media pipeline. */}
          <CircleUserRound className="h-16 w-16 text-muted-foreground" />
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
    </main>
  );
}
