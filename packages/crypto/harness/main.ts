import jsQR from "jsqr";
import QRCode from "qrcode";
import { defaultCapabilities, defaultLifetime, generateKeyPackage } from "ts-mls";

import { runBackupRestore } from "../src/spike/backup-restore.js";
import { getImpl } from "../src/spike/common.js";
import {
  decodeKeyPackageFromQr,
  encodeKeyPackageForQr,
  runDeviceLinking,
} from "../src/spike/device-linking.js";
import { runLargeGroup } from "../src/spike/large-group.js";
import { runOneToOne } from "../src/spike/one-to-one.js";

function requireOutput(): HTMLPreElement {
  const element = document.querySelector("#output");
  if (!(element instanceof HTMLPreElement))
    throw new Error("harness/index.html is missing #output");
  return element;
}

function requireCanvas(): HTMLCanvasElement {
  const element = document.querySelector("#qr-canvas");
  if (!(element instanceof HTMLCanvasElement)) {
    throw new Error("harness/index.html is missing #qr-canvas");
  }
  return element;
}

const output = requireOutput();
const canvas = requireCanvas();

function log(text: string): void {
  output.textContent = text;
}

function append(text: string): void {
  output.textContent += "\n" + text;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * The part the Vitest suite can't exercise: render a real QR code image, read its pixels back
 * out, and decode it - proving a KeyPackage actually survives a screen-to-camera-shaped
 * round trip, not just an in-memory byte round trip.
 */
async function qrImageRoundTrip(): Promise<{ bytesMatch: boolean; qrPayloadChars: number }> {
  const impl = await getImpl();
  const { publicPackage } = await generateKeyPackage(
    { credentialType: "basic", identity: new TextEncoder().encode("harness-new-device") },
    defaultCapabilities(),
    defaultLifetime,
    [],
    impl,
  );

  const originalBytes = encodeKeyPackageForQr(publicPackage);
  const payload = bytesToBase64(originalBytes);

  canvas.hidden = false;
  await QRCode.toCanvas(canvas, payload, { errorCorrectionLevel: "M" });

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not get a 2D canvas context");
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const scanned = jsQR(imageData.data, imageData.width, imageData.height);
  if (!scanned) throw new Error("jsQR could not decode the rendered QR code image");

  const decodedBytes = base64ToBytes(scanned.data);
  const bytesMatch =
    decodedBytes.length === originalBytes.length &&
    decodedBytes.every((b, i) => b === originalBytes[i]);

  // Prove the round-tripped bytes are still a valid KeyPackage, not just byte-identical.
  decodeKeyPackageFromQr(decodedBytes);

  return { bytesMatch, qrPayloadChars: payload.length };
}

async function withTiming<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const started = performance.now();
  const result = await fn();
  append(`[${label}] ${(performance.now() - started).toFixed(1)}ms`);
  return result;
}

async function runOneToOneDemo(): Promise<void> {
  log("Running 1:1 chat...");
  const result = await withTiming("one-to-one", runOneToOne);
  append(JSON.stringify(result, null, 2));
}

async function runLargeGroupDemo(): Promise<void> {
  log("Running 50-member group - this takes ~30 seconds...");
  const result = await withTiming("large-group", () => runLargeGroup(50));
  append(JSON.stringify(result, null, 2));
}

async function runDeviceLinkingDemo(): Promise<void> {
  log("Running device linking (MLS-level)...");
  const mlsResult = await withTiming("device-linking (MLS)", runDeviceLinking);
  append(JSON.stringify(mlsResult, null, 2));

  append("\nRunning real QR image round-trip (render -> pixels -> scan -> decode)...");
  const qrResult = await withTiming("device-linking (QR image)", qrImageRoundTrip);
  append(JSON.stringify(qrResult, null, 2));
  append(qrResult.bytesMatch ? "QR image round-trip: PASS" : "QR image round-trip: FAIL");
}

async function runBackupRestoreDemo(): Promise<void> {
  log("Running encrypted backup + restore...");
  const result = await withTiming("backup-restore", runBackupRestore);
  append(JSON.stringify(result, null, 2));
}

document.querySelector("#run-one-to-one")?.addEventListener("click", () => {
  void runOneToOneDemo().catch((error: unknown) => {
    log(`FAILED: ${error instanceof Error ? error.message : String(error)}`);
  });
});
document.querySelector("#run-large-group")?.addEventListener("click", () => {
  void runLargeGroupDemo().catch((error: unknown) => {
    log(`FAILED: ${error instanceof Error ? error.message : String(error)}`);
  });
});
document.querySelector("#run-device-linking")?.addEventListener("click", () => {
  void runDeviceLinkingDemo().catch((error: unknown) => {
    log(`FAILED: ${error instanceof Error ? error.message : String(error)}`);
  });
});
document.querySelector("#run-backup-restore")?.addEventListener("click", () => {
  void runBackupRestoreDemo().catch((error: unknown) => {
    log(`FAILED: ${error instanceof Error ? error.message : String(error)}`);
  });
});
document.querySelector("#run-all")?.addEventListener("click", () => {
  void (async () => {
    log("Running all four scenarios in sequence...\n");
    await runOneToOneDemo();
    await runDeviceLinkingDemo();
    await runBackupRestoreDemo();
    await runLargeGroupDemo();
    append("\nAll scenarios complete.");
  })().catch((error: unknown) => {
    append(`FAILED: ${error instanceof Error ? error.message : String(error)}`);
  });
});
