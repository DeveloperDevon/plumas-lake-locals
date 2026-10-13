import type { ListingSummary } from "@plumas/auth";
import { Button } from "@plumas/ui";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";

import { categoryLabels, formatPrice } from "../../../lib/listing-labels";
import { mediaUrl } from "../../../lib/upload-image";
import {
  deleteListingFn,
  getMyListingsFn,
  renewListingFn,
  setListingStatusFn,
} from "../../../server/functions/listings";

export const Route = createFileRoute("/_app/marketplace/mine")({
  loader: async () => ({ listings: await getMyListingsFn() }),
  component: MyListings,
});

const statusLabel: Record<ListingSummary["status"], string> = {
  available: "Available",
  pending: "Pending",
  closed: "Closed",
  expired: "Expired",
};

function MyListings() {
  const initial = Route.useLoaderData();
  const doSetStatus = useServerFn(setListingStatusFn);
  const doRenew = useServerFn(renewListingFn);
  const doDelete = useServerFn(deleteListingFn);

  const [listings, setListings] = useState(initial.listings);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function run(listingId: string, action: Promise<unknown>) {
    setBusyId(listingId);
    try {
      await action;
      const refreshed = await getMyListingsFn();
      setListings(refreshed);
    } finally {
      setBusyId(null);
    }
  }

  if (listings.length === 0) {
    return (
      <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-4 p-6">
        <h1 className="text-xl font-semibold">My listings</h1>
        <p className="text-sm text-muted-foreground">
          You haven&apos;t posted anything yet.{" "}
          <Link to="/marketplace/new" className="font-medium text-primary hover:underline">
            Add a listing
          </Link>
          .
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">My listings</h1>
        <Link to="/marketplace/new" className="text-sm font-medium text-primary hover:underline">
          New listing
        </Link>
      </div>

      <div className="flex flex-col gap-3">
        {listings.map((listing) => {
          const busy = busyId === listing.id;
          const priceLabel =
            listing.type === "free"
              ? "Free"
              : listing.type === "wanted"
                ? "Wanted"
                : formatPrice(listing.priceCents, listing.priceUnit);

          return (
            <div
              key={listing.id}
              className="flex items-center gap-3 rounded-md border border-border p-3"
            >
              {listing.coverKey ? (
                <img
                  src={mediaUrl(listing.coverKey, "thumbnail")}
                  alt=""
                  className="h-14 w-14 shrink-0 rounded-md object-cover"
                />
              ) : (
                <div className="h-14 w-14 shrink-0 rounded-md bg-muted" />
              )}
              <div className="min-w-0 flex-1">
                <Link
                  to="/marketplace/$listingId"
                  params={{ listingId: listing.id }}
                  className="truncate text-sm font-medium hover:underline"
                >
                  {listing.title}
                </Link>
                <p className="text-xs text-muted-foreground">
                  {statusLabel[listing.status]} · {priceLabel} · {categoryLabels[listing.category]}
                </p>
              </div>
              <div className="flex flex-wrap gap-1">
                <Button type="button" size="sm" variant="outline" asChild>
                  <Link to="/marketplace/$listingId" params={{ listingId: listing.id }}>
                    Edit
                  </Link>
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    void run(listing.id, doRenew({ data: { listingId: listing.id } }));
                  }}
                >
                  Renew
                </Button>
                {listing.status !== "closed" ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      void run(
                        listing.id,
                        doSetStatus({ data: { listingId: listing.id, status: "closed" } }),
                      );
                    }}
                  >
                    {listing.kind === "item" ? "Mark sold" : "Mark filled"}
                  </Button>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      void run(
                        listing.id,
                        doSetStatus({ data: { listingId: listing.id, status: "available" } }),
                      );
                    }}
                  >
                    Reopen
                  </Button>
                )}
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  disabled={busy}
                  onClick={() => {
                    setListings((previous) => previous.filter((item) => item.id !== listing.id));
                    void doDelete({ data: { listingId: listing.id } });
                  }}
                >
                  Delete
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </main>
  );
}
