import { Button, Card, CardContent, CardHeader, CardTitle } from "@plumas/ui";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Building2, Newspaper, Search as SearchIcon, Users } from "lucide-react";
import { useState } from "react";

import { formatDateTime } from "../../lib/format-date";
import { mediaUrl } from "../../lib/upload-image";
import { searchFn } from "../../server/functions/search";

export const Route = createFileRoute("/_app/search")({ component: SearchPage });

interface SearchResults {
  posts: {
    id: string;
    body: string;
    createdAt: Date;
    authorDisplayName: string;
    authorAvatarKey: string | null;
    contextType: "feed" | "group" | "business";
    contextSlug: string | null;
  }[];
  members: { id: string; displayName: string; avatarKey: string | null }[];
  groups: {
    id: string;
    slug: string;
    name: string;
    description: string | null;
    coverKey: string | null;
  }[];
  businesses: {
    id: string;
    slug: string;
    name: string;
    description: string | null;
    coverKey: string | null;
  }[];
}

const emptyResults: SearchResults = { posts: [], members: [], groups: [], businesses: [] };

function postLink(post: SearchResults["posts"][number]) {
  if (post.contextType === "group" && post.contextSlug) {
    return { to: "/groups/$slug" as const, params: { slug: post.contextSlug } };
  }
  if (post.contextType === "business" && post.contextSlug) {
    return { to: "/businesses/$slug" as const, params: { slug: post.contextSlug } };
  }
  return { to: "/feed" as const, params: {} };
}

function Avatar({ avatarKey, size = "h-10 w-10" }: { avatarKey: string | null; size?: string }) {
  if (avatarKey) {
    return (
      <img
        src={mediaUrl(avatarKey, "thumbnail")}
        alt=""
        className={`${size} shrink-0 rounded-full object-cover`}
      />
    );
  }
  return (
    <div className={`flex ${size} shrink-0 items-center justify-center rounded-full bg-muted`}>
      <Users className="h-5 w-5 text-muted-foreground" />
    </div>
  );
}

function CoverIcon({
  coverKey,
  fallback: Fallback,
}: {
  coverKey: string | null;
  fallback: typeof Users;
}) {
  if (coverKey) {
    return (
      <img
        src={mediaUrl(coverKey, "thumbnail")}
        alt=""
        className="h-12 w-12 shrink-0 rounded-md object-cover"
      />
    );
  }
  return (
    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-muted">
      <Fallback className="h-6 w-6 text-muted-foreground" />
    </div>
  );
}

function ResultSection({
  title,
  icon: Icon,
  empty,
  children,
}: {
  title: string;
  icon: typeof Users;
  empty: boolean;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className="h-4 w-4" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {empty ? <p className="text-sm text-muted-foreground">No matches.</p> : children}
      </CardContent>
    </Card>
  );
}

function SearchPage() {
  const doSearch = useServerFn(searchFn);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults>(emptyResults);
  const [searched, setSearched] = useState(false);
  const [searching, setSearching] = useState(false);

  async function runSearch() {
    const trimmed = query.trim();
    if (!trimmed) return;
    setSearching(true);
    try {
      const page = await doSearch({ data: { query: trimmed } });
      setResults(page);
      setSearched(true);
    } finally {
      setSearching(false);
    }
  }

  const totalResults =
    results.posts.length +
    results.members.length +
    results.groups.length +
    results.businesses.length;

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 p-6">
      <h1 className="text-xl font-semibold">Search</h1>

      <div className="flex gap-2">
        <input
          type="text"
          placeholder="Search posts, members, groups and businesses..."
          value={query}
          className="h-11 flex-1 rounded-md border border-border bg-background px-3 text-sm text-foreground"
          onChange={(event) => {
            setQuery(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") void runSearch();
          }}
        />
        <Button
          type="button"
          disabled={!query.trim() || searching}
          onClick={() => void runSearch()}
        >
          {searching ? "Searching..." : "Search"}
        </Button>
      </div>

      {searched && totalResults === 0 ? (
        <div className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
          <SearchIcon className="h-8 w-8" />
          <p className="text-sm">No results for &quot;{query.trim()}&quot;.</p>
        </div>
      ) : null}

      {searched && totalResults > 0 ? (
        <div className="flex flex-col gap-4">
          <ResultSection title="Posts" icon={Newspaper} empty={results.posts.length === 0}>
            {results.posts.map((post) => (
              <Link
                key={post.id}
                {...postLink(post)}
                className="flex items-start gap-3 rounded-md border border-border p-3 hover:bg-muted"
              >
                <Avatar avatarKey={post.authorAvatarKey} size="h-8 w-8" />
                <div className="min-w-0">
                  <p className="text-sm font-medium">{post.authorDisplayName}</p>
                  <p className="line-clamp-2 text-sm text-muted-foreground">{post.body}</p>
                  <p className="text-xs text-muted-foreground">{formatDateTime(post.createdAt)}</p>
                </div>
              </Link>
            ))}
          </ResultSection>

          <ResultSection title="Members" icon={Users} empty={results.members.length === 0}>
            {results.members.map((member) => (
              <Link
                key={member.id}
                to="/profile/$userId"
                params={{ userId: member.id }}
                className="flex items-center gap-3 rounded-md border border-border p-3 hover:bg-muted"
              >
                <Avatar avatarKey={member.avatarKey} />
                <p className="text-sm font-medium">{member.displayName}</p>
              </Link>
            ))}
          </ResultSection>

          <ResultSection title="Groups" icon={Users} empty={results.groups.length === 0}>
            {results.groups.map((group) => (
              <Link
                key={group.id}
                to="/groups/$slug"
                params={{ slug: group.slug }}
                className="flex items-center gap-3 rounded-md border border-border p-3 hover:bg-muted"
              >
                <CoverIcon coverKey={group.coverKey} fallback={Users} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{group.name}</p>
                  {group.description ? (
                    <p className="truncate text-xs text-muted-foreground">{group.description}</p>
                  ) : null}
                </div>
              </Link>
            ))}
          </ResultSection>

          <ResultSection
            title="Businesses"
            icon={Building2}
            empty={results.businesses.length === 0}
          >
            {results.businesses.map((business) => (
              <Link
                key={business.id}
                to="/businesses/$slug"
                params={{ slug: business.slug }}
                className="flex items-center gap-3 rounded-md border border-border p-3 hover:bg-muted"
              >
                <CoverIcon coverKey={business.coverKey} fallback={Building2} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{business.name}</p>
                  {business.description ? (
                    <p className="truncate text-xs text-muted-foreground">{business.description}</p>
                  ) : null}
                </div>
              </Link>
            ))}
          </ResultSection>
        </div>
      ) : null}

      {!searched ? (
        <div className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
          <SearchIcon className="h-8 w-8" />
          <p className="text-sm">Search across posts, members, groups and businesses.</p>
        </div>
      ) : null}
    </main>
  );
}
