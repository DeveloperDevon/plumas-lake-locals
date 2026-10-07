import {
  countPostMedia,
  createMedia,
  getOwnedPost,
  PostForbiddenError,
  PostNotFoundError,
  setUserAvatar,
  setUserCover,
} from "@plumas/auth";
import { MAX_POST_IMAGES, MAX_UPLOAD_BYTES, mediaPurposeSchema } from "@plumas/validators";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { requireUser } from "../../../server/auth";
import { getDb } from "../../../server/db";
import { processAndStoreImage } from "../../../server/media";

/**
 * A plain fetch-handler route, not a createServerFn RPC - file bytes don't fit a
 * zod-validated JSON payload. Mirrors the api/auth/$.ts raw-route pattern.
 */
export const Route = createFileRoute("/api/media/upload")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const user = await requireUser();

        const form = await request.formData();
        const file = form.get("file");
        if (!(file instanceof File)) {
          return Response.json({ ok: false, message: "No file provided." }, { status: 400 });
        }
        if (file.size > MAX_UPLOAD_BYTES) {
          return Response.json(
            { ok: false, message: "That file is over the 15MB limit." },
            { status: 400 },
          );
        }

        const purposeResult = mediaPurposeSchema.safeParse(form.get("purpose"));
        if (!purposeResult.success) {
          return Response.json({ ok: false, message: "Invalid upload purpose." }, { status: 400 });
        }
        const purpose = purposeResult.data;
        const db = getDb();

        // Checked before the (comparatively expensive) image processing step, so a doomed
        // upload fails fast rather than burning Photon CPU time first.
        let postId: string | undefined;
        if (purpose === "post") {
          const postIdResult = z.string().uuid().safeParse(form.get("postId"));
          if (!postIdResult.success) {
            return Response.json({ ok: false, message: "Missing postId." }, { status: 400 });
          }
          postId = postIdResult.data;
          try {
            await getOwnedPost(db, postId, user.id);
          } catch (error) {
            if (error instanceof PostNotFoundError || error instanceof PostForbiddenError) {
              return Response.json({ ok: false, message: error.message }, { status: 403 });
            }
            throw error;
          }
          const existingCount = await countPostMedia(db, postId);
          if (existingCount >= MAX_POST_IMAGES) {
            return Response.json(
              {
                ok: false,
                message: `A post can have at most ${MAX_POST_IMAGES.toString()} images.`,
              },
              { status: 400 },
            );
          }
        }

        const bytes = new Uint8Array(await file.arrayBuffer());
        const mediaId = crypto.randomUUID();

        let processed;
        try {
          processed = await processAndStoreImage(bytes, mediaId);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Could not process that image.";
          return Response.json({ ok: false, message }, { status: 400 });
        }

        const mediaRow = await createMedia(db, {
          id: mediaId,
          ownerId: user.id,
          r2Key: processed.r2KeyPrefix,
          width: processed.width,
          height: processed.height,
          postId: postId ?? null,
        });

        if (purpose === "avatar") {
          await setUserAvatar(db, user.id, processed.r2KeyPrefix);
        } else if (purpose === "cover") {
          await setUserCover(db, user.id, processed.r2KeyPrefix);
        }

        return Response.json({
          ok: true,
          mediaId: mediaRow.id,
          r2KeyPrefix: processed.r2KeyPrefix,
        });
      },
    },
  },
});
