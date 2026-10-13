import type { ListingView } from "@plumas/auth";
import { Button, Card, CardContent, CardHeader, CardTitle, Textarea } from "@plumas/ui";
import type {
  ListingCategory,
  ListingKind,
  ListingPriceUnit,
  ListingType,
} from "@plumas/validators";
import { itemCategories, serviceCategories } from "@plumas/validators";
import { createFileRoute, Link, notFound, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ShoppingBag } from "lucide-react";
import { useState } from "react";

import { ListingCommentsSection } from "../../../components/listing-interactions";
import { ReportToggle } from "../../../components/report-toggle";
import { startConversationWithUser } from "../../../lib/dm-client";
import { categoryLabels, formatPrice } from "../../../lib/listing-labels";
import { mediaUrl } from "../../../lib/upload-image";
import {
  deleteListingFn,
  getListingByIdFn,
  getListingCommentCountsFn,
  setListingStatusFn,
  updateListingFn,
} from "../../../server/functions/listings";

export const Route = createFileRoute("/_app/marketplace/$listingId")({
  loader: async ({ params }) => {
    const listing = await getListingByIdFn({ data: { listingId: params.listingId } });
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack's own notFound().
    if (!listing) throw notFound();

    const commentCounts = await getListingCommentCountsFn({ data: { listingIds: [listing.id] } });
    return { listing, commentCount: commentCounts[listing.id] ?? 0 };
  },
  component: ListingDetail,
  notFoundComponent: () => (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-2 p-6 text-center">
      <p className="text-lg font-medium">Listing not found</p>
      <p className="text-sm text-muted-foreground">
        It may have been sold, removed, or never existed.
      </p>
      <Link to="/marketplace" className="text-sm font-medium text-primary hover:underline">
        Back to the marketplace
      </Link>
    </main>
  ),
});

const statusLabel: Record<ListingView["status"], string> = {
  available: "Available",
  pending: "Pending",
  closed: "Closed",
  expired: "Expired",
};

