import { getDmClient } from "@plumas/crypto";
import { Button, Card, CardContent, CardHeader, CardTitle } from "@plumas/ui";
import { createFileRoute } from "@tanstack/react-router";
import jsQR from "jsqr";
import QRCode from "qrcode";
import { useEffect, useRef, useState } from "react";

import {
  ensureMessagingSetup,
  linkNewDevice,
  prepareDeviceLinkQrPayload,
  refreshBackup,
  restoreFromRecoveryKey,
} from "../../../lib/dm-client";

export const Route = createFileRoute("/_app/settings/messaging")({
  component: MessagingSettings,
});

function MessagingSettings() {
  const { user } = Route.useRouteContext();
  const [deviceId, setDeviceId] = useState<string | null | undefined>(undefined);
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void getDmClient()
      .getConfirmedDeviceId()
      .then((id) => {
        setDeviceId(id ?? null);
      });
  }, []);

  async function handleSetUp() {
    setBusy(true);
    setError(null);
    try {
      const result = await ensureMessagingSetup(user.id);
      const id = await getDmClient().getConfirmedDeviceId();
      setDeviceId(id ?? null);
      if (result) setRecoveryKey(result.recoveryKey);
    } catch (setupError) {
      setError(setupError instanceof Error ? setupError.message : "Setup failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Messaging on this device</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          {deviceId === undefined ? (
            <p className="text-muted-foreground">Checking...</p>
          ) : deviceId ? (
            <p>Messaging is set up on this device.</p>
          ) : (
            <>
              <p className="text-muted-foreground">
                Set up end-to-end encrypted messaging on this device. You&apos;ll be shown a
                recovery key once - save it somewhere safe. It&apos;s the only way to restore your
                message history on a new device.
              </p>
              <Button type="button" disabled={busy} onClick={() => void handleSetUp()}>
                {busy ? "Setting up..." : "Set up messaging"}
              </Button>
              <RestoreFromRecoveryKey
                onRestored={() => {
                  void getDmClient()
                    .getConfirmedDeviceId()
                    .then((id) => {
                      setDeviceId(id ?? null);
                    });
                }}
              />
            </>
          )}
          {error ? <p className="text-destructive">{error}</p> : null}
          {recoveryKey ? (
            <div className="rounded-md border border-border bg-muted p-3">
              <p className="mb-2 font-medium">
                Your recovery key - save this now, it won&apos;t be shown again:
              </p>
              <p className="break-all font-mono text-base">{recoveryKey}</p>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {deviceId ? <BackUpNow /> : null}
      {deviceId ? <DeviceLinking userId={user.id} /> : null}
    </div>
  );
}

/**
 * A fresh backup is only ever taken explicitly, never silently in the background: the recovery
 * key is never stored anywhere (that's the whole point), so a background refresh would have no
 * way to re-wrap the new backup under the user's existing key - it would need to mint a new one
 * and surprise the user into saving it. Conversations created (or devices linked) since the
 * last backup won't restore onto a new device until the user backs up again here.
 */
function BackUpNow() {
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Back up your messages</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <p className="text-muted-foreground">
          Back up again after starting new conversations or linking a device, so they&apos;re
          included if you ever need to restore. This replaces your old recovery key with a new one.
        </p>
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            setError(null);
            void refreshBackup()
              .then(setRecoveryKey)
              .catch((backupError: unknown) => {
                setError(backupError instanceof Error ? backupError.message : "Backup failed.");
              })
              .finally(() => {
                setBusy(false);
              });
          }}
        >
          {busy ? "Backing up..." : "Back up now"}
        </Button>
        {error ? <p className="text-destructive">{error}</p> : null}
        {recoveryKey ? (
          <div className="rounded-md border border-border bg-muted p-3">
            <p className="mb-2 font-medium">
              Your new recovery key - save this now, it won&apos;t be shown again:
            </p>
            <p className="break-all font-mono text-base">{recoveryKey}</p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** Already used messaging before but this (new, or cleared) device has no local state. */
function RestoreFromRecoveryKey({ onRestored }: { onRestored: () => void }) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-2 border-t border-border pt-3">
      <p className="text-muted-foreground">
        Already used messaging on another device? Restore from your recovery key instead.
      </p>
      <div className="flex gap-2">
        <input
          type="text"
          value={key}
          placeholder="xxxx-xxxx-xxxx-xxxx-xxxx-xxxx-xxxx-xxxx"
          className="h-9 flex-1 rounded-md border border-border bg-background px-2 font-mono text-sm text-foreground"
          onChange={(event) => {
            setKey(event.target.value);
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy || key.trim().length === 0}
          onClick={() => {
            setBusy(true);
            setError(null);
            void restoreFromRecoveryKey(key.trim())
              .then(onRestored)
              .catch((restoreError: unknown) => {
                setError(
                  restoreError instanceof Error ? restoreError.message : "Couldn't restore.",
                );
              })
              .finally(() => {
                setBusy(false);
              });
          }}
        >
          {busy ? "Restoring..." : "Restore"}
        </Button>
      </div>
      {error ? <p className="text-destructive">{error}</p> : null}
    </div>
  );
}

function DeviceLinking({ userId }: { userId: string }) {
  return (
    <div className="grid gap-6 sm:grid-cols-2">
      <ShowQrCard userId={userId} />
      <ScanQrCard />
    </div>
  );
}

/** Run on the NEW device: shows a QR an already-linked device scans to add this one. */
function ShowQrCard({ userId }: { userId: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<"idle" | "showing" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleShowQr() {
    setStatus("showing");
    setError(null);
    try {
      const payload = await prepareDeviceLinkQrPayload(userId);
      if (canvasRef.current) {
        await QRCode.toCanvas(canvasRef.current, payload, { width: 240 });
      }
    } catch (qrError) {
      setStatus("error");
      setError(qrError instanceof Error ? qrError.message : "Couldn't prepare this device.");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Link this device</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <p className="text-muted-foreground">
          On a device you&apos;re already using, scan this code to add this device to your existing
          conversations.
        </p>
        <Button type="button" variant="outline" onClick={() => void handleShowQr()}>
          Show my code
        </Button>
        {error ? <p className="text-destructive">{error}</p> : null}
        <canvas ref={canvasRef} hidden={status !== "showing"} className="mx-auto" />
      </CardContent>
    </Card>
  );
}

/** Run on an already-trusted device: scans a new device's QR and links it. */
function ScanQrCard() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [scanning, setScanning] = useState(false);
  const [status, setStatus] = useState<"idle" | "scanning" | "linking" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!scanning) return;

    let stopped = false;

    async function run() {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      streamRef.current = stream;
      if (!videoRef.current) return;
      videoRef.current.srcObject = stream;
      await videoRef.current.play();

      const canvas = canvasRef.current;
      const context = canvas?.getContext("2d");
      if (!canvas || !context) return;

      while (!stopped) {
        const video = videoRef.current;
        if (video.videoWidth > 0) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
          const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(imageData.data, imageData.width, imageData.height);
          if (code) {
            stopped = true;
            setStatus("linking");
            try {
              await linkNewDevice(code.data);
              setStatus("done");
            } catch (linkError) {
              setStatus("error");
              setError(
                linkError instanceof Error ? linkError.message : "Couldn't link that device.",
              );
            }
            break;
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }

    setStatus("scanning");
    void run().catch((runError: unknown) => {
      setStatus("error");
      setError(runError instanceof Error ? runError.message : "Camera access failed.");
    });

    return () => {
      stopped = true;
      streamRef.current?.getTracks().forEach((track) => {
        track.stop();
      });
    };
  }, [scanning]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Scan a new device</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <p className="text-muted-foreground">
          On your new device, open this same page and tap &quot;Show my code&quot;, then scan it
          here.
        </p>
        {status === "idle" ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setScanning(true);
            }}
          >
            Start scanning
          </Button>
        ) : null}
        {status === "done" ? <p>Device linked.</p> : null}
        {error ? <p className="text-destructive">{error}</p> : null}
        <video
          ref={videoRef}
          hidden={status !== "scanning" && status !== "linking"}
          className="w-full rounded-md"
          muted
          playsInline
        />
        <canvas ref={canvasRef} hidden />
      </CardContent>
    </Card>
  );
}
