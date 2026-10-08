import { Button } from "@plumas/ui";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { startGroupConversation } from "../../../lib/dm-client";
import { searchMembersFn } from "../../../server/functions/dm";

interface PickedMember {
  id: string;
  displayName: string;
}

interface NewGroupSearch {
  name?: string | undefined;
  members?: string | undefined;
}

export const Route = createFileRoute("/_app/messages/new")({
  // FR-DM-19: the profile Family tab deep-links here with every accepted relationship
  // preselected (small enough list to pass as JSON directly, no extra round trip needed).
  validateSearch: (search: Record<string, unknown>): NewGroupSearch => ({
    name: typeof search.name === "string" ? search.name : undefined,
    members: typeof search.members === "string" ? search.members : undefined,
  }),
  component: NewGroupConversation,
});

function parsePreselected(raw: string | undefined): PickedMember[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is PickedMember =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as { id?: unknown }).id === "string" &&
        typeof (entry as { displayName?: unknown }).displayName === "string",
    );
  } catch {
    return [];
  }
}

function NewGroupConversation() {
  const { user } = Route.useRouteContext();
  const search = Route.useSearch();
  const navigate = useNavigate();

  const [name, setName] = useState(search.name ?? "");
  const [picked, setPicked] = useState<PickedMember[]>(() => parsePreselected(search.members));
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PickedMember[]>([]);
  const [searching, setSearching] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSearch(value: string) {
    setQuery(value);
    if (value.trim().length === 0) {
      setResults([]);
      return;
    }
    setSearching(true);
    try {
      const found = await searchMembersFn({ data: { query: value } });
      setResults(found);
    } finally {
      setSearching(false);
    }
  }

  function addMember(member: PickedMember) {
    if (picked.some((entry) => entry.id === member.id)) return;
    setPicked([...picked, member]);
    setQuery("");
    setResults([]);
  }

  function removeMember(id: string) {
    setPicked(picked.filter((entry) => entry.id !== id));
  }

  async function handleCreate() {
    setCreating(true);
    setError(null);
    try {
      const conversationId = await startGroupConversation(
        user.id,
        name.trim(),
        picked.map((entry) => entry.id),
      );
      await navigate({ to: "/messages/$conversationId", params: { conversationId } });
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Couldn't create the group.");
      setCreating(false);
    }
  }

  const canCreate = name.trim().length > 0 && picked.length > 0 && !creating;

  return (
    <div className="flex max-w-md flex-col gap-4">
      <h2 className="text-lg font-semibold">New group</h2>

      <div className="flex flex-col gap-1">
        <label htmlFor="group-name" className="text-sm font-medium">
          Group name
        </label>
        <input
          id="group-name"
          type="text"
          value={name}
          maxLength={100}
          placeholder="Lopez family"
          className="h-11 rounded-md border border-border bg-background px-3 text-sm text-foreground"
          onChange={(event) => {
            setName(event.target.value);
          }}
        />
      </div>

      {picked.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {picked.map((member) => (
            <span
              key={member.id}
              className="flex items-center gap-1 rounded-full bg-muted px-3 py-1 text-xs"
            >
              {member.displayName}
              <button
                type="button"
                className="text-muted-foreground hover:text-destructive"
                onClick={() => {
                  removeMember(member.id);
                }}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : null}

      <div className="relative flex flex-col gap-1">
        <label htmlFor="member-search" className="text-sm font-medium">
          Add members
        </label>
        <input
          id="member-search"
          type="text"
          value={query}
          placeholder="Search members by name..."
          className="h-11 rounded-md border border-border bg-background px-3 text-sm text-foreground"
          onChange={(event) => {
            void handleSearch(event.target.value);
          }}
        />
        {searching ? <p className="text-xs text-muted-foreground">Searching...</p> : null}
        {results.length > 0 ? (
          <div className="flex flex-col gap-1 rounded-md border border-border bg-card p-1">
            {results
              .filter((result) => !picked.some((entry) => entry.id === result.id))
              .map((result) => (
                <button
                  key={result.id}
                  type="button"
                  className="rounded-md px-2 py-1 text-left text-sm hover:bg-muted"
                  onClick={() => {
                    addMember({ id: result.id, displayName: result.displayName });
                  }}
                >
                  {result.displayName}
                </button>
              ))}
          </div>
        ) : null}
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <Button type="button" disabled={!canCreate} onClick={() => void handleCreate()}>
        {creating ? "Creating..." : "Create group"}
      </Button>
    </div>
  );
}
