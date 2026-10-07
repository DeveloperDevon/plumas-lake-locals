import { Button, Card, CardContent, CardHeader, CardTitle, Textarea } from "@plumas/ui";
import type { PostCategory } from "@plumas/validators";
import { postCategories } from "@plumas/validators";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { CircleUserRound, Pencil, Pin, PinOff, Trash2 } from "lucide-react";
import { useRef, useState } from "react";

import { mediaUrl, uploadImage } from "../../lib/upload-image";
import {
  createPostFn,
  deletePostFn,
  getFeed,
  pinPostFn,
  unpinPostFn,
  updatePostFn,
} from "../../server/functions/posts";

export const Route = createFileRoute("/_app/feed")({
  loader: async () => getFeed({ data: { limit: 20 } }),
  component: Feed,
});

const categoryLabels: Record<PostCategory, string> = {
  general: "General",
  lost_found: "Lost & Found",
  safety: "Safety",
  recommendations: "Recommendations",
};

interface FeedPostData {
  id: string;
  body: string;
  category: PostCategory | null;
  pinnedAt: Date | null;
  createdAt: Date;
  editedAt: Date | null;
  authorId: string;
  authorDisplayName: string;
  authorAvatarKey: string | null;
  media: { id: string; r2Key: string; width: number; height: number }[];
}

function Feed() {
  const { user } = Route.useRouteContext();
  const initial = Route.useLoaderData();

  const doGetFeed = useServerFn(getFeed);
  const doCreatePost = useServerFn(createPostFn);

  const [pinned, setPinned] = useState<FeedPostData[]>(initial.pinned);
  const [items, setItems] = useState<FeedPostData[]>(initial.items);
  const [nextCursor, setNextCursor] = useState(initial.nextCursor);
  const [loadingMore, setLoadingMore] = useState(false);

  const [body, setBody] = useState("");
  const [category, setCategory] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [posting, setPosting] = useState(false);
  const [composeError, setComposeError] = useState<string | null>(null);

  async function refreshFromTop() {
    const page = await doGetFeed({ data: { limit: 20 } });
    setPinned(page.pinned);
    setItems(page.items);
    setNextCursor(page.nextCursor);
  }

  async function handlePost() {
    if (!body.trim()) return;
    setPosting(true);
    setComposeError(null);
    try {
      const post = await doCreatePost({
        data: { body, category: (category || undefined) as PostCategory | undefined },
      });
      for (const file of files) {
        // Deliberately sequential - attaches to the post one image at a time.
        await uploadImage(file, "post", post.id);
      }
      setBody("");
      setCategory("");
      setFiles([]);
      await refreshFromTop();
    } catch (error) {
      setComposeError(error instanceof Error ? error.message : "Could not create post.");
    } finally {
      setPosting(false);
    }
  }

  async function loadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const page = await doGetFeed({ data: { cursor: nextCursor, limit: 20 } });
      setItems((previous) => [...previous, ...page.items]);
      setNextCursor(page.nextCursor);
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col gap-6 p-6">
      <Card>
        <CardHeader>
          <CardTitle>Share something</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Textarea
            maxLength={5000}
            placeholder="What's going on in the neighborhood?"
            value={body}
            onChange={(event) => {
              setBody(event.target.value);
            }}
          />
          <div className="flex flex-wrap items-center gap-3">
            <select
              className="h-11 rounded-md border border-border bg-background px-3 text-sm text-foreground"
              value={category}
              onChange={(event) => {
                setCategory(event.target.value);
              }}
            >
              <option value="">No category</option>
              {postCategories.map((value) => (
                <option key={value} value={value}>
                  {categoryLabels[value]}
                </option>
              ))}
            </select>
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
              onClick={() => {
                fileInputRef.current?.click();
              }}
            >
              {files.length > 0 ? `${files.length.toString()} image(s) selected` : "Add images"}
            </Button>
          </div>
          {composeError ? <p className="text-sm text-destructive">{composeError}</p> : null}
          <Button
            type="button"
            disabled={!body.trim() || posting}
            onClick={() => {
              void handlePost();
            }}
          >
            {posting ? "Posting..." : "Post"}
          </Button>
        </CardContent>
      </Card>

      {pinned.length > 0 ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm font-semibold text-muted-foreground">Pinned</p>
          {pinned.map((post) => (
            <PostCard
              key={post.id}
              post={post}
              currentUserId={user.id}
              isAdmin={user.role === "admin"}
              onChanged={refreshFromTop}
            />
          ))}
        </div>
      ) : null}

      <div className="flex flex-col gap-3">
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No posts yet - be the first to share something.
          </p>
        ) : (
          items.map((post) => (
            <PostCard
              key={post.id}
              post={post}
              currentUserId={user.id}
              isAdmin={user.role === "admin"}
              onChanged={refreshFromTop}
            />
          ))
        )}
      </div>

      {nextCursor ? (
        <Button
          type="button"
          variant="outline"
          disabled={loadingMore}
          onClick={() => {
            void loadMore();
          }}
        >
          {loadingMore ? "Loading..." : "Load more"}
        </Button>
      ) : null}
    </main>
  );
}