function ListingDetail() {
  const { user } = Route.useRouteContext();
  const initial = Route.useLoaderData();
  const navigate = useNavigate();

  const doUpdateListing = useServerFn(updateListingFn);
  const doSetStatus = useServerFn(setListingStatusFn);
  const doDeleteListing = useServerFn(deleteListingFn);

  const [listing, setListing] = useState<ListingView>(initial.listing);
  const [commentCount, setCommentCount] = useState(initial.commentCount);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [messageError, setMessageError] = useState<string | null>(null);

  const isSeller = listing.sellerId === user.id;

  async function handleStatus(status: "available" | "pending" | "closed") {
    setBusy(true);
    setError(null);
    try {
      const updated = await doSetStatus({ data: { listingId: listing.id, status } });
      setListing((previous) => ({ ...previous, status: updated.status }));
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : "Couldn't update status.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    setBusy(true);
    setError(null);
    try {
      await doDeleteListing({ data: { listingId: listing.id } });
      await navigate({ to: "/marketplace" });
    } catch (deleteError) {
      setError(
        deleteError instanceof Error ? deleteError.message : "Couldn't delete this listing.",
      );
      setBusy(false);
    }
  }

  async function handleMessageSeller() {
    setMessageError(null);
    try {
      const conversationId = await startConversationWithUser(user.id, listing.sellerId);
      await navigate({ to: "/messages/$conversationId", params: { conversationId } });
    } catch (messageError) {
      setMessageError(
        messageError instanceof Error ? messageError.message : "Couldn't start that chat.",
      );
    }
  }

  const priceLabel =
    listing.type === "free"
      ? "Free"
      : listing.type === "wanted"
        ? "Wanted"
        : formatPrice(listing.priceCents, listing.priceUnit);

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col gap-4 p-6">
      <Card>
        <CardContent className="flex flex-col gap-3 pt-6">
          {listing.photos.length > 0 ? (
            <div className="flex flex-col gap-2">
              <img
                src={mediaUrl(listing.photos[0]?.r2Key ?? "", "medium")}
                alt={listing.photos[0]?.altText ?? ""}
                className="h-56 w-full rounded-md object-cover"
              />
              {listing.photos.length > 1 ? (
                <div className="flex gap-2 overflow-x-auto">
                  {listing.photos.slice(1).map((photo) => (
                    <img
                      key={photo.id}
                      src={mediaUrl(photo.r2Key, "thumbnail")}
                      alt={photo.altText ?? ""}
                      className="h-16 w-16 shrink-0 rounded-md object-cover"
                    />
                  ))}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="flex h-56 w-full items-center justify-center rounded-md bg-muted">
              <ShoppingBag className="h-10 w-10 text-muted-foreground" />
            </div>
          )}
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-semibold">{listing.title}</h1>
            <span className="rounded-full bg-muted px-2 py-1 text-xs font-medium">
              {statusLabel[listing.status]}
            </span>
          </div>
          <p className="text-lg font-medium">{priceLabel}</p>
          <p className="text-sm text-muted-foreground">
            {categoryLabels[listing.category]}
            {listing.condition ? ` · ${listing.condition}` : ""}
          </p>
          <p className="text-xs text-muted-foreground">
            Posted by{" "}
            <Link
              to="/profile/$userId"
              params={{ userId: listing.sellerId }}
              className="font-medium hover:underline"
            >
              {listing.sellerDisplayName}
            </Link>
            {listing.businessName && listing.businessSlug ? (
              <>
                {" "}
                · Listed by{" "}
                <Link
                  to="/businesses/$slug"
                  params={{ slug: listing.businessSlug }}
                  className="font-medium hover:underline"
                >
                  {listing.businessName}
                </Link>
              </>
            ) : null}
          </p>
          {listing.description ? <p className="text-sm">{listing.description}</p> : null}
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        {isSeller ? (
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setEditing((v) => !v);
              }}
            >
              Edit
            </Button>
            {listing.status !== "pending" ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => void handleStatus("pending")}
              >
                Mark pending
              </Button>
            ) : null}
            {listing.status !== "closed" ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => void handleStatus("closed")}
              >
                {listing.kind === "item" ? "Mark sold" : "Mark filled"}
              </Button>
            ) : null}
            {listing.status !== "available" ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => void handleStatus("available")}
              >
                Back to available
              </Button>
            ) : null}
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={busy}
              onClick={() => void handleDelete()}
            >
              Delete
            </Button>
          </>
        ) : (
          <>
            <Button type="button" size="sm" onClick={() => void handleMessageSeller()}>
              Message seller
            </Button>
            <ReportToggle targetType="listing" targetId={listing.id} />
          </>
        )}
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {messageError ? <p className="text-sm text-destructive">{messageError}</p> : null}

      {isSeller && editing ? (
        <EditListingPanel
          listing={listing}
          onSave={async (input) => {
            const updated = await doUpdateListing({ data: { listingId: listing.id, ...input } });
            setListing((previous) => ({ ...previous, ...updated }));
            setEditing(false);
          }}
        />
      ) : null}

      <Card>
        <CardContent className="pt-6">
          <ListingCommentsSection
            listingId={listing.id}
            commentCount={commentCount}
            currentUserId={user.id}
            onCountChanged={async () => {
              const counts = await getListingCommentCountsFn({
                data: { listingIds: [listing.id] },
              });
              setCommentCount(counts[listing.id] ?? 0);
            }}
          />
        </CardContent>
      </Card>
    </main>
  );
}

