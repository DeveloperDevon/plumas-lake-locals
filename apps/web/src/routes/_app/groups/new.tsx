import { Button, Textarea } from "@plumas/ui";
import type { GroupVisibility } from "@plumas/validators";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";

import { uploadImage } from "../../../lib/upload-image";
import { createGroupFn } from "../../../server/functions/groups";

export const Route = createFileRoute("/_app/groups/new")({
  component: NewGroup,
});

function NewGroup() {
  const navigate = useNavigate();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [visibility, setVisibility] = useState<GroupVisibility>("public");
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    setCreating(true);
    setError(null);
    try {
      const group = await createGroupFn({
        data: {
          name: name.trim(),
          description: description.trim() || undefined,
          category: category.trim() || undefined,
          visibility,
        },
      });
      if (coverFile) {
        await uploadImage(coverFile, "group_cover", { groupId: group.id });
      }
      await navigate({ to: "/groups/$slug", params: { slug: group.slug } });
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Couldn't create the group.");
      setCreating(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-4 p-6">
      <h1 className="text-xl font-semibold">Create a group</h1>

      <div className="flex flex-col gap-1">
        <label htmlFor="group-name" className="text-sm font-medium">
          Name
        </label>
        <input
          id="group-name"
          type="text"
          value={name}
          maxLength={100}
          placeholder="PLES PTA"
          className="h-11 rounded-md border border-border bg-background px-3 text-sm text-foreground"
          onChange={(event) => {
            setName(event.target.value);
          }}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="group-description" className="text-sm font-medium">
          Description
        </label>
        <Textarea
          id="group-description"
          maxLength={2000}
          value={description}
          onChange={(event) => {
            setDescription(event.target.value);
          }}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="group-category" className="text-sm font-medium">
          Category
        </label>
        <input
          id="group-category"
          type="text"
          value={category}
          maxLength={50}
          placeholder="Parents, Sports, Hobby..."
          className="h-11 rounded-md border border-border bg-background px-3 text-sm text-foreground"
          onChange={(event) => {
            setCategory(event.target.value);
          }}
        />
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium">Visibility</span>
        <div className="flex gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="visibility"
              checked={visibility === "public"}
              onChange={() => {
                setVisibility("public");
              }}
            />
            Public - listed in the directory
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="visibility"
              checked={visibility === "private"}
              onChange={() => {
                setVisibility("private");
              }}
            />
            Private - invite-only, hidden everywhere
          </label>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium">Cover photo</span>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            setCoverFile(file ?? null);
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-fit"
          onClick={() => {
            fileInputRef.current?.click();
          }}
        >
          {coverFile ? coverFile.name : "Add a cover photo"}
        </Button>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <Button type="button" disabled={!name.trim() || creating} onClick={() => void handleCreate()}>
        {creating ? "Creating..." : "Create group"}
      </Button>
    </main>
  );
}
