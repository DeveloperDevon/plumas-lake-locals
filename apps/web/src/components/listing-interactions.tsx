import { Button, Textarea } from "@plumas/ui";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";

import { formatDateTime } from "../lib/format-date";
import {
  createListingCommentFn,
  deleteListingCommentFn,
  getListingCommentsFn,
  updateListingCommentFn,
} from "../server/functions/listings";
import { ReportToggle } from "./report-toggle";

interface ListingCommentData {
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
 * FR-MKT-08's comment half, structurally copied from event-interactions.tsx's
 * EventCommentsSection (itself copied from post-card.tsx's private CommentsSection) - a listing
 * isn't an event or a post (different id-space, different server functions), so neither is
 * reusable here. No reaction bar - FR-MKT-08 asks only for comments, unlike posts/events.
 */
export function ListingCommentsSection({
  listingId,
  commentCount,
  currentUserId,
  onCountChanged,
}: {
  listingId: string;
  commentCount: number;
  currentUserId: string;
  onCountChanged: () => Promise<void>;
}) {
  const doGetComments = useServerFn(getListingCommentsFn);
  const doCreateComment = useServerFn(createListingCommentFn);
  const doUpdateComment = useServerFn(updateListingCommentFn);
  const doDeleteComment = useServerFn(deleteListingCommentFn);

  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [comments, setComments] = useState<ListingCommentData[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newBody, setNewBody] = useState("");
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState("");

  async function refreshComments() {
    const rows = await doGetComments({ data: { listingId } });
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
      await doCreateComment({ data: { listingId, body, parentId } });
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

  const repliesByParent = new Map<string, ListingCommentData[]>();
  for (const comment of comments ?? []) {
    if (comment.parentId) {
      const list = repliesByParent.get(comment.parentId) ?? [];
      list.push(comment);
      repliesByParent.set(comment.parentId, list);
    }
  }
  const topLevel = (comments ?? []).filter((comment) => !comment.parentId);

  function renderComment(comment: ListingCommentData, isReply: boolean) {
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
