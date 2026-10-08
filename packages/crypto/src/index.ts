// MLS end-to-end encryption client for direct messages (task #22). Device keys, the MLS
// operations themselves, and IndexedDB persistence run inside a Web Worker (client/worker.ts)
// per docs/adr/0006; `getDmClient()` is the only entry point the rest of the app should use.
export type { EncryptedBackup } from "./client/backup.js";
export { generateRecoveryKey } from "./client/backup.js";
export { DmClient, getDmClient } from "./client/client.js";
export type {
  AddDeviceResult,
  CreateConversationResult,
  DeviceSigningKey,
  EncryptMessageResult,
  GeneratedKeyPackage,
  ProcessIncomingResult,
} from "./client/engine.js";
