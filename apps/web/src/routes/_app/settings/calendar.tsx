import { Button, Card, CardContent, CardHeader, CardTitle } from "@plumas/ui";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";

import { regenerateCalendarFeedTokenFn } from "../../../server/functions/events";

export const Route = createFileRoute("/_app/settings/calendar")({ component: CalendarSettings });

function CalendarSettings() {
  const doRegenerate = useServerFn(regenerateCalendarFeedTokenFn);

  const [url, setUrl] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [copied, setCopied] = useState(false);

  async function handleGenerate() {
    setGenerating(true);
    setCopied(false);
    try {
      const { token } = await doRegenerate();
      setUrl(`${window.location.origin}/api/calendar/feed/${token}`);
    } finally {
      setGenerating(false);
    }
  }

  async function handleCopy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Calendar subscription</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          Get every event you can see as a private calendar feed - add this link to Google Calendar,
          Apple Calendar or Outlook and it keeps itself up to date.
        </p>

        {url ? (
          <div className="flex flex-col gap-2">
            <div className="flex gap-2">
              <input
                type="text"
                readOnly
                value={url}
                aria-label="Calendar subscription URL"
                className="h-11 min-w-0 flex-1 rounded-md border border-border bg-background px-3 text-sm text-foreground"
                onFocus={(event) => {
                  event.target.select();
                }}
              />
              <Button type="button" variant="outline" onClick={() => void handleCopy()}>
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              This is shown once - copy it now. Generating a new link invalidates this one.
            </p>
          </div>
        ) : null}

        <Button
          type="button"
          variant={url ? "outline" : "default"}
          className="w-fit"
          disabled={generating}
          onClick={() => void handleGenerate()}
        >
          {generating
            ? "Generating..."
            : url
              ? "Generate a new link"
              : "Generate subscription link"}
        </Button>
      </CardContent>
    </Card>
  );
}
