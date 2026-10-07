import { listUserMedia } from "@plumas/auth";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireUser } from "../auth";
import { getDb } from "../db";

export const getUserMedia = createServerFn({ method: "GET" })
  .validator(z.object({ userId: z.string().uuid() }))
  .handler(async ({ data }) => {
    await requireUser();
    return listUserMedia(getDb(), data.userId);
  });
