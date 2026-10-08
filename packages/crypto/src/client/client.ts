/**
 * Thin main-thread wrapper around worker.ts - the only MLS/IndexedDB entry point the rest of
 * the app (server functions, UI) should import. Every call is a postMessage round trip; no key
 * material crosses into this module or whatever calls it.
 */
import type { EncryptedBackup } from "./backup.js";
import type {
  AddDeviceResult,
  CreateConversationResult,
  EncryptMessageResult,
  GeneratedKeyPackage,
  ProcessIncomingResult,
  RemoveMemberResult,
} from "./engine.js";
import type { WorkerRequest, WorkerResponse } from "./worker.js";

type Method = WorkerRequest["method"];

export class DmClient {
  private readonly worker: Worker;
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: unknown) => void }
  >();

  constructor() {
    this.worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const response = event.data;
      const entry = this.pending.get(response.id);
      if (!entry) return;
      this.pending.delete(response.id);
      if (response.ok) entry.resolve(response.result);
      else entry.reject(new Error(response.error));
    };
  }

  private call<T>(method: Method, params: unknown): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      this.worker.postMessage({ id, method, params });
    });
  }

  generateKeyPackages(userId: string, count: number): Promise<GeneratedKeyPackage[]> {
    return this.call("generateKeyPackages", { userId, count });
  }

  createConversation(
    userId: string,
    conversationId: string,
    memberKeyPackagesBytes: Uint8Array[],
  ): Promise<CreateConversationResult> {
    return this.call("createConversation", { userId, conversationId, memberKeyPackagesBytes });
  }

  processIncoming(
    messageId: string,
    conversationId: string,
    wireBytes: Uint8Array,
  ): Promise<ProcessIncomingResult> {
    return this.call("processIncoming", { messageId, conversationId, wireBytes });
  }

  encryptMessage(conversationId: string, plaintext: string): Promise<EncryptMessageResult> {
    return this.call("encryptMessage", { conversationId, plaintext });
  }

  addDeviceToConversation(
    conversationId: string,
    newDeviceKeyPackageBytes: Uint8Array,
  ): Promise<AddDeviceResult> {
    return this.call("addDeviceToConversation", { conversationId, newDeviceKeyPackageBytes });
  }

  removeGroupMember(conversationId: string, targetUserId: string): Promise<RemoveMemberResult> {
    return this.call("removeGroupMember", { conversationId, targetUserId });
  }

  leaveGroupLocally(conversationId: string): Promise<void> {
    return this.call("leaveGroupLocally", { conversationId });
  }

  generateRecoveryKey(): Promise<string> {
    return this.call("generateRecoveryKey", {});
  }

  confirmDeviceId(deviceId: string): Promise<void> {
    return this.call("confirmDeviceId", { deviceId });
  }

  getConfirmedDeviceId(): Promise<string | undefined> {
    return this.call("getConfirmedDeviceId", {});
  }

  listMyConversationIds(): Promise<string[]> {
    return this.call("listMyConversationIds", {});
  }

  getDeviceSigningPublicKey(): Promise<Uint8Array> {
    return this.call("getDeviceSigningPublicKey", {});
  }

  cacheSentPlaintext(messageId: string, plaintext: string): Promise<void> {
    return this.call("cacheSentPlaintext", { messageId, plaintext });
  }

  getCachedSentPlaintext(messageId: string): Promise<string | undefined> {
    return this.call("getCachedSentPlaintext", { messageId });
  }

  createFullBackup(recoveryKey: string): Promise<EncryptedBackup> {
    return this.call("createFullBackup", { recoveryKey });
  }

  restoreFullBackup(recoveryKey: string, backup: EncryptedBackup): Promise<void> {
    return this.call("restoreFullBackup", { recoveryKey, backup });
  }
}

let singleton: DmClient | null = null;

/** One worker per tab, lazily started on first use. */
export function getDmClient(): DmClient {
  singleton ??= new DmClient();
  return singleton;
}
