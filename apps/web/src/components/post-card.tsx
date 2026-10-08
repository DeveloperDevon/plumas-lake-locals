import { Button, Card, CardContent, CardHeader, Textarea } from "@plumas/ui";
import type { PostCategory, ReactionType } from "@plumas/validators";
import { reactionTypes } from "@plumas/validators";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { CircleUserRound, Pencil, Pin, PinOff, Trash2 } from "lucide-react";
import { useState } from "react";

import { formatDateTime } from "../lib/format-date";
import { mediaUrl } from "../lib/upload-image";
import {
  createCommentFn,
  deleteCommentFn,
  getComments,
  removeReactionFn,
  setReactionFn,
  updateCommentFn,
} from "../server/functions/comments";
import { deletePostFn, pinPostFn, unpinPostFn, updatePostFn } from "../server/functions/posts";
import { ReportToggle } from "./report-toggle";

const reactionEmoji: Record<ReactionType, string> = {
  like: "👍",
  love: "❤️",
  laugh: "😂",
  sad: "😢",
  helpful: "🙏",
};

export const categoryLabels: Record<PostCategory, string> = {
  general: "General",
  lost_found: "Lost & Found",
  safety: "Safety",
  recommendations: "Recommendations",
};

export interface FeedPostData {
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
  reactionCounts: Record<ReactionType, number>;
  myReaction: ReactionType | null;
  commentCount: number;
}

interface CommentData {
  id: string;
  body: string;
  parentId: string | null;
  createdAt: Date;
  editedAt: Date | null;
  deletedAt: Date | null;
  authorId: string;
  authorDisplayName: string;
  authorAvatarKey: string | null;
}

/**
 * The reusable "board" post card - every operation here (edit/delete/pin/react/comment) is
 * scoped purely by postId/commentId, so it works identically for a feed post or a group's
 * board post (FR-GRP-06: "same post component") with no context-specific branching needed.
 */
export function PostCard({
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
        <Link
          to="/profile/$userId"
          params={{ userId: post.authorId }}
          className="flex items-center gap-3"
        >
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
            <p className="text-sm font-medium hover:underline">{post.authorDisplayName}</p>
            <p className="text-xs text-muted-foreground">
              {formatDateTime(post.createdAt)}
              {post.editedAt ? " · edited" : null}
              {post.pinnedAt ? " · Pinned" : null}
            </p>
          </div>
        </Link>
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
        <div className="flex items-center justify-between">
          <ReactionBar post={post} onChanged={onChanged} />
          {!isOwner ? <ReportToggle targetType="post" targetId={post.id} /> : null}
        </div>
        <CommentsSection
          postId={post.id}
          commentCount={post.commentCount}
          currentUserId={currentUserId}
          onCountChanged={onChanged}
        />
      </CardContent>
    </Card>
  );
}

function ReactionBar({ post, onChanged }: { post: FeedPostData; onChanged: () => Promise<void> }) {
  const doSetReaction = useServerFn(setReactionFn);
  const doRemoveReaction = useServerFn(removeReactionFn);
  const [busy, setBusy] = useState(false);

  function react(type: ReactionType) {
    if (busy) return;
    setBusy(true);
    const action =
      post.myReaction === type
        ? doRemoveReaction({ data: { postId: post.id } })
        : doSetReaction({ data: { postId: post.id, type } });
    void action.then(onChanged).finally(() => {
      setBusy(false);
    });
  }

  return (
    <div className="flex flex-wrap gap-1">
      {reactionTypes.map((type) => (
        <button
          key={type}
          type="button"
          disabled={busy}
          onClick={() => {
            react(type);
          }}
          className={`flex items-center gap-1 rounded-full border px-2 py-1 text-xs ${
            post.myReaction === type
              ? "border-primary bg-primary/10 text-primary"
              : "border-border text-muted-foreground"
          }`}
        >
          <span>{reactionEmoji[type]}</span>
          {post.reactionCounts[type] > 0 ? <span>{post.reactionCounts[type]}</span> : null}
        </button>
      ))}
    </div>
  );
}

