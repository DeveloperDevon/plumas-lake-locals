import { Button, Card, CardContent, CardHeader, CardTitle, Textarea } from "@plumas/ui";
import type { PostCategory } from "@plumas/validators";
import { postCategories } from "@plumas/validators";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useRef, useState } from "react";

import { categoryLabels, type FeedPostData, PostCard } from "../../components/post-card";
import { uploadImage } from "../../lib/upload-image";
import { createPostFn, getFeed } from "../../server/functions/posts";

export const Route = createFileRoute("/_app/feed")({
  loader: async () => getFeed({ data: { limit: 20 } }),
  component: Feed,
});

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
        await uploadImage(file, "post", { postId: post.id });
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
