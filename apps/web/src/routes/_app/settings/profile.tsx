import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Textarea,
} from "@plumas/ui";
import type { FieldVisibility } from "@plumas/validators";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";

import { getProfileById, updateMyProfile } from "../../../server/functions/profile";

export const Route = createFileRoute("/_app/settings/profile")({
  loader: async ({ context }) => ({
    profile: await getProfileById({ data: { userId: context.user.id } }),
  }),
  component: ProfileSettings,
});

const visibilityFields = [
  { key: "interests", label: "Interests" },
  { key: "occupation", label: "Occupation" },
  { key: "pets", label: "Pets" },
  { key: "website", label: "Website" },
  { key: "birthday", label: "Birthday" },
] as const;

function ProfileSettings() {
  const { profile } = Route.useLoaderData();
  const router = useRouter();
  const doUpdate = useServerFn(updateMyProfile);

  const [displayName, setDisplayName] = useState(profile?.displayName ?? "");
  const [bio, setBio] = useState(profile?.bio ?? "");
  const [street, setStreet] = useState(profile?.street ?? "");
  const [interests, setInterests] = useState((profile?.interests ?? []).join(", "));
  const [occupation, setOccupation] = useState(profile?.occupation ?? "");
  const [pets, setPets] = useState(profile?.pets ?? "");
  const [website, setWebsite] = useState(profile?.website ?? "");
  const [birthdayMonth, setBirthdayMonth] = useState(profile?.birthdayMonth?.toString() ?? "");
  const [birthdayDay, setBirthdayDay] = useState(profile?.birthdayDay?.toString() ?? "");
  const [visibility, setVisibility] = useState<FieldVisibility>(profile?.fieldVisibility ?? {});
  const [state, setState] = useState<
    { status: "idle" } | { status: "submitting" } | { status: "error"; message: string }
  >({ status: "idle" });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Profile</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            setState({ status: "submitting" });
            void doUpdate({
              data: {
                displayName,
                bio,
                street,
                interests: interests
                  .split(",")
                  .map((tag) => tag.trim())
                  .filter((tag) => tag.length > 0),
                occupation,
                pets,
                website,
                birthdayMonth: birthdayMonth ? Number(birthdayMonth) : null,
                birthdayDay: birthdayDay ? Number(birthdayDay) : null,
                fieldVisibility: visibility,
              },
            })
              .then(() => {
                setState({ status: "idle" });
                return router.invalidate();
              })
              .catch(() => {
                setState({ status: "error", message: "Could not save your profile." });
              });
          }}
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="display-name">Display name</Label>
            <Input
              id="display-name"
              required
              value={displayName}
              onChange={(event) => {
                setDisplayName(event.target.value);
              }}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="bio">Bio</Label>
            <Textarea
              id="bio"
              maxLength={500}
              value={bio}
              onChange={(event) => {
                setBio(event.target.value);
              }}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="street">Neighborhood / street</Label>
            <Input
              id="street"
              value={street}
              onChange={(event) => {
                setStreet(event.target.value);
              }}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="interests">Interests (comma-separated)</Label>
            <Input
              id="interests"
              value={interests}
              onChange={(event) => {
                setInterests(event.target.value);
              }}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="occupation">Occupation</Label>
            <Input
              id="occupation"
              value={occupation}
              onChange={(event) => {
                setOccupation(event.target.value);
              }}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="pets">Pets</Label>
            <Input
              id="pets"
              value={pets}
              onChange={(event) => {
                setPets(event.target.value);
              }}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="website">Website</Label>
            <Input
              id="website"
              value={website}
              onChange={(event) => {
                setWebsite(event.target.value);
              }}
            />
          </div>

          <div className="flex gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="birthday-month">Birthday month</Label>
              <select
                id="birthday-month"
                className="h-11 rounded-md border border-border bg-background px-3 text-base text-foreground"
                value={birthdayMonth}
                onChange={(event) => {
                  setBirthdayMonth(event.target.value);
                }}
              >
                <option value="">Not set</option>
                {Array.from({ length: 12 }, (_, i) => i + 1).map((month) => (
                  <option key={month} value={month}>
                    {new Date(2000, month - 1, 1).toLocaleDateString(undefined, { month: "long" })}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="birthday-day">Day</Label>
              <select
                id="birthday-day"
                className="h-11 rounded-md border border-border bg-background px-3 text-base text-foreground"
                value={birthdayDay}
                onChange={(event) => {
                  setBirthdayDay(event.target.value);
                }}
              >
                <option value="">Not set</option>
                {Array.from({ length: 31 }, (_, i) => i + 1).map((day) => (
                  <option key={day} value={day}>
                    {day}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">Who can see these?</p>
            {visibilityFields.map((field) => (
              <div key={field.key} className="flex items-center justify-between gap-2">
                <Label htmlFor={`visibility-${field.key}`}>{field.label} visibility</Label>
                <select
                  id={`visibility-${field.key}`}
                  className="h-11 rounded-md border border-border bg-background px-3 text-sm text-foreground"
                  value={visibility[field.key] ?? "all"}
                  onChange={(event) => {
                    setVisibility((previous) => ({
                      ...previous,
                      [field.key]: event.target.value as FieldVisibility[typeof field.key],
                    }));
                  }}
                >
                  <option value="all">All members</option>
                  <option value="connections">Connections only</option>
                </select>
              </div>
            ))}
          </div>

          {state.status === "error" ? (
            <p className="text-sm text-destructive">{state.message}</p>
          ) : null}
          <Button type="submit" disabled={state.status === "submitting"}>
            {state.status === "submitting" ? "Saving..." : "Save profile"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
