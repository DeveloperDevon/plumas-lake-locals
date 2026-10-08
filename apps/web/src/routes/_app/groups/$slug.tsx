import type { GroupMemberView, GroupView } from "@plumas/auth";
import { Button, Card, CardContent, CardHeader, CardTitle, Textarea } from "@plumas/ui";
import { createFileRoute, Link, notFound, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Users } from "lucide-react";
import { useRef, useState } from "react";

import { PostCard } from "../../../components/post-card";
import { mediaUrl, uploadImage } from "../../../lib/upload-image";
import {
  approveJoinRequestFn,
  createGroupPostFn,
  declineJoinRequestFn,
  getGroupBySlugFn,
  getGroupMembersFn,
  getGroupPostsFn,
  getPendingGroupInvitesFn,
  getPendingJoinRequestsFn,
  inviteMemberFn,
  leaveGroupFn,
  removeMemberFn,
  requestToJoinFn,
  searchInvitableMembersFn,
  transferGroupOwnershipFn,
  updateGroupFn,
  updateGroupVisibilityFn,
} from "../../../server/functions/groups";

export const Route = createFileRoute("/_app/groups/$slug")({
  loader: async ({ params }) => {
    const group = await getGroupBySlugFn({ data: { slug: params.slug } });
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack's own notFound().
    if (!group) throw notFound();

    const isActiveMember = group.myMembership?.status === "active";
    const isAdmin = group.myMembership?.role === "owner" || group.myMembership?.role === "admin";

    const [members, posts, pendingRequests, pendingInvites] = await Promise.all([
      getGroupMembersFn({ data: { groupId: group.id } }),
      isActiveMember
        ? getGroupPostsFn({ data: { groupId: group.id, limit: 20 } })
        : Promise.resolve(null),
      isAdmin ? getPendingJoinRequestsFn({ data: { groupId: group.id } }) : Promise.resolve([]),
      isAdmin ? getPendingGroupInvitesFn({ data: { groupId: group.id } }) : Promise.resolve([]),
    ]);

    return { group, members, posts, pendingRequests, pendingInvites };
  },
  component: GroupDetail,
  notFoundComponent: () => (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-2 p-6 text-center">
      <p className="text-lg font-medium">Group not found</p>
      <p className="text-sm text-muted-foreground">
        It may not exist, or it&apos;s private and you&apos;re not a member.
      </p>
      <Link to="/groups" className="text-sm font-medium text-primary hover:underline">
        Back to groups
      </Link>
    </main>
  ),
});

