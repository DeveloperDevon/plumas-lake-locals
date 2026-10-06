import { Resend } from "resend";

let cachedClient: Resend | undefined;

export function resendClient(): Resend {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("RESEND_API_KEY is not set");
  cachedClient ??= new Resend(apiKey);
  return cachedClient;
}
