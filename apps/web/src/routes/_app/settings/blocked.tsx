import { Button, Card, CardContent, CardHeader, CardTitle } from "@plumas/ui";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";

import { mediaUrl } from "../../../lib/upload-image";
import { getMyBlockedUsersFn, unblockUserFn } from "../../../server/functions/blocks";

export const Route = createFileRoute("/_app/settings/blocked")({
  loader: async () => ({ blocked: await getMyBlockedUsersFn() }),
  component: BlockedMembers,
});

function BlockedMembers() {
  const initial = Route.useLoaderData();
  const doUnblock = useServerFn(unblockUserFn);

  const [blocked, setBlocked] = useState(initial.blocked);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function handleUnblock(userId: string) {
    setBusyId(userId);
    try {
      await doUnblock({ data: { userId } });
      setBlocked((previous) => previous.filter((row) => row.id !== userId));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Blocked members</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {blocked.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            You haven&apos;t blocked anyone. Blocking someone hides their content from you and yours
            from them.
          </p>
        ) : (
          blocked.map((member) => (
            <div key={member.id} className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                {member.avatarKey ? (
                  <img
                    src={mediaUrl(member.avatarKey, "thumbnail")}
                    alt=""
                    className="h-8 w-8 rounded-full object-cover"
                  />
                ) : (
                  <div className="h-8 w-8 rounded-full bg-muted" />
                )}
                <span className="text-sm font-medium">{member.displayName}</span>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busyId === member.id}
                onClick={() => void handleUnblock(member.id)}
              >
                Unblock
              </Button>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