function GroupDetail() {
  const { user } = Route.useRouteContext();
  const { slug } = Route.useParams();
  const initial = Route.useLoaderData();
  const navigate = useNavigate();

  const doRequestToJoin = useServerFn(requestToJoinFn);
  const doLeaveGroup = useServerFn(leaveGroupFn);
  const doGetGroupPosts = useServerFn(getGroupPostsFn);
  const doCreateGroupPost = useServerFn(createGroupPostFn);
  const doApprove = useServerFn(approveJoinRequestFn);
  const doDecline = useServerFn(declineJoinRequestFn);
  const doRemoveMember = useServerFn(removeMemberFn);
  const doInviteMember = useServerFn(inviteMemberFn);
  const doSearchInvitable = useServerFn(searchInvitableMembersFn);
  const doUpdateGroup = useServerFn(updateGroupFn);
  const doUpdateVisibility = useServerFn(updateGroupVisibilityFn);
  const doTransferOwnership = useServerFn(transferGroupOwnershipFn);

  const [group, setGroup] = useState(initial.group);
  const [members, setMembers] = useState(initial.members);
  const [posts, setPosts] = useState(initial.posts?.items ?? []);
  const [nextCursor, setNextCursor] = useState(initial.posts?.nextCursor ?? null);
  const [pendingRequests, setPendingRequests] = useState(initial.pendingRequests);
  const pendingInvites = initial.pendingInvites;

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showInvite, setShowInvite] = useState(false);

  const isActiveMember = group.myMembership?.status === "active";
  const isRequested = group.myMembership?.status === "requested";
  const isAdmin = group.myMembership?.role === "owner" || group.myMembership?.role === "admin";
  const isOwner = group.myMembership?.role === "owner";

  async function refreshGroup() {
    const fresh = await getGroupBySlugFn({ data: { slug } });
    if (fresh) setGroup(fresh);
    const freshMembers = await getGroupMembersFn({ data: { groupId: group.id } });
    setMembers(freshMembers);
  }

  async function handleJoin() {
    setBusy(true);
    setError(null);
    try {
      await doRequestToJoin({ data: { groupId: group.id } });
      await refreshGroup();
    } catch (joinError) {
      setError(joinError instanceof Error ? joinError.message : "Couldn't request to join.");
    } finally {
      setBusy(false);
    }
  }

  async function handleLeave() {
    setBusy(true);
    setError(null);
    try {
      await doLeaveGroup({ data: { groupId: group.id } });
      await navigate({ to: "/groups" });
    } catch (leaveError) {
      setError(leaveError instanceof Error ? leaveError.message : "Couldn't leave this group.");
      setBusy(false);
    }
  }

  async function loadMorePosts() {
    if (!nextCursor) return;
    const page = await doGetGroupPosts({
      data: { groupId: group.id, cursor: nextCursor, limit: 20 },
    });
    setPosts((previous) => [...previous, ...page.items]);
    setNextCursor(page.nextCursor);
  }

  async function refreshPosts() {
    const page = await doGetGroupPosts({ data: { groupId: group.id, limit: 20 } });
    setPosts(page.items);
    setNextCursor(page.nextCursor);
  }

  async function respondToRequest(targetUserId: string, approve: boolean) {
    setBusy(true);
    try {
      if (approve) await doApprove({ data: { groupId: group.id, targetUserId } });
      else await doDecline({ data: { groupId: group.id, targetUserId } });
      setPendingRequests((previous) => previous.filter((row) => row.userId !== targetUserId));
      await refreshGroup();
    } finally {
      setBusy(false);
    }
  }

  async function handleRemoveMember(targetUserId: string) {
    setBusy(true);
    try {
      await doRemoveMember({ data: { groupId: group.id, targetUserId } });
      await refreshGroup();
    } finally {
      setBusy(false);
    }
  }

  if (!isActiveMember) {
    return (
      <main className="mx-auto flex min-h-screen max-w-xl flex-col gap-4 p-6">
        <GroupHeader group={group} members={members} isAdmin={false} />
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {isRequested ? (
          <p className="text-sm text-muted-foreground">Your request to join is pending.</p>
        ) : (
          <Button type="button" disabled={busy} onClick={() => void handleJoin()}>
            {busy ? "Requesting..." : "Request to join"}
          </Button>
        )}
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col gap-4 p-6">
      <GroupHeader group={group} members={members} isAdmin={isAdmin} />

      <div className="flex flex-wrap gap-2">
        {isAdmin ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setShowSettings((v) => !v);
            }}
          >
            Settings
          </Button>
        ) : null}
        {isAdmin ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setShowInvite((v) => !v);
            }}
          >
            Invite
          </Button>
        ) : null}
        {!isOwner ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => void handleLeave()}
          >
            Leave group
          </Button>
        ) : null}
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {isAdmin && showInvite ? (
        <InvitePanel
          groupId={group.id}
          onSearch={(query) => doSearchInvitable({ data: { groupId: group.id, query } })}
          onInvite={async (targetUserId) => {
            await doInviteMember({ data: { groupId: group.id, targetUserId } });
          }}
        />
      ) : null}

      {isAdmin && pendingRequests.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Join requests</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {pendingRequests.map((row) => (
              <div key={row.userId} className="flex items-center justify-between gap-2">
                <span className="text-sm">{row.displayName}</span>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    disabled={busy}
                    onClick={() => void respondToRequest(row.userId, true)}
                  >
                    Approve
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => void respondToRequest(row.userId, false)}
                  >
                    Decline
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {isAdmin && pendingInvites.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Pending invites</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1">
            {pendingInvites.map((row) => (
              <p key={row.userId} className="text-sm text-muted-foreground">
                {row.displayName}
              </p>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {isAdmin && showSettings ? (
        <SettingsPanel
          group={group}
          members={members}
          isOwner={isOwner}
          onSave={async (input) => {
            await doUpdateGroup({ data: { groupId: group.id, ...input } });
            await refreshGroup();
          }}
          onVisibilityChange={async (visibility) => {
            await doUpdateVisibility({ data: { groupId: group.id, visibility } });
            await refreshGroup();
          }}
          onRemoveMember={handleRemoveMember}
          onTransferOwnership={async (newOwnerId) => {
            await doTransferOwnership({ data: { groupId: group.id, newOwnerId } });
            await navigate({ to: "/groups/$slug", params: { slug } });
          }}
        />
      ) : null}

      <ComposeBox
        onSubmit={async (body, category, files) => {
          const post = await doCreateGroupPost({ data: { groupId: group.id, body, category } });
          for (const file of files) {
            await uploadImage(file, "post", { postId: post.id });
          }
          await refreshPosts();
        }}
      />

      <div className="flex flex-col gap-3">
        {posts.map((post) => (
          <PostCard
            key={post.id}
            post={post}
            currentUserId={user.id}
            isAdmin={user.role === "admin"}
            onChanged={refreshPosts}
          />
        ))}
        {posts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No posts yet in this group.</p>
        ) : null}
        {nextCursor ? (
          <Button type="button" variant="outline" onClick={() => void loadMorePosts()}>
            Load more
          </Button>
        ) : null}
      </div>
    </main>
  );
}

function GroupHeader({
  group,
  members,
  isAdmin,
}: {
  group: GroupView;
  members: GroupMemberView[];
  isAdmin: boolean;
}) {
  const admins = members.filter((member) => member.role === "owner" || member.role === "admin");
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 pt-6">
        {group.coverKey ? (
          <img
            src={mediaUrl(group.coverKey, "medium")}
            alt=""
            className="h-40 w-full rounded-md object-cover"
          />
        ) : (
          <div className="flex h-40 w-full items-center justify-center rounded-md bg-muted">
            <Users className="h-10 w-10 text-muted-foreground" />
          </div>
        )}
        <div>
          <h1 className="text-xl font-semibold">{group.name}</h1>
          {group.category ? (
            <p className="text-xs text-muted-foreground">{group.category}</p>
          ) : null}
        </div>
        {group.description ? <p className="text-sm">{group.description}</p> : null}
        <p className="text-xs text-muted-foreground">
          {group.memberCount} members · {group.visibility === "private" ? "Private" : "Public"}
          {isAdmin ? " · You're an admin" : null}
        </p>
        {admins.length > 0 ? (
          <p className="text-xs text-muted-foreground">
            Admins: {admins.map((admin) => admin.displayName).join(", ")}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ComposeBox({
  onSubmit,
}: {
  onSubmit: (body: string, category: undefined, files: File[]) => Promise<void>;
}) {
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 pt-6">
        <Textarea
          maxLength={5000}
          placeholder="Post something to this group..."
          value={body}
          onChange={(event) => {
            setBody(event.target.value);
          }}
        />
        <div className="flex items-center gap-3">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
            multiple
            className="hidden"
            onChange={(event) => {
              const selected = Array.from(event.target.files ?? []).slice(0, 10);
              event.target.value = "";
              setFiles(selected);
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
          >
            {files.length > 0 ? `${files.length.toString()} image(s) selected` : "Add images"}
          </Button>
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <Button
          type="button"
          disabled={!body.trim() || posting}
          onClick={() => {
            setPosting(true);
            setError(null);
            void onSubmit(body, undefined, files)
              .then(() => {
                setBody("");
                setFiles([]);
              })
              .catch((postError: unknown) => {
                setError(postError instanceof Error ? postError.message : "Couldn't post.");
              })
              .finally(() => {
                setPosting(false);
              });
          }}
        >
          {posting ? "Posting..." : "Post"}
        </Button>
      </CardContent>
    </Card>
  );
}

function InvitePanel({
  onSearch,
  onInvite,
}: {
  groupId: string;
  onSearch: (
    query: string,
  ) => Promise<{ id: string; displayName: string; avatarKey: string | null }[]>;
  onInvite: (targetUserId: string) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<
    { id: string; displayName: string; avatarKey: string | null }[]
  >([]);
  const [invited, setInvited] = useState<Set<string>>(new Set());

  return (
    <Card>
      <CardHeader>
        <CardTitle>Invite a member</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <input
          type="text"
          placeholder="Search members by name..."
          value={query}
          className="h-10 rounded-md border border-border bg-background px-3 text-sm text-foreground"
          onChange={(event) => {
            const value = event.target.value;
            setQuery(value);
            void onSearch(value).then(setResults);
          }}
        />
        {results.map((result) => (
          <div key={result.id} className="flex items-center justify-between gap-2">
            <span className="text-sm">{result.displayName}</span>
            <Button
              type="button"
              size="sm"
              disabled={invited.has(result.id)}
              onClick={() => {
                void onInvite(result.id).then(() => {
                  setInvited((previous) => new Set(previous).add(result.id));
                });
              }}
            >
              {invited.has(result.id) ? "Invited" : "Invite"}
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function SettingsPanel({
  group,
  members,
  isOwner,
  onSave,
  onVisibilityChange,
  onRemoveMember,
  onTransferOwnership,
}: {
  group: GroupView;
  members: GroupMemberView[];
  isOwner: boolean;
  onSave: (input: {
    name: string;
    description?: string | undefined;
    category?: string | undefined;
  }) => Promise<void>;
  onVisibilityChange: (visibility: "public" | "private") => Promise<void>;
  onRemoveMember: (targetUserId: string) => Promise<void>;
  onTransferOwnership: (newOwnerId: string) => Promise<void>;
}) {
  const [name, setName] = useState(group.name);
  const [description, setDescription] = useState(group.description ?? "");
  const [category, setCategory] = useState(group.category ?? "");
  const [saving, setSaving] = useState(false);
  const [confirmingVisibility, setConfirmingVisibility] = useState(false);
  const [transferTarget, setTransferTarget] = useState("");

  const otherActiveMembers = members.filter((member) => member.role !== "owner");

  return (
    <Card>
      <CardHeader>
        <CardTitle>Group settings</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <input
          type="text"
          value={name}
          maxLength={100}
          className="h-10 rounded-md border border-border bg-background px-3 text-sm text-foreground"
          onChange={(event) => {
            setName(event.target.value);
          }}
        />
        <Textarea
          maxLength={2000}
          value={description}
          onChange={(event) => {
            setDescription(event.target.value);
          }}
        />
        <input
          type="text"
          value={category}
          maxLength={50}
          className="h-10 rounded-md border border-border bg-background px-3 text-sm text-foreground"
          onChange={(event) => {
            setCategory(event.target.value);
          }}
        />
        <Button
          type="button"
          size="sm"
          disabled={saving || !name.trim()}
          onClick={() => {
            setSaving(true);
            void onSave({
              name: name.trim(),
              description: description.trim() || undefined,
              category: category.trim() || undefined,
            }).finally(() => {
              setSaving(false);
            });
          }}
        >
          Save
        </Button>

        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <p className="text-sm font-medium">
            Visibility: {group.visibility === "private" ? "Private" : "Public"}
          </p>
          {confirmingVisibility ? (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-muted-foreground">
                {group.visibility === "public"
                  ? "Switching to private hides this group from the directory, search and profiles. Only invited members can join."
                  : "Switching to public lists this group in the directory and opens it to join requests."}
              </p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  onClick={() => {
                    void onVisibilityChange(
                      group.visibility === "public" ? "private" : "public",
                    ).then(() => {
                      setConfirmingVisibility(false);
                    });
                  }}
                >
                  Confirm
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setConfirmingVisibility(false);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-fit"
              onClick={() => {
                setConfirmingVisibility(true);
              }}
            >
              Switch to {group.visibility === "public" ? "private" : "public"}
            </Button>
          )}
        </div>

        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <p className="text-sm font-medium">Members</p>
          {otherActiveMembers.map((member) => (
            <div key={member.userId} className="flex items-center justify-between gap-2">
              <span className="text-sm">
                {member.displayName} ({member.role})
              </span>
              <button
                type="button"
                className="text-xs text-muted-foreground hover:text-destructive"
                onClick={() => void onRemoveMember(member.userId)}
              >
                Remove
              </button>
            </div>
          ))}
        </div>

        {isOwner ? (
          <div className="flex flex-col gap-2 border-t border-border pt-3">
            <p className="text-sm font-medium">Transfer ownership</p>
            <select
              value={transferTarget}
              className="h-10 rounded-md border border-border bg-background px-3 text-sm text-foreground"
              onChange={(event) => {
                setTransferTarget(event.target.value);
              }}
            >
              <option value="">Select a member...</option>
              {otherActiveMembers.map((member) => (
                <option key={member.userId} value={member.userId}>
                  {member.displayName}
                </option>
              ))}
            </select>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-fit"
              disabled={!transferTarget}
              onClick={() => void onTransferOwnership(transferTarget)}
            >
              Transfer ownership
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
