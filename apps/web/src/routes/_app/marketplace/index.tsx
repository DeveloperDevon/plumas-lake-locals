import type { ListingSummary } from "@plumas/auth";
import { Button } from "@plumas/ui";
import type { ListingCategory, ListingKind, ListingType } from "@plumas/validators";
import { listingCategories, listingKinds, listingTypes } from "@plumas/validators";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ShoppingBag } from "lucide-react";
import { useEffect, useState } from "react";

import { categoryLabels, formatPrice } from "../../../lib/listing-labels";
import { mediaUrl } from "../../../lib/upload-image";
import { getListingsFn } from "../../../server/functions/listings";

interface MarketplaceSearch {
  kind?: ListingKind | undefined;
  type?: ListingType | undefined;
  category?: ListingCategory | undefined;
  minPrice?: number | undefined;
  maxPrice?: number | undefined;
  condition?: string | undefined;
}

function parseKind(value: unknown): ListingKind | undefined {
  return typeof value === "string" && (listingKinds as readonly string[]).includes(value)
    ? (value as ListingKind)
    : undefined;
}
function parseType(value: unknown): ListingType | undefined {
  return typeof value === "string" && (listingTypes as readonly string[]).includes(value)
    ? (value as ListingType)
    : undefined;
}
function parseCategory(value: unknown): ListingCategory | undefined {
  return typeof value === "string" && (listingCategories as readonly string[]).includes(value)
    ? (value as ListingCategory)
    : undefined;
}

export const Route = createFileRoute("/_app/marketplace/")({
  // FR-MKT-05: filter state lives entirely in the URL, so a filtered view is shareable.
  validateSearch: (search: Record<string, unknown>): MarketplaceSearch => ({
    kind: parseKind(search.kind),
    type: parseType(search.type),
    category: parseCategory(search.category),
    minPrice: typeof search.minPrice === "number" ? search.minPrice : undefined,
    maxPrice: typeof search.maxPrice === "number" ? search.maxPrice : undefined,
    condition: typeof search.condition === "string" ? search.condition : undefined,
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) =>
    getListingsFn({
      data: {
        kind: deps.kind,
        type: deps.type,
        category: deps.category,
        minPriceCents: deps.minPrice !== undefined ? deps.minPrice * 100 : undefined,
        maxPriceCents: deps.maxPrice !== undefined ? deps.maxPrice * 100 : undefined,
        condition: deps.condition,
        limit: 20,
      },
    }),
  component: Marketplace,
});

function ListingCoverIcon({ coverKey }: { coverKey: string | null }) {
  if (coverKey) {
    return (
      <img
        src={mediaUrl(coverKey, "thumbnail")}
        alt=""
        className="aspect-square w-full rounded-md object-cover"
      />
    );
  }
  return (
    <div className="flex aspect-square w-full items-center justify-center rounded-md bg-muted">
      <ShoppingBag className="h-8 w-8 text-muted-foreground" />
    </div>
  );
}

function ListingCard({ listing }: { listing: ListingSummary }) {
  const priceLabel =
    listing.type === "free"
      ? "Free"
      : listing.type === "wanted"
        ? "Wanted"
        : formatPrice(listing.priceCents, listing.priceUnit);

  return (
    <Link
      to="/marketplace/$listingId"
      params={{ listingId: listing.id }}
      className="flex flex-col gap-1 rounded-md border border-border p-2 hover:bg-muted"
    >
      <ListingCoverIcon coverKey={listing.coverKey} />
      <p className="truncate text-sm font-medium">{listing.title}</p>
      <p className="text-xs text-muted-foreground">
        {priceLabel}
        {listing.businessName ? ` · ${listing.businessName}` : ""}
      </p>
    </Link>
  );
}

function Marketplace() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const initial = Route.useLoaderData();
  const doGetListings = useServerFn(getListingsFn);

  const [items, setItems] = useState(initial.items);
  const [nextCursor, setNextCursor] = useState(initial.nextCursor);
  const [loadingMore, setLoadingMore] = useState(false);

  // The route stays mounted across a filter-only navigation (only `search`/loader data change),
  // so the useState above only captures the *first* page load - without this, changing a filter
  // updates the URL but the grid never refreshes.
  useEffect(() => {
    setItems(initial.items);
    setNextCursor(initial.nextCursor);
  }, [initial]);

  function updateSearch(patch: Partial<MarketplaceSearch>) {
    void navigate({ search: (previous) => ({ ...previous, ...patch }) });
  }

  async function loadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const page = await doGetListings({
        data: {
          kind: search.kind,
          type: search.type,
          category: search.category,
          minPriceCents: search.minPrice !== undefined ? search.minPrice * 100 : undefined,
          maxPriceCents: search.maxPrice !== undefined ? search.maxPrice * 100 : undefined,
          condition: search.condition,
          cursor: nextCursor,
          limit: 20,
        },
      });
      setItems((previous) => [...previous, ...page.items]);
      setNextCursor(page.nextCursor);
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Marketplace</h1>
        <div className="flex gap-3 text-sm font-medium text-primary">
          <Link to="/marketplace/mine" className="hover:underline">
            My listings
          </Link>
          <Link to="/marketplace/new" className="hover:underline">
            New listing
          </Link>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant={search.type === "free" ? "default" : "outline"}
          onClick={() => {
            // FR-MKT-04: the one-tap Free chip.
            updateSearch({ type: search.type === "free" ? undefined : "free" });
          }}
        >
          Free
        </Button>
        <select
          aria-label="Kind"
          className="h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground"
          value={search.kind ?? ""}
          onChange={(event) => {
            updateSearch({ kind: parseKind(event.target.value) });
          }}
        >
          <option value="">All kinds</option>
          <option value="item">Items</option>
          <option value="service">Services</option>
        </select>
        <select
          aria-label="Type"
          className="h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground"
          value={search.type ?? ""}
          onChange={(event) => {
            updateSearch({ type: parseType(event.target.value) });
          }}
        >
          <option value="">All types</option>
          <option value="sale">For sale / hire</option>
          <option value="free">Free</option>
          <option value="wanted">Wanted</option>
        </select>
        <select
          aria-label="Category"
          className="h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground"
          value={search.category ?? ""}
          onChange={(event) => {
            updateSearch({ category: parseCategory(event.target.value) });
          }}
        >
          <option value="">All categories</option>
          {listingCategories.map((category) => (
            <option key={category} value={category}>
              {categoryLabels[category]}
            </option>
          ))}
        </select>
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No listings match those filters.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {items.map((listing) => (
            <ListingCard key={listing.id} listing={listing} />
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
    </main>
  );
}