function CommentsSection({
  postId,
  commentCount,
  currentUserId,
  onCountChanged,
}: {
  postId: string;
  commentCount: number;
  currentUserId: string;
  onCountChanged: () => Promise<void>;
}) {
  const doGetComments = useServerFn(getComments);
  const doCreateComment = useServerFn(createCommentFn);
  const doUpdateComment = useServerFn(updateCommentFn);
  const doDeleteComment = useServerFn(deleteCommentFn);

  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [comments, setComments] = useState<CommentData[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newBody, setNewBody] = useState("");
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState("");

  async function refreshComments() {
    const rows = await doGetComments({ data: { postId } });
    setComments(rows);
  }

  async function toggleExpanded() {
    if (expanded) {
      setExpanded(false);
      return;
    }
    setExpanded(true);
    if (comments) return;
    setLoading(true);
    setError(null);
    try {
      await refreshComments();
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : "Could not load comments.");
    } finally {
      setLoading(false);
    }
  }

  async function submitComment(parentId?: string) {
    const body = parentId ? replyBody : newBody;
    if (!body.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await doCreateComment({ data: { postId, body, parentId } });
      if (parentId) {
        setReplyBody("");
        setReplyingTo(null);
      } else {
        setNewBody("");
      }
      await refreshComments();
      await onCountChanged();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Could not post comment.");
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit(commentId: string) {
    if (!editBody.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await doUpdateComment({ data: { commentId, body: editBody } });
      setEditingId(null);
      await refreshComments();
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Could not save changes.");
    } finally {
      setBusy(false);
    }
  }

  async function removeComment(commentId: string) {
    setBusy(true);
    setError(null);
    try {
      await doDeleteComment({ data: { commentId } });
      await refreshComments();
      await onCountChanged();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Could not delete comment.");
    } finally {
      setBusy(false);
    }
  }

  const repliesByParent = new Map<string, CommentData[]>();
  for (const comment of comments ?? []) {
    if (comment.parentId) {
      const list = repliesByParent.get(comment.parentId) ?? [];
      list.push(comment);
      repliesByParent.set(comment.parentId, list);
    }
  }
  const topLevel = (comments ?? []).filter((comment) => !comment.parentId);

  function renderComment(comment: CommentData, isReply: boolean) {
    const isOwner = comment.authorId === currentUserId;
    const isDeleted = comment.deletedAt !== null;

    return (
      <div
        key={comment.id}
        className={isReply ? "ml-8 flex flex-col gap-1" : "flex flex-col gap-1"}
      >
        <div className="flex items-center gap-2">
          <p className="text-xs font-medium">{comment.authorDisplayName}</p>
          <p className="text-xs text-muted-foreground">
            {formatDateTime(comment.createdAt)}
            {comment.editedAt ? " · edited" : null}
          </p>
        </div>
        {editingId === comment.id ? (
          <div className="flex flex-col gap-1">
            <Textarea
              maxLength={2000}
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
                  void saveEdit(comment.id);
                }}
              >
                Save
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setEditingId(null);
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <p
            className={
              isDeleted ? "text-sm italic text-muted-foreground" : "whitespace-pre-wrap text-sm"
            }
          >
            {isDeleted ? "This comment was deleted." : comment.body}
          </p>
        )}
        {!isDeleted && editingId !== comment.id ? (
          <div className="flex gap-3 text-xs text-muted-foreground">
            {!isReply ? (
              <button
                type="button"
                onClick={() => {
                  setReplyingTo(comment.id);
                  setReplyBody("");
                }}
              >
                Reply
              </button>
            ) : null}
            {isOwner ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setEditingId(comment.id);
                    setEditBody(comment.body);
                  }}
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void removeComment(comment.id);
                  }}
                >
                  Delete
                </button>
              </>
            ) : (
              <ReportToggle targetType="comment" targetId={comment.id} />
            )}
          </div>
        ) : null}
        {!isReply && replyingTo === comment.id ? (
          <div className="ml-8 mt-1 flex flex-col gap-1">
            <Textarea
              maxLength={2000}
              placeholder="Write a reply..."
              value={replyBody}
              onChange={(event) => {
                setReplyBody(event.target.value);
              }}
            />
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                disabled={busy || !replyBody.trim()}
                onClick={() => {
                  void submitComment(comment.id);
                }}
              >
                Reply
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setReplyingTo(null);
                  setReplyBody("");
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : null}
        {!isReply
          ? (repliesByParent.get(comment.id) ?? []).map((reply) => renderComment(reply, true))
          : null}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 border-t border-border pt-3">
      <button
        type="button"
        className="text-left text-xs text-muted-foreground"
        onClick={() => {
          void toggleExpanded();
        }}
      >
        💬 {commentCount} {commentCount === 1 ? "comment" : "comments"}
      </button>
      {expanded ? (
        <div className="flex flex-col gap-3">
          {loading ? <p className="text-xs text-muted-foreground">Loading...</p> : null}
          {topLevel.map((comment) => renderComment(comment, false))}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <div className="flex flex-col gap-1">
            <Textarea
              maxLength={2000}
              placeholder="Add a comment..."
              value={newBody}
              onChange={(event) => {
                setNewBody(event.target.value);
              }}
            />
            <Button
              type="button"
              size="sm"
              disabled={busy || !newBody.trim()}
              onClick={() => {
                void submitComment();
              }}
            >
              Comment
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
