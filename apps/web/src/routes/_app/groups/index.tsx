import { Button, Card, CardContent, CardHeader, CardTitle } from "@plumas/ui";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Users } from "lucide-react";
import { useState } from "react";

import { mediaUrl } from "../../../lib/upload-image";
import {
  acceptGroupInviteFn,
  declineGroupInviteFn,
  getGroupsFn,
  getMyGroupInvitesFn,
  getMyGroupsFn,
} from "../../../server/functions/groups";

export const Route = createFileRoute("/_app/groups/")({
  loader: async () => {
    const [directory, myGroups, invites] = await Promise.all([
      getGroupsFn({ data: { limit: 20 } }),
      getMyGroupsFn(),
      getMyGroupInvitesFn(),
    ]);
    return { directory, myGroups, invites };
  },
  component: GroupsDirectory,
});

function GroupCoverIcon({ coverKey }: { coverKey: string | null }) {
  if (coverKey) {
    return (
      <img
        src={mediaUrl(coverKey, "thumbnail")}
        alt=""
        className="h-12 w-12 rounded-md object-cover"
      />
    );
  }
  return (
    <div className="flex h-12 w-12 items-center justify-center rounded-md bg-muted">
      <Users className="h-6 w-6 text-muted-foreground" />
    </div>
  );
}

function GroupsDirectory() {
  const { directory, myGroups, invites } = Route.useLoaderData();
  const doGetGroups = useServerFn(getGroupsFn);
  const doAcceptInvite = useServerFn(acceptGroupInviteFn);
  const doDeclineInvite = useServerFn(declineGroupInviteFn);

  const [items, setItems] = useState(directory.items);
  const [nextCursor, setNextCursor] = useState(directory.nextCursor);
  const [myInvites, setMyInvites] = useState(invites);
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  async function runSearch(value: string) {
    setSearch(value);
    const page = await doGetGroups({ data: { search: value || undefined, limit: 20 } });
    setItems(page.items);
    setNextCursor(page.nextCursor);
  }

  async function loadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const page = await doGetGroups({
        data: { search: search || undefined, cursor: nextCursor, limit: 20 },
      });
      setItems((previous) => [...previous, ...page.items]);
      setNextCursor(page.nextCursor);
    } finally {
      setLoadingMore(false);
    }
  }

  async function respondToInvite(groupId: string, accept: boolean) {
    setBusyId(groupId);
    try {
      if (accept) await doAcceptInvite({ data: { groupId } });
      else await doDeclineInvite({ data: { groupId } });
      setMyInvites((previous) => previous.filter((invite) => invite.groupId !== groupId));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Groups</h1>
        <Link to="/groups/new" className="text-sm font-medium text-primary hover:underline">
          Create group
        </Link>
      </div>

      {myInvites.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Invites</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {myInvites.map((invite) => (
              <div key={invite.groupId} className="flex items-center justify-between gap-2">
                <span className="text-sm">{invite.groupName}</span>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    disabled={busyId === invite.groupId}
                    onClick={() => void respondToInvite(invite.groupId, true)}
                  >
                    Accept
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busyId === invite.groupId}
                    onClick={() => void respondToInvite(invite.groupId, false)}
                  >
                    Decline
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {myGroups.length > 0 ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-semibold text-muted-foreground">My groups</p>
          <div className="flex flex-col gap-2">
            {myGroups.map((group) => (
              <Link
                key={group.id}
                to="/groups/$slug"
                params={{ slug: group.slug }}
                className="flex items-center gap-3 rounded-md border border-border p-3 hover:bg-muted"
              >
                <GroupCoverIcon coverKey={group.coverKey} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{group.name}</p>
                  <p className="text-xs text-muted-foreground">{group.memberCount} members</p>
                </div>
              </Link>
            ))}
          </div>
        </div>
      ) : null}

      <div className="flex flex-col gap-3">
        <input
          type="text"
          placeholder="Search groups..."
          value={search}
          className="h-11 rounded-md border border-border bg-background px-3 text-sm text-foreground"
          onChange={(event) => void runSearch(event.target.value)}
        />
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No groups found.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {items.map((group) => (
              <Link
                key={group.id}
                to="/groups/$slug"
                params={{ slug: group.slug }}
                className="flex items-center gap-3 rounded-md border border-border p-3 hover:bg-muted"
              >
                <GroupCoverIcon coverKey={group.coverKey} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{group.name}</p>
                  {group.description ? (
                    <p className="truncate text-xs text-muted-foreground">{group.description}</p>
                  ) : null}
                  <p className="text-xs text-muted-foreground">{group.memberCount} members</p>
                </div>
              </Link>
            ))}
          </div>
        )}
        {nextCursor ? (
          <Button
            type="button"
            variant="outline"
            disabled={loadingMore}
            onClick={() => void loadMore()}
          >
            {loadingMore ? "Loading..." : "Load more"}
          </Button>
        ) : null}
      </div>
    </main>
  );
}
