import { Button, Textarea } from "@plumas/ui";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";

import { uploadImage } from "../../../lib/upload-image";
import { createBusinessFn } from "../../../server/functions/business";

export const Route = createFileRoute("/_app/businesses/new")({
  component: NewBusiness,
});

function NewBusiness() {
  const navigate = useNavigate();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [serviceArea, setServiceArea] = useState("");
  const [hours, setHours] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoAltText, setLogoAltText] = useState("");
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverAltText, setCoverAltText] = useState("");
  const logoInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    setCreating(true);
    setError(null);
    try {
      const business = await createBusinessFn({
        data: {
          name: name.trim(),
          description: description.trim() || undefined,
          category: category.trim() || undefined,
          serviceArea: serviceArea.trim(),
          hours: hours.trim() || undefined,
          phone: phone.trim() || undefined,
          email: email.trim() || undefined,
          website: website.trim() || undefined,
          confirmsServesPlumasLake: true,
        },
      });
      if (logoFile) {
        await uploadImage(logoFile, "business_logo", {
          businessId: business.id,
          altText: logoAltText || undefined,
        });
      }
      if (coverFile) {
        await uploadImage(coverFile, "business_cover", {
          businessId: business.id,
          altText: coverAltText || undefined,
        });
      }
      await navigate({ to: "/businesses/$slug", params: { slug: business.slug } });
    } catch (createError) {
      setError(
        createError instanceof Error ? createError.message : "Couldn't create the business page.",
      );
      setCreating(false);
    }
  }

  const canCreate =
    name.trim().length > 0 && serviceArea.trim().length > 0 && confirmed && !creating;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-4 p-6">
      <h1 className="text-xl font-semibold">Create a business page</h1>

      <div className="flex flex-col gap-1">
        <label htmlFor="biz-name" className="text-sm font-medium">
          Name
        </label>
        <input
          id="biz-name"
          type="text"
          value={name}
          maxLength={100}
          placeholder="Sam's Mobile Grooming"
          className="h-11 rounded-md border border-border bg-background px-3 text-sm text-foreground"
          onChange={(event) => {
            setName(event.target.value);
          }}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="biz-description" className="text-sm font-medium">
          Description
        </label>
        <Textarea
          id="biz-description"
          maxLength={2000}
          value={description}
          onChange={(event) => {
            setDescription(event.target.value);
          }}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="biz-category" className="text-sm font-medium">
          Category
        </label>
        <input
          id="biz-category"
          type="text"
          value={category}
          maxLength={50}
          placeholder="Pet care, Food, Home services..."
          className="h-11 rounded-md border border-border bg-background px-3 text-sm text-foreground"
          onChange={(event) => {
            setCategory(event.target.value);
          }}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="biz-service-area" className="text-sm font-medium">
          Service area
        </label>
        <input
          id="biz-service-area"
          type="text"
          value={serviceArea}
          maxLength={200}
          placeholder="Plumas Lake and surrounding area"
          className="h-11 rounded-md border border-border bg-background px-3 text-sm text-foreground"
          onChange={(event) => {
            setServiceArea(event.target.value);
          }}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="biz-hours" className="text-sm font-medium">
          Hours
        </label>
        <input
          id="biz-hours"
          type="text"
          value={hours}
          maxLength={200}
          placeholder="Mon-Fri 9am-5pm"
          className="h-11 rounded-md border border-border bg-background px-3 text-sm text-foreground"
          onChange={(event) => {
            setHours(event.target.value);
          }}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="biz-phone" className="text-sm font-medium">
          Phone
        </label>
        <input
          id="biz-phone"
          type="tel"
          value={phone}
          maxLength={30}
          className="h-11 rounded-md border border-border bg-background px-3 text-sm text-foreground"
          onChange={(event) => {
            setPhone(event.target.value);
          }}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="biz-email" className="text-sm font-medium">
          Email
        </label>
        <input
          id="biz-email"
          type="email"
          value={email}
          className="h-11 rounded-md border border-border bg-background px-3 text-sm text-foreground"
          onChange={(event) => {
            setEmail(event.target.value);
          }}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="biz-website" className="text-sm font-medium">
          Website
        </label>
        <input
          id="biz-website"
          type="url"
          value={website}
          maxLength={200}
          className="h-11 rounded-md border border-border bg-background px-3 text-sm text-foreground"
          onChange={(event) => {
            setWebsite(event.target.value);
          }}
        />
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium">Logo</span>
        <input
          ref={logoInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            setLogoFile(file ?? null);
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-fit"
          onClick={() => logoInputRef.current?.click()}
        >
          {logoFile ? logoFile.name : "Add a logo"}
        </Button>
        {logoFile ? (
          <input
            type="text"
            placeholder="Describe this image for screen readers (optional)"
            value={logoAltText}
            maxLength={300}
            className="h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground"
            onChange={(event) => {
              setLogoAltText(event.target.value);
            }}
          />
        ) : null}
      </div>

      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium">Cover photo</span>
        <input
          ref={coverInputRef}
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
          onClick={() => coverInputRef.current?.click()}
        >
          {coverFile ? coverFile.name : "Add a cover photo"}
        </Button>
        {coverFile ? (
          <input
            type="text"
            placeholder="Describe this image for screen readers (optional)"
            value={coverAltText}
            maxLength={300}
            className="h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground"
            onChange={(event) => {
              setCoverAltText(event.target.value);
            }}
          />
        ) : null}
      </div>

      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={confirmed}
          className="mt-1"
          onChange={(event) => {
            setConfirmed(event.target.checked);
          }}
        />
        I confirm this business is located in or regularly serves Plumas Lake.
      </label>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <Button type="button" disabled={!canCreate} onClick={() => void handleCreate()}>
        {creating ? "Creating..." : "Create page"}
      </Button>
    </main>
  );
}
