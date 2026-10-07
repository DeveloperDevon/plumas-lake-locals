import { type Database, schema } from "@plumas/db";
import type { AdminDeleteTargetType, ReportReason, ReportTargetType } from "@plumas/validators";
import { desc, eq, inArray, isNull } from "drizzle-orm";

const { auditLog, comments, posts, reports, users } = schema;

export class ModerationNotFoundError extends Error {
  constructor(message = "That no longer exists.") {
    super(message);
  }
}

export class ModerationForbiddenError extends Error {
  constructor(message = "Admins only.") {
    super(message);
  }
}

async function requireAdmin(database: Database, actingUserId: string) {
  const [actingUser] = await database.select().from(users).where(eq(users.id, actingUserId));
  if (actingUser?.role !== "admin") throw new ModerationForbiddenError();
}

async function writeAuditLog(
  database: Database,
  entry: {
    action: string;
    targetType: string;
    targetId: string;
    actorId: string;
    details?: unknown;
  },
) {
  await database.insert(auditLog).values({
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId,
    actorId: entry.actorId,
    details: entry.details ?? null,
  });
}

export interface CreateReportInput {
  actorId: string;
  targetType: ReportTargetType;
  targetId: string;
  reason: ReportReason;
  details?: string | undefined;
}

/** FR-MOD-01: no target-existence check - a report about since-deleted content is still
 * useful triage information for an admin, not an error. */
export async function createReport(database: Database, input: CreateReportInput) {
  const [row] = await database
    .insert(reports)
    .values({
      targetType: input.targetType,
      targetId: input.targetId,
      reason: input.reason,
      actorId: input.actorId,
      details: input.details ?? null,
    })
    .returning();
  if (!row) throw new Error("Failed to create report");
  return row;
}

export interface OpenReportView {
  id: string;
  targetType: string;
  targetId: string;
  reason: string;
  details: string | null;
  reporterDisplayName: string;
  preview: string | null;
  createdAt: Date;
}

/** FR-MOD-02: the report queue, with a lightweight preview per target type so an admin can
 * triage without permalink pages that don't exist yet. */
export async function listOpenReports(
  database: Database,
  viewerId: string,
): Promise<OpenReportView[]> {
  await requireAdmin(database, viewerId);

  const rows = await database
    .select()
    .from(reports)
    .where(isNull(reports.resolvedAt))
    .orderBy(desc(reports.createdAt));
  if (rows.length === 0) return [];

  const reporterIds = rows.map((row) => row.actorId);
  const reporters = await database
    .select({ id: users.id, displayName: users.displayName })
    .from(users)
    .where(inArray(users.id, reporterIds));
  const reporterById = new Map(reporters.map((user) => [user.id, user.displayName]));

  const postIds = rows.filter((row) => row.targetType === "post").map((row) => row.targetId);
  const commentIds = rows.filter((row) => row.targetType === "comment").map((row) => row.targetId);
  const profileIds = rows.filter((row) => row.targetType === "profile").map((row) => row.targetId);

  const [postRows, commentRows, profileRows] = await Promise.all([
    postIds.length > 0
      ? database
          .select({ id: posts.id, body: posts.body })
          .from(posts)
          .where(inArray(posts.id, postIds))
      : Promise.resolve([]),
    commentIds.length > 0
      ? database
          .select({ id: comments.id, body: comments.body })
          .from(comments)
          .where(inArray(comments.id, commentIds))
      : Promise.resolve([]),
    profileIds.length > 0
      ? database
          .select({ id: users.id, displayName: users.displayName })
          .from(users)
          .where(inArray(users.id, profileIds))
      : Promise.resolve([]),
  ]);
  const postBodyById = new Map(postRows.map((row) => [row.id, row.body]));
  const commentBodyById = new Map(commentRows.map((row) => [row.id, row.body]));
  const profileNameById = new Map(profileRows.map((row) => [row.id, row.displayName]));

  return rows.map((row) => {
    let preview: string | null = null;
    if (row.targetType === "post") preview = postBodyById.get(row.targetId) ?? null;
    else if (row.targetType === "comment") preview = commentBodyById.get(row.targetId) ?? null;
    else if (row.targetType === "profile") preview = profileNameById.get(row.targetId) ?? null;

    return {
      id: row.id,
      targetType: row.targetType,
      targetId: row.targetId,
      reason: row.reason,
      details: row.details as string | null,
      reporterDisplayName: reporterById.get(row.actorId) ?? "Unknown member",
      preview,
      createdAt: row.createdAt,
    };
  });
}

export async function resolveReport(database: Database, reportId: string, actingAdminId: string) {
  await requireAdmin(database, actingAdminId);

  const [row] = await database
    .update(reports)
    .set({ resolvedAt: new Date() })
    .where(eq(reports.id, reportId))
    .returning();
  if (!row) throw new ModerationNotFoundError();

  await writeAuditLog(database, {
    action: "resolve_report",
    targetType: "report",
    targetId: reportId,
    actorId: actingAdminId,
  });
  return row;
}

