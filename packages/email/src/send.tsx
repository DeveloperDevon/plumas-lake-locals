import { render } from "@react-email/render";
import type { ReactElement } from "react";

import { resendClient } from "./client";
import { InviteEmail } from "./templates/InviteEmail";
import { MagicLinkEmail } from "./templates/MagicLinkEmail";

const DEFAULT_FROM = "Plumas Lake Locals <hello@plumaslakelocals.com>";

export interface SendMagicLinkEmailInput {
  to: string;
  url: string;
}

export async function sendMagicLinkEmail({ to, url }: SendMagicLinkEmailInput): Promise<void> {
  await send(to, "Sign in to Plumas Lake Locals", <MagicLinkEmail url={url} />);
}

export interface SendInviteEmailInput {
  to: string;
  url: string;
  inviterName: string;
  note?: string | undefined;
}

export async function sendInviteEmail({
  to,
  url,
  inviterName,
  note,
}: SendInviteEmailInput): Promise<void> {
  await send(
    to,
    `${inviterName} invited you to Plumas Lake Locals`,
    <InviteEmail url={url} inviterName={inviterName} note={note} />,
  );
}

/**
 * With no RESEND_API_KEY set (the local dev default), logs the rendered email to the console
 * instead of sending it — this is what makes the invite -> signup -> sign-in loop testable
 * locally without a Resend account.
 */
async function send(to: string, subject: string, element: ReactElement): Promise<void> {
  if (!process.env.RESEND_API_KEY) {
    const html = await render(element);
    console.log(`[email:console-fallback] to=${to} subject="${subject}"\n${html}`);
    return;
  }

  const from = process.env.EMAIL_FROM ?? DEFAULT_FROM;
  const html = await render(element);
  await resendClient().emails.send({ from, to, subject, html });
}
