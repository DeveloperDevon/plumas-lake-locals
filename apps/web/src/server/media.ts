import { PhotonImage, resize, SamplingFilter } from "@cf-wasm/photon";
import { env } from "cloudflare:workers";

// Keeps EXIF/GPS off every variant - not a filter step, a structural guarantee: PhotonImage
// only ever stores raw pixels (confirmed by reading its own source), so there's no field for
// metadata to survive decode into in the first place, regardless of what the input carried.

const MAX_DECODED_PIXELS = 50_000_000; // ~50MP - a generous cap against a corrupt/huge input.

function resizedVariantWebp(decoded: PhotonImage, maxDimension: number): Uint8Array {
  const width = decoded.get_width();
  const height = decoded.get_height();
  if (Math.max(width, height) <= maxDimension) {
    return decoded.get_bytes_webp();
  }
  const scale = maxDimension / Math.max(width, height);
  const resized = resize(
    decoded,
    Math.round(width * scale),
    Math.round(height * scale),
    SamplingFilter.Lanczos3,
  );
  const bytes = resized.get_bytes_webp();
  resized.free();
  return bytes;
}

export interface ProcessedImage {
  r2KeyPrefix: string;
  width: number;
  height: number;
}

/**
 * Decodes the uploaded bytes, produces thumbnail (320px)/medium (1080px)/original variants,
 * and stores all three in R2 under `media/{mediaId}/*`. The "original" variant is lossy JPEG,
 * not WebP - @cf-wasm/photon's get_bytes_webp() has no quality parameter (lossless only,
 * confirmed by spiking it), which made full-resolution WebP *larger* than the source on real
 * test images; thumbnail/medium stay WebP since the lossless overhead is small at those sizes.
 */
export async function processAndStoreImage(
  bytes: Uint8Array,
  mediaId: string,
): Promise<ProcessedImage> {
  let decoded: PhotonImage;
  try {
    decoded = PhotonImage.new_from_byteslice(bytes);
  } catch {
    throw new Error("Could not read that image. Try a JPEG, PNG, or WebP file.");
  }

  const width = decoded.get_width();
  const height = decoded.get_height();
  if (width * height > MAX_DECODED_PIXELS) {
    decoded.free();
    throw new Error("That image's dimensions are too large.");
  }

  const thumbnail = resizedVariantWebp(decoded, 320);
  const medium = resizedVariantWebp(decoded, 1080);
  const original = decoded.get_bytes_jpeg(90);
  decoded.free();

  const r2KeyPrefix = `media/${mediaId}`;
  const bucket = env.MEDIA_BUCKET;
  await Promise.all([
    bucket.put(`${r2KeyPrefix}/thumbnail.webp`, thumbnail, {
      httpMetadata: { contentType: "image/webp" },
    }),
    bucket.put(`${r2KeyPrefix}/medium.webp`, medium, {
      httpMetadata: { contentType: "image/webp" },
    }),
    bucket.put(`${r2KeyPrefix}/original.jpg`, original, {
      httpMetadata: { contentType: "image/jpeg" },
    }),
  ]);

  return { r2KeyPrefix, width, height };
}
