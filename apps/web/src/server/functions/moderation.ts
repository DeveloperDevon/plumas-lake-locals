import {
  adminDeleteContent,
  createReport,
  listAuditLog,
  listInviteTree,
  listMembersForAdmin,
  listOpenReports,
  resolveReport,
  suspendUser,
  unsuspendUser,
} from "@plumas/auth";
import {
  adminDeleteContentSchema,
  createReportSchema,
  resolveReportSchema,
  suspendUserSchema,
  unsuspendUserSchema,
} from "@plumas/validators";
import { createServerFn } from "@tanstack/react-start";

import { requireUser } from "../auth";
import { getDb } from "../db";

export const createReportFn = createServerFn({ method: "POST" })
  .validator(createReportSchema)
  .handler(async ({ data }) => {
    const user = await requireUser();
    await createReport(getDb(), { actorId: user.id, ...data });
    return { ok: true as const };
  });

export const getOpenReports = createServerFn({ method: "GET" }).handler(async () => {
  const user = await requireUser();
  return listOpenReports(getDb(), user.id);
});

export const resolveReportFn = createServerFn({ method: "POST" })
  .validator(resolveReportSchema)
  .handler(async ({ data }) => {
    const user = await requireUser();
    await resolveReport(getDb(), data.reportId, user.id);
    return { ok: true as const };
  });

export const adminDeleteContentFn = createServerFn({ method: "POST" })
  .validator(adminDeleteContentSchema)
  .handler(async ({ data }) => {
    const user = await requireUser();
    await adminDeleteContent(getDb(), data.targetType, data.targetId, user.id);
    return { ok: true as const };
  });

export const getMembersForAdmin = createServerFn({ method: "GET" }).handler(async () => {
  const user = await requireUser();
  return listMembersForAdmin(getDb(), user.id);
});

export const suspendUserFn = createServerFn({ method: "POST" })
  .validator(suspendUserSchema)
  .handler(async ({ data }) => {
    const user = await requireUser();
    await suspendUser(getDb(), data.userId, user.id);
    return { ok: true as const };
  });

export const unsuspendUserFn = createServerFn({ method: "POST" })
  .validator(unsuspendUserSchema)
  .handler(async ({ data }) => {
    const user = await requireUser();
    await unsuspendUser(getDb(), data.userId, user.id);
    return { ok: true as const };
  });

export const getInviteTree = createServerFn({ method: "GET" }).handler(async () => {
  const user = await requireUser();
  return listInviteTree(getDb(), user.id);
});

export const getAuditLog = createServerFn({ method: "GET" }).handler(async () => {
  const user = await requireUser();
  return listAuditLog(getDb(), user.id);
});
