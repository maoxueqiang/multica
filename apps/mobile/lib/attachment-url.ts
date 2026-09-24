/**
 * Resolve a server-relative attachment URL against the configured API base.
 *
 * Background: when the backend has no CloudFront signer configured (e.g.
 * the self-hosted RustFS / private-S3 case in MUL-2976), `attachment.url`
 * and `attachment.download_url` come back as server-relative paths like
 * `/api/attachments/{id}/download`. Web is happy with that — same-origin
 * `<img src="/api/...">` resolves against the document base — but RN
 * needs an absolute http(s) URL for both `Linking.openURL` (`Cannot open
 * URL` otherwise) and `<Image source={{ uri }}>` (no document origin to
 * resolve against; the request is silently dropped).
 *
 * Mirrors `packages/core/workspace/avatar-url.ts:resolvePublicFileUrl`
 * exactly. We don't import the core helper because its `getBaseUrl()`
 * pulls from a singleton ApiClient that lives in `@multica/core/api` —
 * not on the mobile sharing whitelist (apps/mobile/CLAUDE.md "mirror,
 * don't import"). Mobile reads its own resolved server base via getApiUrl()
 * — which layers the runtime override (lib/server-url-store) on top of the
 * EXPO_PUBLIC_API_URL env default — the same value the rest of
 * `data/api.ts` uses per request.
 *
 * Contract:
 *   - null / undefined / "" → null (caller should treat as "no URL").
 *   - already-absolute URL  → returned unchanged.
 *   - server-relative path  → API base + path, with a single boundary
 *                             slash (we trim trailing slashes from the
 *                             base before joining).
 */

import { getApiUrl } from "@/data/server-url-accessors";

export function resolveAttachmentUrlWithBase(
  rawUrl: string | null | undefined,
  baseUrl: string,
): string | null {
  if (!rawUrl) return null;
  if (!rawUrl.startsWith("/")) return rawUrl;
  const trimmedBaseUrl = baseUrl.replace(/\/+$/, "");
  return `${trimmedBaseUrl}${rawUrl}`;
}

export function resolveAttachmentUrl(
  rawUrl: string | null | undefined,
): string | null {
  if (!rawUrl) return null;
  // Absolute URLs (CloudFront/presigned) don't need a base at all — return
  // before touching the store, so this stays usable even with no server
  // configured (matches the previous `?? ""` fallback's behavior for this
  // branch, just without the empty-base join silently producing a relative
  // path for the branch below).
  if (!rawUrl.startsWith("/")) return rawUrl;
  // Only the server-relative case needs a base, and it's resolved per call —
  // not frozen at module load — so a runtime override (lib/server-url-store)
  // restored after this module's first import still applies. getApiUrl()
  // throws when nothing is configured, same sharp edge as data/api.ts.
  return resolveAttachmentUrlWithBase(rawUrl, getApiUrl());
}
