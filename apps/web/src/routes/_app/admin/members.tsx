import { Button } from "@plumas/ui";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";

import {
  getMembersForAdmin,
  suspendUserFn,
  unsuspendUserFn,
} from "../../../server/functions/moderation";

export const Route = createFileRoute("/_app/admin/members")({
  loader: async () => ({ members: await getMembersForAdmin() }),
  component: Members,
});

function Members() {
  const { members } = Route.useLoaderData();
  const router = useRouter();
  const doSuspend = useServerFn(suspendUserFn);
  const doUnsuspend = useServerFn(unsuspendUserFn);
  const [busyId, setBusyId] = useState<string | null>(null);

  function run(id: string, action: Promise<unknown>) {
    setBusyId(id);
    void action.finally(() => {
      setBusyId(null);
      void router.invalidate();
    });
  }

  return (
    <ul className="flex flex-col gap-2">
      {members.map((member) => (
        <li
          key={member.id}
          className="flex items-center justify-between gap-2 rounded-md border border-border p-3 text-sm"
        >
          <div>
            <p className="font-medium">
              {member.displayName}{" "}
              {member.role === "admin" ? (
                <span className="text-xs text-muted-foreground">· admin</span>
              ) : null}
              {member.status === "suspended" ? (
                <span className="text-xs text-destructive"> · suspended</span>
              ) : null}
            </p>
            <p className="text-muted-foreground">{member.email}</p>
            {member.inviterDisplayName ? (
              <p className="text-xs text-muted-foreground">
                Invited by {member.inviterDisplayName}
              </p>
            ) : null}
          </div>
          {member.role !== "admin" ? (
            <Button
              type="button"
              size="sm"
              variant={member.status === "suspended" ? "outline" : "destructive"}
              disabled={busyId === member.id}
              onClick={() => {
                const action =
                  member.status === "suspended"
                    ? doUnsuspend({ data: { userId: member.id } })
                    : doSuspend({ data: { userId: member.id } });
                run(member.id, action);
              }}
            >
              {member.status === "suspended" ? "Unsuspend" : "Suspend"}
            </Button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
