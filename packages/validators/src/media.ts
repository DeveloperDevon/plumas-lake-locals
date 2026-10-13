import { z } from "zod";

/** FR-PRO-03: 15MB per upload, enforced both client-side (before upload) and server-side. */
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

export const mediaPurposes = [
  "avatar",
  "cover",
  "gallery",
  "post",
  "group_cover",
  "business_logo",
  "business_cover",
  "business_gallery",
  "event_cover",
  "listing_photo",
] as const;
export type MediaPurpose = (typeof mediaPurposes)[number];
export const mediaPurposeSchema = z.enum(mediaPurposes);
