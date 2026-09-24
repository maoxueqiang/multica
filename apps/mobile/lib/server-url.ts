/**
 * Pure helpers for the runtime-configurable server URLs.
 *
 * Kept separate from `lib/server-url-store.ts` (which touches SecureStore +
 * Zustand) so validation can be unit-tested without native mocks — same split
 * the web `lib/` URL helpers use: clean/validate first, callers decide what
 * an unconfigured value means.
 */

export interface NormalizedUrl {
  /** Trimmed, scheme lowercase, no trailing slash. */
  value: string;
}

/** Normalize + validate a user-entered server URL.
 *  Returns null when the input is not a usable http(s) origin:
 *  - trims whitespace, lowercases the scheme (iOS keyboards love "HTTPS://"),
 *  - strips ALL trailing slashes (the `${base}${path}` contract in data/api.ts
 *    and resolveAttachmentUrlWithBase both assume a bare base),
 *  - requires an http(s) scheme and a hostname. We deliberately do NOT pin to
 *  https: dev workflows point at LAN backends like http://192.168.1.42:8080
 *  (see apps/mobile/README first-time setup). */
export function normalizeServerUrl(raw: string): NormalizedUrl | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Lowercase only the scheme, leave the rest alone (paths, query strings).
  const schemeMatch = trimmed.match(/^(https?):\/\//i);
  if (!schemeMatch) return null;
  const scheme = schemeMatch[1].toLowerCase();
  const rest = trimmed.slice(schemeMatch[0].length);

  // Trailing slashes are stripped before any path check: "https://host/" and
  // "https://host" are the same server to every consumer here.
  const stripped = rest.replace(/\/+$/, "");
  const host = stripped.split("/")[0];
  if (!host) return null;

  return { value: `${scheme}://${stripped}` };
}
