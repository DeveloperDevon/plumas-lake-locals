import type { ReportReason, ReportTargetType } from "@plumas/validators";
import { reportReasons } from "@plumas/validators";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";

import { createReportFn } from "../server/functions/moderation";

const reportReasonLabels: Record<ReportReason, string> = {
  spam: "Spam",
  harassment: "Harassment",
  under_18: "Under 18",
  inappropriate: "Inappropriate",
  doesnt_serve_plumas_lake: "Doesn't serve Plumas Lake",
  other: "Other",
};

/** FR-MOD-01: inline report toggle reused wherever a post, comment or profile is shown to a
 * non-owner - same toggle-open-a-small-form convention as Reply/Edit elsewhere in the app. */
export function ReportToggle({
  targetType,
  targetId,
}: {
  targetType: ReportTargetType;
  targetId: string;
}) {
  const doReport = useServerFn(createReportFn);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ReportReason>("spam");
  const [details, setDetails] = useState("");
  const [state, setState] = useState<"idle" | "submitting" | "done" | "error">("idle");

  if (state === "done") {
    return <span className="text-xs text-muted-foreground">Reported</span>;
  }

  if (!open) {
    return (
      <button
        type="button"
        className="text-xs text-muted-foreground hover:text-destructive"
        onClick={() => {
          setOpen(true);
        }}
      >
        Report
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <select
        className="h-8 rounded-md border border-border bg-background px-2 text-xs text-foreground"
        value={reason}
        onChange={(event) => {
          setReason(event.target.value as ReportReason);
        }}
      >
        {reportReasons.map((value) => (
          <option key={value} value={value}>
            {reportReasonLabels[value]}
          </option>
        ))}
      </select>
      <input
        type="text"
        placeholder="Details (optional)"
        maxLength={500}
        value={details}
        onChange={(event) => {
          setDetails(event.target.value);
        }}
        className="h-8 w-40 rounded-md border border-border bg-background px-2 text-xs text-foreground"
      />
      <button
        type="button"
        disabled={state === "submitting"}
        className="font-medium text-primary"
        onClick={() => {
          setState("submitting");
          void doReport({
            data: { targetType, targetId, reason, details: details || undefined },
          })
            .then(() => {
              setState("done");
            })
            .catch(() => {
              setState("error");
            });
        }}
      >
        Submit
      </button>
      <button
        type="button"
        className="text-muted-foreground"
        onClick={() => {
          setOpen(false);
        }}
      >
        Cancel
      </button>
      {state === "error" ? <span className="text-destructive">Could not report.</span> : null}
    </div>
  );
}