function EditListingPanel({
  listing,
  onSave,
}: {
  listing: ListingView;
  onSave: (input: {
    kind: ListingKind;
    type: ListingType;
    title: string;
    description?: string | undefined;
    category: ListingCategory;
    condition?: string | undefined;
    priceCents?: number | undefined;
    priceUnit?: ListingPriceUnit | undefined;
    area?: string | undefined;
  }) => Promise<void>;
}) {
  const [kind] = useState<ListingKind>(listing.kind);
  const [type, setType] = useState<ListingType>(listing.type);
  const [title, setTitle] = useState(listing.title);
  const [description, setDescription] = useState(listing.description ?? "");
  const [category, setCategory] = useState<ListingCategory>(listing.category);
  const [condition, setCondition] = useState(listing.condition ?? "");
  const [priceDollars, setPriceDollars] = useState(
    listing.priceCents !== null ? (listing.priceCents / 100).toString() : "",
  );
  const [priceUnit, setPriceUnit] = useState<ListingPriceUnit>(listing.priceUnit ?? "fixed");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const categoryOptions = kind === "item" ? itemCategories : serviceCategories;
  const free = type === "free";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Edit listing</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex gap-2">
          {(["sale", "free", "wanted"] as const).map((value) => (
            <Button
              key={value}
              type="button"
              size="sm"
              variant={type === value ? "default" : "outline"}
              onClick={() => {
                setType(value);
              }}
            >
              {value === "sale"
                ? kind === "service"
                  ? "For hire"
                  : "For sale"
                : value === "free"
                  ? "Free"
                  : "Wanted"}
            </Button>
          ))}
        </div>
        <input
          type="text"
          value={title}
          maxLength={150}
          className="h-10 rounded-md border border-border bg-background px-3 text-sm text-foreground"
          onChange={(e) => {
            setTitle(e.target.value);
          }}
        />
        <Textarea
          maxLength={2000}
          value={description}
          onChange={(e) => {
            setDescription(e.target.value);
          }}
        />
        <select
          aria-label="Category"
          value={category}
          className="h-10 rounded-md border border-border bg-background px-3 text-sm text-foreground"
          onChange={(e) => {
            setCategory(e.target.value as ListingCategory);
          }}
        >
          {categoryOptions.map((value) => (
            <option key={value} value={value}>
              {categoryLabels[value]}
            </option>
          ))}
        </select>
        {kind === "item" ? (
          <input
            type="text"
            value={condition}
            maxLength={50}
            placeholder="Condition"
            className="h-10 rounded-md border border-border bg-background px-3 text-sm text-foreground"
            onChange={(e) => {
              setCondition(e.target.value);
            }}
          />
        ) : null}
        {!free ? (
          <>
            <input
              type="number"
              min="0"
              step="0.01"
              value={priceDollars}
              placeholder="Price"
              className="h-10 rounded-md border border-border bg-background px-3 text-sm text-foreground"
              onChange={(e) => {
                setPriceDollars(e.target.value);
              }}
            />
            {kind === "service" ? (
              <select
                aria-label="Price model"
                value={priceUnit}
                className="h-10 rounded-md border border-border bg-background px-3 text-sm text-foreground"
                onChange={(e) => {
                  setPriceUnit(e.target.value as ListingPriceUnit);
                }}
              >
                <option value="fixed">Fixed price</option>
                <option value="hourly">Hourly rate</option>
                <option value="quote">Contact for quote</option>
              </select>
            ) : null}
          </>
        ) : null}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <Button
          type="button"
          size="sm"
          disabled={saving || !title.trim()}
          onClick={() => {
            setSaving(true);
            setError(null);
            void onSave({
              kind,
              type,
              title: title.trim(),
              description: description.trim() || undefined,
              category,
              condition: kind === "item" ? condition.trim() || undefined : undefined,
              priceCents:
                !free && priceDollars.trim() ? Math.round(Number(priceDollars) * 100) : undefined,
              priceUnit: free || kind === "item" ? undefined : priceUnit,
            })
              .catch((saveError: unknown) => {
                setError(saveError instanceof Error ? saveError.message : "Couldn't save changes.");
              })
              .finally(() => {
                setSaving(false);
              });
          }}
        >
          Save
        </Button>
      </CardContent>
    </Card>
  );
}
