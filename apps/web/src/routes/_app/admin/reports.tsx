import { Button, Card, CardContent } from "@plumas/ui";
import type { AdminDeleteTargetType } from "@plumas/validators";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";

import { formatDateTime } from "../../../lib/format-date";
import {
  adminDeleteContentFn,
  getOpenReports,
  republishBusinessFn,
  resolveReportFn,
  unpublishBusinessFn,
} from "../../../server/functions/moderation";

export const Route = createFileRoute("/_app/admin/reports")({
  loader: async () => ({ reports: await getOpenReports() }),
  component: Reports,
});

const reasonLabels: Record<string, string> = {
  spam: "Spam",
  harassment: "Harassment",
  under_18: "Under 18",
  inappropriate: "Inappropriate",
  doesnt_serve_plumas_lake: "Doesn't serve Plumas Lake",
  other: "Other",
};

function Reports() {
  const { reports } = Route.useLoaderData();
  const router = useRouter();
  const doResolve = useServerFn(resolveReportFn);
  const doDelete = useServerFn(adminDeleteContentFn);
  const doUnpublish = useServerFn(unpublishBusinessFn);
  const doRepublish = useServerFn(republishBusinessFn);
  const [busyId, setBusyId] = useState<string | null>(null);

  function run(id: string, action: Promise<unknown>) {
    setBusyId(id);
    void action.finally(() => {
      setBusyId(null);
      void router.invalidate();
    });
  }

  if (reports.length === 0) {
    return <p className="text-sm text-muted-foreground">No open reports.</p>;
  }

  return (
    <ul className="flex flex-col gap-3">
      {reports.map((report) => (
        <li key={report.id}>
          <Card>
            <CardContent className="flex flex-col gap-2 pt-6 text-sm">
              <div className="flex items-center justify-between">
                <span className="font-medium">
                  {report.targetType} · {reasonLabels[report.reason] ?? report.reason}
                </span>
                <span className="text-xs text-muted-foreground">
                  {formatDateTime(report.createdAt)}
                </span>
              </div>
              <p className="text-muted-foreground">Reported by {report.reporterDisplayName}</p>
              {report.preview ? (
                <p className="whitespace-pre-wrap rounded-md bg-muted p-2">{report.preview}</p>
              ) : (
                <p className="italic text-muted-foreground">Content no longer available.</p>
              )}
              {report.details ? (
                <p className="text-muted-foreground">&ldquo;{report.details}&rdquo;</p>
              ) : null}
              <div className="flex gap-2 pt-1">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busyId === report.id}
                  onClick={() => {
                    run(report.id, doResolve({ data: { reportId: report.id } }));
                  }}
                >
                  Resolve
                </Button>
                {report.targetType === "post" || report.targetType === "comment" ? (
                  <DeleteContentButton
                    targetType={report.targetType}
                    targetId={report.targetId}
                    busy={busyId === report.id}
                    onClick={(targetType, targetId) => {
                      run(report.id, doDelete({ data: { targetType, targetId } }));
                    }}
                  />
                ) : null}
                {report.targetType === "business" ? (
                  <>
                    <Button
                      type="button"
                      size="sm"
                      variant="destructive"
                      disabled={busyId === report.id}
                      onClick={() => {
                        run(report.id, doUnpublish({ data: { businessId: report.targetId } }));
                      }}
                    >
                      Unpublish business
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={busyId === report.id}
                      onClick={() => {
                        run(report.id, doRepublish({ data: { businessId: report.targetId } }));
                      }}
                    >
                      Republish
                    </Button>
                  </>
                ) : null}
              </div>
            </CardContent>
          </Card>
        </li>
      ))}
    </ul>
  );
}

function DeleteContentButton({
  targetType,
  targetId,
  busy,
  onClick,
}: {
  targetType: AdminDeleteTargetType;
  targetId: string;
  busy: boolean;
  onClick: (targetType: AdminDeleteTargetType, targetId: string) => void;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant="destructive"
      disabled={busy}
      onClick={() => {
        onClick(targetType, targetId);
      }}
    >
      Delete content
    </Button>
  );
}
