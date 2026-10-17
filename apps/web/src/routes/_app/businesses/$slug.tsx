import type { BusinessManagerView, BusinessView } from "@plumas/auth";
import { Button, Card, CardContent, CardHeader, CardTitle, Textarea } from "@plumas/ui";
import { createFileRoute, Link, notFound, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Store } from "lucide-react";
import { useRef, useState } from "react";

import { PostCard } from "../../../components/post-card";
import { ReportToggle } from "../../../components/report-toggle";
import { startGroupConversation } from "../../../lib/dm-client";
import { mediaUrl, uploadImage } from "../../../lib/upload-image";
import {
  addManagerFn,
  createBusinessPostFn,
  getBusinessBySlugFn,
  getBusinessMediaFn,
  getBusinessPostsFn,
  getManagersFn,
  searchAddableManagersFn,
  updateBusinessFn,
} from "../../../server/functions/business";
import { getBusinessMessagingTargetFn } from "../../../server/functions/dm";

export const Route = createFileRoute("/_app/businesses/$slug")({
  loader: async ({ params }) => {
    const business = await getBusinessBySlugFn({ data: { slug: params.slug } });
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- TanStack's own notFound().
    if (!business) throw notFound();

    const [managers, posts, gallery] = await Promise.all([
      getManagersFn({ data: { businessId: business.id } }),
      getBusinessPostsFn({ data: { businessId: business.id, limit: 20 } }),
      getBusinessMediaFn({ data: { businessId: business.id } }),
    ]);

    return { business, managers, posts, gallery };
  },
  component: BusinessDetail,
  notFoundComponent: () => (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-2 p-6 text-center">
      <p className="text-lg font-medium">Business not found</p>
      <p className="text-sm text-muted-foreground">
        It may not exist, or it&apos;s been unpublished.
      </p>
      <Link to="/businesses" className="text-sm font-medium text-primary hover:underline">
        Back to businesses
      </Link>
    </main>
  ),
});

