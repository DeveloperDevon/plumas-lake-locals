import { Button } from "@plumas/ui";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Store } from "lucide-react";
import { useState } from "react";

import { mediaUrl } from "../../../lib/upload-image";
import { getBusinessesFn, getMyBusinessesFn } from "../../../server/functions/business";

export const Route = createFileRoute("/_app/businesses/")({
  loader: async () => {
    const [directory, myBusinesses] = await Promise.all([
      getBusinessesFn({ data: { limit: 20 } }),
      getMyBusinessesFn(),
    ]);
    return { directory, myBusinesses };
  },
  component: BusinessesDirectory,
});

function BusinessLogo({ logoKey }: { logoKey: string | null }) {
  if (logoKey) {
    return (
      <img
        src={mediaUrl(logoKey, "thumbnail")}
        alt=""
        className="h-12 w-12 rounded-md object-cover"
      />
    );
  }
  return (
    <div className="flex h-12 w-12 items-center justify-center rounded-md bg-muted">
      <Store className="h-6 w-6 text-muted-foreground" />
    </div>
  );
}

function BusinessesDirectory() {
  const { directory, myBusinesses } = Route.useLoaderData();
  const doGetBusinesses = useServerFn(getBusinessesFn);

  const [items, setItems] = useState(directory.items);
  const [nextCursor, setNextCursor] = useState(directory.nextCursor);
  const [search, setSearch] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);

  async function runSearch(value: string) {
    setSearch(value);
    const page = await doGetBusinesses({ data: { search: value || undefined, limit: 20 } });
    setItems(page.items);
    setNextCursor(page.nextCursor);
  }

  async function loadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const page = await doGetBusinesses({
        data: { search: search || undefined, cursor: nextCursor, limit: 20 },
      });
      setItems((previous) => [...previous, ...page.items]);
      setNextCursor(page.nextCursor);
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Businesses</h1>
        <Link to="/businesses/new" className="text-sm font-medium text-primary hover:underline">
          Create a page
        </Link>
      </div>

      {myBusinesses.length > 0 ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-semibold text-muted-foreground">My businesses</p>
          <div className="flex flex-col gap-2">
            {myBusinesses.map((business) => (
              <Link
                key={business.id}
                to="/businesses/$slug"
                params={{ slug: business.slug }}
                className="flex items-center gap-3 rounded-md border border-border p-3 hover:bg-muted"
              >
                <BusinessLogo logoKey={business.logoKey} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{business.name}</p>
                  {business.category ? (
                    <p className="text-xs text-muted-foreground">{business.category}</p>
                  ) : null}
                </div>
              </Link>
            ))}
          </div>
        </div>
      ) : null}

      <div className="flex flex-col gap-3">
        <input
          type="text"
          placeholder="Search businesses..."
          value={search}
          className="h-11 rounded-md border border-border bg-background px-3 text-sm text-foreground"
          onChange={(event) => void runSearch(event.target.value)}
        />
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No businesses found.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {items.map((business) => (
              <Link
                key={business.id}
                to="/businesses/$slug"
                params={{ slug: business.slug }}
                className="flex items-center gap-3 rounded-md border border-border p-3 hover:bg-muted"
              >
                <BusinessLogo logoKey={business.logoKey} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{business.name}</p>
                  {business.category ? (
                    <p className="text-xs text-muted-foreground">{business.category}</p>
                  ) : null}
                  {business.description ? (
                    <p className="truncate text-xs text-muted-foreground">{business.description}</p>
                  ) : null}
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
