import { Button, Textarea } from "@plumas/ui";
import type { ListingKind, ListingPriceUnit, ListingType } from "@plumas/validators";
import { itemCategories, serviceCategories } from "@plumas/validators";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";

import type { StagedFile } from "../../../components/staged-photo-alt-text";
import { StagedPhotoAltTextList } from "../../../components/staged-photo-alt-text";
import { categoryLabels } from "../../../lib/listing-labels";
import { uploadImage } from "../../../lib/upload-image";
import { getMyBusinessesFn } from "../../../server/functions/business";
import { createListingFn } from "../../../server/functions/listings";

export const Route = createFileRoute("/_app/marketplace/new")({
  loader: async () => ({ myBusinesses: await getMyBusinessesFn() }),
  component: NewListing,
});

const MAX_PHOTOS = 10;

function NewListing() {
  const { myBusinesses } = Route.useLoaderData();
  const navigate = useNavigate();

  const [kind, setKind] = useState<ListingKind>("item");
  const [type, setType] = useState<ListingType>("sale");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [condition, setCondition] = useState("");
  const [priceDollars, setPriceDollars] = useState("");
  const [priceUnit, setPriceUnit] = useState<ListingPriceUnit>("fixed");
  const [area, setArea] = useState("");
  const [businessId, setBusinessId] = useState("");
  const [photoFiles, setPhotoFiles] = useState<StagedFile[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const categoryOptions = kind === "item" ? itemCategories : serviceCategories;
  const free = type === "free";

  async function handleCreate() {
    setCreating(true);
    setError(null);
    try {
      const priceCents =
        !free && priceDollars.trim() ? Math.round(Number(priceDollars) * 100) : undefined;

      const listing = await createListingFn({
        data: {
          kind,
          type,
          title: title.trim(),
          description: description.trim() || undefined,
          category: category as (typeof categoryOptions)[number],
          condition: kind === "item" ? condition.trim() || undefined : undefined,
          priceCents: free ? undefined : priceCents,
          priceUnit: free || kind === "item" ? undefined : priceUnit,
          area: area.trim() || undefined,
          businessId: businessId || undefined,
        },
      });

      for (const { file, altText } of photoFiles) {
        await uploadImage(file, "listing_photo", {
          listingId: listing.id,
          altText: altText || undefined,
        });
      }

      await navigate({ to: "/marketplace/$listingId", params: { listingId: listing.id } });
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Couldn't create the listing.");
      setCreating(false);
    }
  }

  const canCreate = title.trim().length > 0 && category.length > 0 && !creating;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-4 p-6">
      <h1 className="text-xl font-semibold">New listing</h1>

      <div className="flex gap-2">
        {(["item", "service"] as const).map((value) => (
          <Button
            key={value}
            type="button"
            size="sm"
            variant={kind === value ? "default" : "outline"}
            onClick={() => {
              setKind(value);
              setCategory("");
            }}
          >
            {value === "item" ? "Item" : "Service"}
          </Button>
        ))}
      </div>

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

      <div className="flex flex-col gap-1">
        <label htmlFor="listing-title" className="text-sm font-medium">
          Title
        </label>
        <input
          id="listing-title"
          type="text"
          value={title}
          maxLength={150}
          className="h-11 rounded-md border border-border bg-background px-3 text-sm text-foreground"
          onChange={(event) => {
            setTitle(event.target.value);
          }}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="listing-description" className="text-sm font-medium">
          Description
        </label>
        <Textarea
          id="listing-description"
          maxLength={2000}
          value={description}
          onChange={(event) => {
            setDescription(event.target.value);
          }}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="listing-category" className="text-sm font-medium">
          Category
        </label>
        <select
          id="listing-category"
          value={category}
          className="h-11 rounded-md border border-border bg-background px-3 text-sm text-foreground"
          onChange={(event) => {
            setCategory(event.target.value);
          }}
        >
          <option value="">Choose a category</option>
          {categoryOptions.map((value) => (
            <option key={value} value={value}>
              {categoryLabels[value]}
            </option>
          ))}
        </select>
      </div>

      {kind === "item" ? (
        <div className="flex flex-col gap-1">
          <label htmlFor="listing-condition" className="text-sm font-medium">
            Condition (optional)
          </label>
          <input
            id="listing-condition"
            type="text"
            value={condition}
            maxLength={50}
            placeholder="Like new, good, fair..."
            className="h-11 rounded-md border border-border bg-background px-3 text-sm text-foreground"
            onChange={(event) => {
              setCondition(event.target.value);
            }}
          />
        </div>
      ) : null}

      {!free ? (
        <div className="flex flex-col gap-1">
          <label htmlFor="listing-price" className="text-sm font-medium">
            {type === "wanted" ? "Budget (optional)" : "Price (optional)"}
          </label>
          <input
            id="listing-price"
            type="number"
            min="0"
            step="0.01"
            value={priceDollars}
            placeholder="0.00"
            className="h-11 rounded-md border border-border bg-background px-3 text-sm text-foreground"
            onChange={(event) => {
              setPriceDollars(event.target.value);
            }}
          />
          {kind === "service" ? (
            <select
              aria-label="Price model"
              value={priceUnit}
              className="h-11 rounded-md border border-border bg-background px-3 text-sm text-foreground"
              onChange={(event) => {
                setPriceUnit(event.target.value as ListingPriceUnit);
              }}
            >
              <option value="fixed">Fixed price</option>
              <option value="hourly">Hourly rate</option>
              <option value="quote">Contact for quote</option>
            </select>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-col gap-1">
        <label htmlFor="listing-area" className="text-sm font-medium">
          Pickup / service area (optional)
        </label>
        <input
          id="listing-area"
          type="text"
          value={area}
          maxLength={200}
          placeholder="Plumas Lake"
          className="h-11 rounded-md border border-border bg-background px-3 text-sm text-foreground"
          onChange={(event) => {
            setArea(event.target.value);
          }}
        />
      </div>

      {myBusinesses.length > 0 ? (
        <div className="flex flex-col gap-1">
          <label htmlFor="listing-business" className="text-sm font-medium">
            List as (optional)
          </label>
          <select
            id="listing-business"
            value={businessId}
            className="h-11 rounded-md border border-border bg-background px-3 text-sm text-foreground"
            onChange={(event) => {
              setBusinessId(event.target.value);
            }}
          >
            <option value="">Myself</option>
            {myBusinesses.map((business) => (
              <option key={business.id} value={business.id}>
                {business.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium">Photos (up to {MAX_PHOTOS})</span>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
          multiple
          className="hidden"
          onChange={(event) => {
            const files = [...(event.target.files ?? [])].slice(0, MAX_PHOTOS - photoFiles.length);
            event.target.value = "";
            setPhotoFiles((previous) =>
              [...previous, ...files.map((file) => ({ file, altText: "" }))].slice(0, MAX_PHOTOS),
            );
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-fit"
          disabled={photoFiles.length >= MAX_PHOTOS}
          onClick={() => fileInputRef.current?.click()}
        >
          {photoFiles.length > 0 ? `${photoFiles.length.toString()} selected` : "Add photos"}
        </Button>
        <StagedPhotoAltTextList files={photoFiles} onChange={setPhotoFiles} />
      </div>

      <p className="rounded-md bg-muted p-3 text-xs text-muted-foreground">
        No weapons, alcohol, tobacco/vaping, prescription drugs, animals for sale, recalled or
        counterfeit goods, adult services, or regulated work you aren&apos;t licensed for.
      </p>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <Button type="button" disabled={!canCreate} onClick={() => void handleCreate()}>
        {creating ? "Creating..." : "Add listing"}
      </Button>
    </main>
  );
}