function BusinessDetail() {
  const { user } = Route.useRouteContext();
  const { slug } = Route.useParams();
  const initial = Route.useLoaderData();
  const navigate = useNavigate();

  const doGetBusinessPosts = useServerFn(getBusinessPostsFn);
  const doCreateBusinessPost = useServerFn(createBusinessPostFn);
  const doSearchAddable = useServerFn(searchAddableManagersFn);
  const doAddManager = useServerFn(addManagerFn);
  const doUpdateBusiness = useServerFn(updateBusinessFn);
  const doGetMessagingTarget = useServerFn(getBusinessMessagingTargetFn);

  const [business, setBusiness] = useState(initial.business);
  const [managers, setManagers] = useState(initial.managers);
  const [posts, setPosts] = useState(initial.posts.items);
  const [nextCursor, setNextCursor] = useState(initial.posts.nextCursor);
  const [gallery, setGallery] = useState(initial.gallery);
  const [showSettings, setShowSettings] = useState(false);
  const [showAddManager, setShowAddManager] = useState(false);
  const [uploadingGallery, setUploadingGallery] = useState(false);
  const [galleryPick, setGalleryPick] = useState<File | null>(null);
  const [galleryAltText, setGalleryAltText] = useState("");
  const [messaging, setMessaging] = useState(false);
  const [messagingError, setMessagingError] = useState<string | null>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  const isManager = business.myRole !== null;
  const isOwner = business.myRole === "owner";

  /** FR-DM-15: message this business's managers, reusing an existing thread if there is one. */
  async function handleMessageBusiness() {
    setMessaging(true);
    setMessagingError(null);
    try {
      const target = await doGetMessagingTarget({ data: { businessId: business.id } });
      const conversationId =
        target.existingConversationId ??
        (await startGroupConversation(
          user.id,
          business.name,
          target.managers.map((manager) => manager.userId),
          business.id,
        ));
      await navigate({ to: "/messages/$conversationId", params: { conversationId } });
    } catch (messageError) {
      setMessagingError(
        messageError instanceof Error ? messageError.message : "Couldn't message this business.",
      );
    } finally {
      setMessaging(false);
    }
  }

  async function refreshBusiness() {
    const fresh = await getBusinessBySlugFn({ data: { slug } });
    if (fresh) setBusiness(fresh);
    const freshManagers = await getManagersFn({ data: { businessId: business.id } });
    setManagers(freshManagers);
  }

  async function loadMorePosts() {
    if (!nextCursor) return;
    const page = await doGetBusinessPosts({
      data: { businessId: business.id, cursor: nextCursor, limit: 20 },
    });
    setPosts((previous) => [...previous, ...page.items]);
    setNextCursor(page.nextCursor);
  }

  async function refreshPosts() {
    const page = await doGetBusinessPosts({ data: { businessId: business.id, limit: 20 } });
    setPosts(page.items);
    setNextCursor(page.nextCursor);
  }

  async function refreshGallery() {
    const fresh = await getBusinessMediaFn({ data: { businessId: business.id } });
    setGallery(fresh);
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col gap-4 p-6">
      {business.unpublishedAt && isManager ? (
        <Card className="border-destructive">
          <CardContent className="pt-6 text-sm text-destructive">
            Unpublished by an admin - this page is hidden from the directory and from everyone
            except its managers. Contact the site admins if you believe this is a mistake.
          </CardContent>
        </Card>
      ) : null}

      <BusinessHeader business={business} isManager={isManager} />

      <div className="flex flex-wrap items-center gap-2">
        {isManager ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setShowSettings((v) => !v);
            }}
          >
            Settings
          </Button>
        ) : null}
        {isOwner ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              setShowAddManager((v) => !v);
            }}
          >
            Add manager
          </Button>
        ) : null}
        {!isManager ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={messaging}
            onClick={() => void handleMessageBusiness()}
          >
            {messaging ? "Opening..." : "Message this business"}
          </Button>
        ) : null}
        {!isManager ? <ReportToggle targetType="business" targetId={business.id} /> : null}
      </div>
      {messagingError ? <p className="text-sm text-destructive">{messagingError}</p> : null}

      {isOwner && showAddManager ? (
        <AddManagerPanel
          onSearch={(query) => doSearchAddable({ data: { businessId: business.id, query } })}
          onAdd={async (targetUserId) => {
            await doAddManager({ data: { businessId: business.id, targetUserId } });
            await refreshBusiness();
          }}
        />
      ) : null}

      {isManager && showSettings ? (
        <SettingsPanel
          business={business}
          managers={managers}
          onSave={async (input) => {
            await doUpdateBusiness({ data: { businessId: business.id, ...input } });
            await refreshBusiness();
          }}
        />
      ) : null}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Photos</CardTitle>
          {isManager ? (
            <>
              <input
                ref={galleryInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  setGalleryPick(file ?? null);
                  setGalleryAltText("");
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={uploadingGallery}
                onClick={() => galleryInputRef.current?.click()}
              >
                {galleryPick ? galleryPick.name : "Add photo"}
              </Button>
            </>
          ) : null}
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {galleryPick ? (
            <div className="flex items-center gap-2">
              <input
                type="text"
                placeholder="Describe this image for screen readers (optional)"
                value={galleryAltText}
                maxLength={300}
                className="h-9 flex-1 rounded-md border border-border bg-background px-2 text-sm text-foreground"
                onChange={(event) => {
                  setGalleryAltText(event.target.value);
                }}
              />
              <Button
                type="button"
                size="sm"
                disabled={uploadingGallery}
                onClick={() => {
                  setUploadingGallery(true);
                  void uploadImage(galleryPick, "business_gallery", {
                    businessId: business.id,
                    altText: galleryAltText || undefined,
                  })
                    .then(refreshGallery)
                    .then(() => {
                      setGalleryPick(null);
                      setGalleryAltText("");
                    })
                    .finally(() => {
                      setUploadingGallery(false);
                    });
                }}
              >
                {uploadingGallery ? "Uploading..." : "Upload"}
              </Button>
            </div>
          ) : null}
          {gallery.length === 0 ? (
            <p className="text-sm text-muted-foreground">No photos yet.</p>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {gallery.map((item) => (
                <img
                  key={item.id}
                  src={mediaUrl(item.r2Key, "thumbnail")}
                  alt={item.altText ?? ""}
                  className="aspect-square w-full rounded-md object-cover"
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {isManager ? (
        <ComposeBox
          onSubmit={async (body, category, files) => {
            const post = await doCreateBusinessPost({
              data: { businessId: business.id, body, category },
            });
            for (const file of files) {
              await uploadImage(file, "post", { postId: post.id });
            }
            await refreshPosts();
          }}
        />
      ) : null}

      <div className="flex flex-col gap-3">
        {posts.map((post) => (
          <PostCard
            key={post.id}
            post={post}
            currentUserId={user.id}
            isAdmin={user.role === "admin"}
            onChanged={refreshPosts}
          />
        ))}
        {posts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No posts yet on this page.</p>
        ) : null}
        {nextCursor ? (
          <Button type="button" variant="outline" onClick={() => void loadMorePosts()}>
            Load more
          </Button>
        ) : null}
      </div>
    </main>
  );
}

function BusinessHeader({ business, isManager }: { business: BusinessView; isManager: boolean }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 pt-6">
        {business.coverKey ? (
          <img
            src={mediaUrl(business.coverKey, "medium")}
            alt={business.coverAltText ?? ""}
            className="h-40 w-full rounded-md object-cover"
          />
        ) : (
          <div className="flex h-40 w-full items-center justify-center rounded-md bg-muted">
            <Store className="h-10 w-10 text-muted-foreground" />
          </div>
        )}
        <div className="flex items-center gap-3">
          {business.logoKey ? (
            <img
              src={mediaUrl(business.logoKey, "thumbnail")}
              alt={business.logoAltText ?? ""}
              className="h-12 w-12 shrink-0 rounded-md object-cover"
            />
          ) : null}
          <div>
            <h1 className="text-xl font-semibold">{business.name}</h1>
            {business.category ? (
              <p className="text-xs text-muted-foreground">{business.category}</p>
            ) : null}
          </div>
        </div>
        {business.description ? <p className="text-sm">{business.description}</p> : null}
        <p className="text-xs text-muted-foreground">Serves: {business.serviceArea}</p>
        {business.hours ? (
          <p className="text-xs text-muted-foreground">Hours: {business.hours}</p>
        ) : null}
        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
          {business.phone ? <span>{business.phone}</span> : null}
          {business.email ? <span>{business.email}</span> : null}
          {business.website ? <span>{business.website}</span> : null}
        </div>
        {isManager ? <p className="text-xs text-muted-foreground">You manage this page</p> : null}
      </CardContent>
    </Card>
  );
}

function ComposeBox({
  onSubmit,
}: {
  onSubmit: (body: string, category: undefined, files: File[]) => Promise<void>;
}) {
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 pt-6">
        <Textarea
          maxLength={5000}
          placeholder="Post something to this page..."
          value={body}
          onChange={(event) => {
            setBody(event.target.value);
          }}
        />
        <div className="flex items-center gap-3">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
            multiple
            className="hidden"
            onChange={(event) => {
              const selected = Array.from(event.target.files ?? []).slice(0, 10);
              event.target.value = "";
              setFiles(selected);
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
          >
            {files.length > 0 ? `${files.length.toString()} image(s) selected` : "Add images"}
          </Button>
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <Button
          type="button"
          disabled={!body.trim() || posting}
          onClick={() => {
            setPosting(true);
            setError(null);
            void onSubmit(body, undefined, files)
              .then(() => {
                setBody("");
                setFiles([]);
              })
              .catch((postError: unknown) => {
                setError(postError instanceof Error ? postError.message : "Couldn't post.");
              })
              .finally(() => {
                setPosting(false);
              });
          }}
        >
          {posting ? "Posting..." : "Post"}
        </Button>
      </CardContent>
    </Card>
  );
}

function AddManagerPanel({
  onSearch,
  onAdd,
}: {
  onSearch: (
    query: string,
  ) => Promise<{ id: string; displayName: string; avatarKey: string | null }[]>;
  onAdd: (targetUserId: string) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<
    { id: string; displayName: string; avatarKey: string | null }[]
  >([]);
  const [added, setAdded] = useState<Set<string>>(new Set());

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add a co-manager</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <input
          type="text"
          placeholder="Search members by name..."
          value={query}
          className="h-10 rounded-md border border-border bg-background px-3 text-sm text-foreground"
          onChange={(event) => {
            const value = event.target.value;
            setQuery(value);
            void onSearch(value).then(setResults);
          }}
        />
        {results.map((result) => (
          <div key={result.id} className="flex items-center justify-between gap-2">
            <span className="text-sm">{result.displayName}</span>
            <Button
              type="button"
              size="sm"
              disabled={added.has(result.id)}
              onClick={() => {
                void onAdd(result.id).then(() => {
                  setAdded((previous) => new Set(previous).add(result.id));
                });
              }}
            >
              {added.has(result.id) ? "Added" : "Add"}
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function SettingsPanel({
  business,
  managers,
  onSave,
}: {
  business: BusinessView;
  managers: BusinessManagerView[];
  onSave: (input: {
    name: string;
    description?: string | undefined;
    category?: string | undefined;
    serviceArea: string;
    hours?: string | undefined;
    phone?: string | undefined;
    email?: string | undefined;
    website?: string | undefined;
  }) => Promise<void>;
}) {
  const [name, setName] = useState(business.name);
  const [description, setDescription] = useState(business.description ?? "");
  const [category, setCategory] = useState(business.category ?? "");
  const [serviceArea, setServiceArea] = useState(business.serviceArea);
  const [hours, setHours] = useState(business.hours ?? "");
  const [phone, setPhone] = useState(business.phone ?? "");
  const [email, setEmail] = useState(business.email ?? "");
  const [website, setWebsite] = useState(business.website ?? "");
  const [saving, setSaving] = useState(false);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Page settings</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <input
          type="text"
          value={name}
          maxLength={100}
          className="h-10 rounded-md border border-border bg-background px-3 text-sm text-foreground"
          onChange={(event) => {
            setName(event.target.value);
          }}
        />
        <Textarea
          maxLength={2000}
          value={description}
          onChange={(event) => {
            setDescription(event.target.value);
          }}
        />
        <input
          type="text"
          value={category}
          maxLength={50}
          placeholder="Category"
          className="h-10 rounded-md border border-border bg-background px-3 text-sm text-foreground"
          onChange={(event) => {
            setCategory(event.target.value);
          }}
        />
        <input
          type="text"
          value={serviceArea}
          maxLength={200}
          placeholder="Service area"
          className="h-10 rounded-md border border-border bg-background px-3 text-sm text-foreground"
          onChange={(event) => {
            setServiceArea(event.target.value);
          }}
        />
        <input
          type="text"
          value={hours}
          maxLength={200}
          placeholder="Hours"
          className="h-10 rounded-md border border-border bg-background px-3 text-sm text-foreground"
          onChange={(event) => {
            setHours(event.target.value);
          }}
        />
        <input
          type="tel"
          value={phone}
          maxLength={30}
          placeholder="Phone"
          className="h-10 rounded-md border border-border bg-background px-3 text-sm text-foreground"
          onChange={(event) => {
            setPhone(event.target.value);
          }}
        />
        <input
          type="email"
          value={email}
          placeholder="Email"
          className="h-10 rounded-md border border-border bg-background px-3 text-sm text-foreground"
          onChange={(event) => {
            setEmail(event.target.value);
          }}
        />
        <input
          type="url"
          value={website}
          maxLength={200}
          placeholder="Website"
          className="h-10 rounded-md border border-border bg-background px-3 text-sm text-foreground"
          onChange={(event) => {
            setWebsite(event.target.value);
          }}
        />
        <Button
          type="button"
          size="sm"
          disabled={saving || !name.trim() || !serviceArea.trim()}
          onClick={() => {
            setSaving(true);
            void onSave({
              name: name.trim(),
              description: description.trim() || undefined,
              category: category.trim() || undefined,
              serviceArea: serviceArea.trim(),
              hours: hours.trim() || undefined,
              phone: phone.trim() || undefined,
              email: email.trim() || undefined,
              website: website.trim() || undefined,
            }).finally(() => {
              setSaving(false);
            });
          }}
        >
          Save
        </Button>

        <div className="flex flex-col gap-1 border-t border-border pt-3">
          <p className="text-sm font-medium">Managers</p>
          {managers.map((manager) => (
            <p key={manager.userId} className="text-sm text-muted-foreground">
              {manager.displayName} ({manager.role})
            </p>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
