import { Button, Textarea } from "@plumas/ui";
import type { ReactionType } from "@plumas/validators";
import { reactionTypes } from "@plumas/validators";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";

import { formatDateTime } from "../lib/format-date";
import {
  createEventCommentFn,
  deleteEventCommentFn,
  getEventCommentsFn,
  removeEventReactionFn,
  setEventReactionFn,
  updateEventCommentFn,
} from "../server/functions/events";
import { ReportToggle } from "./report-toggle";

const reactionEmoji: Record<ReactionType, string> = {
  like: "👍",
  love: "❤️",
  laugh: "😂",
  sad: "😢",
  helpful: "🙏",
};

interface EventCommentData {
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
 * FR-CAL-10's comment/reaction pair, structurally copied from post-card.tsx's private
 * ReactionBar/CommentsSection - an event isn't a post (different id-space, different server
 * functions), so PostCard itself can't be reused here the way groups'/businesses' boards reuse
 * it; this is the same "duplicate the small typed component" convention already established on
 * the backend for the group/business comment and reaction siblings.
 */
export function EventReactionBar({
  eventId,
  reactionCounts,
  myReaction,
  onChanged,
}: {
  eventId: string;
  reactionCounts: Record<ReactionType, number>;
  myReaction: ReactionType | null;
  onChanged: () => Promise<void>;
}) {
  const doSetReaction = useServerFn(setEventReactionFn);
  const doRemoveReaction = useServerFn(removeEventReactionFn);
  const [busy, setBusy] = useState(false);

  function react(type: ReactionType) {
    if (busy) return;
    setBusy(true);
    const action =
      myReaction === type
        ? doRemoveReaction({ data: { eventId } })
        : doSetReaction({ data: { eventId, type } });
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
            myReaction === type
              ? "border-primary bg-primary/10 text-primary"
              : "border-border text-muted-foreground"
          }`}
        >
          <span>{reactionEmoji[type]}</span>
          {reactionCounts[type] > 0 ? <span>{reactionCounts[type]}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function EventCommentsSection({
  eventId,
  commentCount,
  currentUserId,
  onCountChanged,
}: {
  eventId: string;
  commentCount: number;
  currentUserId: string;
  onCountChanged: () => Promise<void>;
}) {
  const doGetComments = useServerFn(getEventCommentsFn);
  const doCreateComment = useServerFn(createEventCommentFn);
  const doUpdateComment = useServerFn(updateEventCommentFn);
  const doDeleteComment = useServerFn(deleteEventCommentFn);

  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [comments, setComments] = useState<EventCommentData[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newBody, setNewBody] = useState("");
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState("");

  async function refreshComments() {
    const rows = await doGetComments({ data: { eventId } });
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
      await doCreateComment({ data: { eventId, body, parentId } });
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

  const repliesByParent = new Map<string, EventCommentData[]>();
  for (const comment of comments ?? []) {
    if (comment.parentId) {
      const list = repliesByParent.get(comment.parentId) ?? [];
      list.push(comment);
      repliesByParent.set(comment.parentId, list);
    }
  }
  const topLevel = (comments ?? []).filter((comment) => !comment.parentId);

  function renderComment(comment: EventCommentData, isReply: boolean) {
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