function PostCard({
  post,
  currentUserId,
  isAdmin,
  onChanged,
}: {
  post: FeedPostData;
  currentUserId: string;
  isAdmin: boolean;
  onChanged: () => Promise<void>;
}) {
  const doUpdatePost = useServerFn(updatePostFn);
  const doDeletePost = useServerFn(deletePostFn);
  const doPinPost = useServerFn(pinPostFn);
  const doUnpinPost = useServerFn(unpinPostFn);

  const [editing, setEditing] = useState(false);
  const [editBody, setEditBody] = useState(post.body);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isOwner = post.authorId === currentUserId;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div className="flex items-center gap-3">
          {post.authorAvatarKey ? (
            <img
              src={mediaUrl(post.authorAvatarKey, "thumbnail")}
              alt=""
              className="h-10 w-10 rounded-full object-cover"
            />
          ) : (
            <CircleUserRound className="h-10 w-10 text-muted-foreground" />
          )}
          <div>
            <p className="text-sm font-medium">{post.authorDisplayName}</p>
            <p className="text-xs text-muted-foreground">
              {post.createdAt.toLocaleString()}
              {post.editedAt ? " · edited" : null}
              {post.pinnedAt ? " · Pinned" : null}
            </p>
          </div>
        </div>
        <div className="flex gap-1">
          {isAdmin ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={busy}
              title={post.pinnedAt ? "Unpin" : "Pin"}
              onClick={() => {
                setBusy(true);
                const action = post.pinnedAt
                  ? doUnpinPost({ data: { postId: post.id } })
                  : doPinPost({ data: { postId: post.id } });
                void action
                  .then(onChanged)
                  .catch((pinError: unknown) => {
                    setError(
                      pinError instanceof Error ? pinError.message : "Could not update pin.",
                    );
                  })
                  .finally(() => {
                    setBusy(false);
                  });
              }}
            >
              {post.pinnedAt ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
            </Button>
          ) : null}
          {isOwner ? (
            <>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                title="Edit"
                onClick={() => {
                  setEditing((value) => !value);
                }}
              >
                <Pencil className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={busy}
                title="Delete"
                onClick={() => {
                  setBusy(true);
                  void doDeletePost({ data: { postId: post.id } })
                    .then(onChanged)
                    .catch((deleteError: unknown) => {
                      setError(
                        deleteError instanceof Error
                          ? deleteError.message
                          : "Could not delete post.",
                      );
                    })
                    .finally(() => {
                      setBusy(false);
                    });
                }}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {post.category ? (
          <span className="w-fit rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
            {categoryLabels[post.category]}
          </span>
        ) : null}
        {editing ? (
          <div className="flex flex-col gap-2">
            <Textarea
              maxLength={5000}
              value={editBody}
              onChange={(event) => {
                setEditBody(event.target.value);
              }}
            />
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                disabled={busy || !editBody.trim()}
                onClick={() => {
                  setBusy(true);
                  void doUpdatePost({
                    data: { postId: post.id, body: editBody, category: post.category ?? undefined },
                  })
                    .then(() => {
                      setEditing(false);
                      return onChanged();
                    })
                    .catch((updateError: unknown) => {
                      setError(
                        updateError instanceof Error
                          ? updateError.message
                          : "Could not save changes.",
                      );
                    })
                    .finally(() => {
                      setBusy(false);
                    });
                }}
              >
                Save
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setEditing(false);
                  setEditBody(post.body);
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <p className="whitespace-pre-wrap text-sm">{post.body}</p>
        )}
        {post.media.length > 0 ? (
          <div className="grid grid-cols-2 gap-2">
            {post.media.map((item) => (
              <img
                key={item.id}
                src={mediaUrl(item.r2Key, "medium")}
                alt=""
                className="w-full rounded-md object-cover"
              />
            ))}
          </div>
        ) : null}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </CardContent>
    </Card>
  );
}