export async function suspendUser(database: Database, userId: string, actingAdminId: string) {
  await requireAdmin(database, actingAdminId);

  const [row] = await database
    .update(users)
    .set({ status: "suspended" })
    .where(eq(users.id, userId))
    .returning();
  if (!row) throw new ModerationNotFoundError();

  await writeAuditLog(database, {
    action: "suspend_user",
    targetType: "user",
    targetId: userId,
    actorId: actingAdminId,
  });
  return row;
}

export async function unsuspendUser(database: Database, userId: string, actingAdminId: string) {
  await requireAdmin(database, actingAdminId);

  const [row] = await database
    .update(users)
    .set({ status: "active" })
    .where(eq(users.id, userId))
    .returning();
  if (!row) throw new ModerationNotFoundError();

  await writeAuditLog(database, {
    action: "unsuspend_user",
    targetType: "user",
    targetId: userId,
    actorId: actingAdminId,
  });
  return row;
}

/** Bypasses the author-only check in post-service.ts's/comment-service.ts's own delete
 * functions - those stay as the owner-facing path, this is the admin override. */
export async function adminDeleteContent(
  database: Database,
  targetType: AdminDeleteTargetType,
  targetId: string,
  actingAdminId: string,
) {
  await requireAdmin(database, actingAdminId);

  const table = targetType === "post" ? posts : comments;
  const [row] = await database
    .update(table)
    .set({ deletedAt: new Date() })
    .where(eq(table.id, targetId))
    .returning();
  if (!row) throw new ModerationNotFoundError();

  await writeAuditLog(database, {
    action: "delete_content",
    targetType,
    targetId,
    actorId: actingAdminId,
  });
  return row;
}

export interface MemberView {
  id: string;
  displayName: string;
  email: string;
  role: string;
  status: string;
  createdAt: Date;
  inviterDisplayName: string | null;
}

export async function listMembersForAdmin(
  database: Database,
  viewerId: string,
): Promise<MemberView[]> {
  await requireAdmin(database, viewerId);

  const rows = await database.select().from(users).orderBy(desc(users.createdAt));
  const inviterIds = rows.map((row) => row.invitedBy).filter((id): id is string => id !== null);
  const inviters =
    inviterIds.length > 0
      ? await database
          .select({ id: users.id, displayName: users.displayName })
          .from(users)
          .where(inArray(users.id, inviterIds))
      : [];
  const inviterById = new Map(inviters.map((user) => [user.id, user.displayName]));

  return rows.map((row) => ({
    id: row.id,
    displayName: row.displayName,
    email: row.email,
    role: row.role,
    status: row.status,
    createdAt: row.createdAt,
    inviterDisplayName: row.invitedBy ? (inviterById.get(row.invitedBy) ?? null) : null,
  }));
}

export interface InviteTreeNode {
  id: string;
  displayName: string;
  email: string;
  children: InviteTreeNode[];
}

/** FR-MOD-02: "if a spam account appears, the admin can see who invited it." */
export async function listInviteTree(
  database: Database,
  viewerId: string,
): Promise<InviteTreeNode[]> {
  await requireAdmin(database, viewerId);

  const rows = await database
    .select({
      id: users.id,
      displayName: users.displayName,
      email: users.email,
      invitedBy: users.invitedBy,
    })
    .from(users);

  const nodeById = new Map(
    rows.map((row) => [row.id, { ...row, children: [] as InviteTreeNode[] }]),
  );
  const roots: InviteTreeNode[] = [];
  for (const row of rows) {
    const node = nodeById.get(row.id);
    if (!node) continue;
    if (row.invitedBy && nodeById.has(row.invitedBy)) {
      nodeById.get(row.invitedBy)?.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

export interface AuditLogView {
  id: string;
  action: string;
  targetType: string;
  targetId: string;
  actorDisplayName: string;
  createdAt: Date;
}

export async function listAuditLog(
  database: Database,
  viewerId: string,
  limit = 50,
): Promise<AuditLogView[]> {
  await requireAdmin(database, viewerId);

  const rows = await database
    .select()
    .from(auditLog)
    .orderBy(desc(auditLog.createdAt))
    .limit(limit);
  if (rows.length === 0) return [];

  const actorIds = rows.map((row) => row.actorId);
  const actors = await database
    .select({ id: users.id, displayName: users.displayName })
    .from(users)
    .where(inArray(users.id, actorIds));
  const actorById = new Map(actors.map((user) => [user.id, user.displayName]));

  return rows.map((row) => ({
    id: row.id,
    action: row.action,
    targetType: row.targetType,
    targetId: row.targetId,
    actorDisplayName: actorById.get(row.actorId) ?? "Unknown admin",
    createdAt: row.createdAt,
  }));
}
