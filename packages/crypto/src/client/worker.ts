/**
 * Web Worker entry point (per the PRD's "MLS runs in a Web Worker" decision) - the only place
 * MLS private key material and the device's IndexedDB connection exist. Every operation is
 * implemented in engine.ts/backup.ts as plain, unit-testable functions; this file only wires
 * them to postMessage so the main thread (client.ts) never touches key material directly.
 *
 * This package's tsconfig uses `"lib": ["ES2022", "DOM"]` (needed by harness/ for
 * document/canvas access), which conflicts with `"lib": ["WebWorker"]` - TS doesn't allow both
 * in one compilation, since they define incompatible global `self` types. Rather than split
 * this package's tsconfig per-file, `self` is narrowed locally to the minimal worker-scope
 * shape this file actually uses.
 */
import type { EncryptedBackup } from "./backup.js";
import { createFullBackup, generateRecoveryKey, restoreFullBackup } from "./backup.js";
import {
  addDeviceToConversation,
  cacheSentPlaintext,
  confirmDeviceId,
  createConversation,
  encryptMessage,
  generateKeyPackages,
  getCachedSentPlaintext,
  getConfirmedDeviceId,
  getDeviceSigningPublicKey,
  listMyConversationIds,
  processIncoming,
} from "./engine.js";

export type WorkerRequest =
  | { id: number; method: "generateKeyPackages"; params: { userId: string; count: number } }
  | {
      id: number;
      method: "createConversation";
      params: { userId: string; conversationId: string; peerKeyPackageBytes: Uint8Array };
    }
  | {
      id: number;
      method: "processIncoming";
      params: { messageId: string; conversationId: string; wireBytes: Uint8Array };
    }
  | { id: number; method: "encryptMessage"; params: { conversationId: string; plaintext: string } }
  | {
      id: number;
      method: "addDeviceToConversation";
      params: { conversationId: string; newDeviceKeyPackageBytes: Uint8Array };
    }
  | { id: number; method: "generateRecoveryKey"; params: Record<string, never> }
  | { id: number; method: "confirmDeviceId"; params: { deviceId: string } }
  | { id: number; method: "getConfirmedDeviceId"; params: Record<string, never> }
  | { id: number; method: "listMyConversationIds"; params: Record<string, never> }
  | { id: number; method: "getDeviceSigningPublicKey"; params: Record<string, never> }
  | { id: number; method: "cacheSentPlaintext"; params: { messageId: string; plaintext: string } }
  | { id: number; method: "getCachedSentPlaintext"; params: { messageId: string } }
  | { id: number; method: "createFullBackup"; params: { recoveryKey: string } }
  | {
      id: number;
      method: "restoreFullBackup";
      params: { recoveryKey: string; backup: EncryptedBackup };
    };

export type WorkerResponse =
  { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string };

async function handle(request: WorkerRequest): Promise<unknown> {
  switch (request.method) {
    case "generateKeyPackages":
      return generateKeyPackages(request.params.userId, request.params.count);
    case "createConversation":
      return createConversation(
        request.params.userId,
        request.params.conversationId,
        request.params.peerKeyPackageBytes,
      );
    case "processIncoming":
      return processIncoming(
        request.params.messageId,
        request.params.conversationId,
        request.params.wireBytes,
      );
    case "encryptMessage":
      return encryptMessage(request.params.conversationId, request.params.plaintext);
    case "addDeviceToConversation":
      return addDeviceToConversation(
        request.params.conversationId,
        request.params.newDeviceKeyPackageBytes,
      );
    case "generateRecoveryKey":
      return generateRecoveryKey();
    case "confirmDeviceId":
      return confirmDeviceId(request.params.deviceId);
    case "getConfirmedDeviceId":
      return getConfirmedDeviceId();
    case "listMyConversationIds":
      return listMyConversationIds();
    case "getDeviceSigningPublicKey":
      return getDeviceSigningPublicKey();
    case "cacheSentPlaintext":
      return cacheSentPlaintext(request.params.messageId, request.params.plaintext);
    case "getCachedSentPlaintext":
      return getCachedSentPlaintext(request.params.messageId);
    case "createFullBackup":
      return createFullBackup(request.params.recoveryKey);
    case "restoreFullBackup":
      return restoreFullBackup(request.params.recoveryKey, request.params.backup);
  }
}

interface WorkerScope {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(message: WorkerResponse): void;
}

const workerScope = self as unknown as WorkerScope;

workerScope.onmessage = (event) => {
  const request = event.data;
  handle(request)
    .then((result) => {
      workerScope.postMessage({ id: request.id, ok: true, result });
    })
    .catch((error: unknown) => {
      workerScope.postMessage({
        id: request.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    });
};
