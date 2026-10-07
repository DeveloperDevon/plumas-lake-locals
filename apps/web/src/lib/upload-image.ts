import { MAX_UPLOAD_BYTES } from "@plumas/validators";
import { heicTo, isHeic } from "heic-to";

/**
 * HEIC is converted client-side before upload - @cf-wasm/photon (server-side) decodes via
 * Rust's `image` crate, which has no HEIC support (confirmed during task #16's spike), and
 * HEIC is iPhone's default camera format, so this isn't an edge case to skip.
 *
 * The 15MB check runs on the *converted* bytes, not the original - HEIC's whole advantage is
 * better compression, so a HEIC file under the limit can convert to a JPEG that isn't.
 */
async function prepareImageFile(file: File): Promise<File> {
  let prepared = file;
  if (await isHeic(file)) {
    const converted = await heicTo({ blob: file, type: "image/jpeg", quality: 0.92 });
    prepared = new File([converted], file.name.replace(/\.hei[cf]$/i, ".jpg"), {
      type: "image/jpeg",
    });
  }
  if (prepared.size > MAX_UPLOAD_BYTES) {
    throw new Error("That file is over the 15MB limit.");
  }
  return prepared;
}

export interface UploadResult {
  ok: true;
  mediaId: string;
  r2KeyPrefix: string;
}

export async function uploadImage(
  file: File,
  purpose: "avatar" | "cover" | "gallery",
): Promise<UploadResult> {
  const prepared = await prepareImageFile(file);

  const form = new FormData();
  form.append("file", prepared);
  form.append("purpose", purpose);

  const response = await fetch("/api/media/upload", { method: "POST", body: form });
  const result: unknown = await response.json();
  if (
    !response.ok ||
    typeof result !== "object" ||
    result === null ||
    !("ok" in result) ||
    !result.ok
  ) {
    const message =
      result &&
      typeof result === "object" &&
      "message" in result &&
      typeof result.message === "string"
        ? result.message
        : "Upload failed.";
    throw new Error(message);
  }
  return result as UploadResult;
}

/** The URL an uploaded image's variant is served from - see apps/web/src/routes/api/media/$.ts. */
export function mediaUrl(
  r2KeyPrefix: string,
  variant: "thumbnail" | "medium" | "original",
): string {
  const ext = variant === "original" ? "jpg" : "webp";
  return `/api/media/${r2KeyPrefix}/${variant}.${ext}`;
}
