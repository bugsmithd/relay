// Magic-link redirect_to allowlist.
// Reject external + protocol-relative URLs.
// Allow root and /w/<slug>[/].

const WORKSPACE_PATH = /^\/w\/[a-z0-9-]+\/?$/;

export function safeRedirectTarget(input: string | null | undefined): string {
  if (!input) return "/";
  if (typeof input !== "string") return "/";
  // Block protocol-relative ("//evil.com") and absolute schemes.
  if (input.startsWith("//")) return "/";
  if (/^[a-z][a-z0-9+.-]*:/i.test(input)) return "/";
  // Must start with single "/".
  if (!input.startsWith("/")) return "/";
  if (input === "/") return "/";
  if (WORKSPACE_PATH.test(input)) return input;
  return "/";
}
