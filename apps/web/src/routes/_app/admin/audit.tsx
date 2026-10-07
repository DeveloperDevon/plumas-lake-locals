import { createFileRoute } from "@tanstack/react-router";

import { formatDateTime } from "../../../lib/format-date";
import { getAuditLog } from "../../../server/functions/moderation";

export const Route = createFileRoute("/_app/admin/audit")({
  loader: async () => ({ entries: await getAuditLog() }),
  component: AuditLog,
});

const actionLabels: Record<string, string> = {
  resolve_report: "Resolved a report",
  suspend_user: "Suspended a member",
  unsuspend_user: "Unsuspended a member",
  delete_content: "Deleted content",
};

function AuditLog() {
  const { entries } = Route.useLoaderData();

  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">No admin actions yet.</p>;
  }

  return (
    <ul className="flex flex-col gap-2">
      {entries.map((entry) => (
        <li
          key={entry.id}
          className="flex items-center justify-between gap-2 rounded-md border border-border p-3 text-sm"
        >
          <span>
            {entry.actorDisplayName} · {actionLabels[entry.action] ?? entry.action} ·{" "}
            <span className="text-muted-foreground">
              {entry.targetType} {entry.targetId.slice(0, 8)}
            </span>
          </span>
          <span className="text-xs text-muted-foreground">{formatDateTime(entry.createdAt)}</span>
        </li>
      ))}
    </ul>
  );
}
