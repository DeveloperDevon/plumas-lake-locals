import { Button, Card, CardContent, CardHeader, CardTitle } from "@plumas/ui";
import type { NotificationType } from "@plumas/validators";
import { notificationTypes } from "@plumas/validators";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";

import {
  getNotificationEmailPreferencesFn,
  setNotificationEmailPreferencesFn,
} from "../../../server/functions/notifications";

export const Route = createFileRoute("/_app/settings/notifications")({
  loader: async () => ({ preferences: await getNotificationEmailPreferencesFn() }),
  component: NotificationSettings,
});

/** FR-NOT-02: same events apps/web/src/routes/_app/notifications.tsx's describeNotification covers, worded as a toggle label rather than a past-tense event. */
const notificationLabels: Record<NotificationType, string> = {
  comment_on_post: "Comments on your posts",
  reply_to_comment: "Replies to your comments",
  reaction_on_post: "Reactions on your posts",
  relationship_request: "Relationship requests",
  group_join_approved: "Group join request approved",
  group_join_declined: "Group join request declined",
  invite_accepted: "Someone accepts your invite",
  comment_on_event: "Comments on your events",
  comment_on_listing: "Comments on your listings",
  dm_message: "New direct messages",
  dm_added_to_group: "Added to a group chat",
};

function NotificationSettings() {
  const initial = Route.useLoaderData();
  const doSetPreferences = useServerFn(setNotificationEmailPreferencesFn);

  const [preferences, setPreferences] = useState(initial.preferences);
  const [saving, setSaving] = useState<NotificationType | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggle(type: NotificationType) {
    const next = { ...preferences, [type]: preferences[type] === false };
    setPreferences(next);
    setSaving(type);
    setError(null);
    try {
      await doSetPreferences({ data: next });
    } catch (toggleError) {
      setPreferences(preferences);
      setError(toggleError instanceof Error ? toggleError.message : "Couldn't save that change.");
    } finally {
      setSaving(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Email notifications</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          On by default - turn off the ones you&apos;d rather only see in-app.
        </p>
        {notificationTypes.map((type) => {
          const enabled = preferences[type] !== false;
          return (
            <div key={type} className="flex items-center justify-between gap-3">
              <span className="text-sm">{notificationLabels[type]}</span>
              <Button
                type="button"
                size="sm"
                variant={enabled ? "default" : "outline"}
                disabled={saving === type}
                onClick={() => void toggle(type)}
              >
                {enabled ? "On" : "Off"}
              </Button>
            </div>
          );
        })}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </CardContent>
    </Card>
  );
}
