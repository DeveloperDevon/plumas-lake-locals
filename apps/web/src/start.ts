import { createMiddleware, createStart } from "@tanstack/react-start";

// NFR-05/07: basic security headers on every response. Allows inline scripts/styles since
// SSR hydration needs them without a nonce-based CSP setup (a later hardening pass can add
// nonces and tighten this); this is a floor, not a hardened production CSP.
const securityHeaders = createMiddleware({ type: "request" }).server(async ({ next }) => {
  const result = await next();
  result.response.headers.set("X-Frame-Options", "DENY");
  result.response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  result.response.headers.set(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'; frame-ancestors 'none'",
  );
  return result;
});

export const startInstance = createStart(() => ({
  requestMiddleware: [securityHeaders],
}));
