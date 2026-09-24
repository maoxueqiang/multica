/**
 * Sync accessors over the server-url store — the `getCurrentSlug()` pattern
 * in data/workspace-store.ts. Lives in data/ (rather than hanging off the
 * lib/ store file) because the throw-on-missing contract below is API-client
 * policy, not storage policy:
 *
 *   - getApiUrl(): every HTTP/WS consumer. Null here means neither a
 *     persisted override nor an env default exists — pre-existing behavior
 *     was a module-load throw with a how-to-fix message, and a request-time
 *     throw keeps that sharp edge (a silent "" base would produce relative
 *     fetches that fail confusingly). Restored state is required first:
 *     auth-store.initialize() awaits restore() before the first request.
 *   - getWebUrl(): optional by design — the "Copy link" / "Open on web"
 *     menu items are conditional on a non-null value (pre-existing
 *     contract in the issue/project/inbox menus), so no throw here.
 */
import { useServerUrlStore } from "@/lib/server-url-store";

export function getApiUrl(): string {
  const url = useServerUrlStore.getState().apiUrl;
  if (!url) {
    throw new Error(
      "No API server URL configured. Set it in Settings → Server (dev " +
        "builds) or add EXPO_PUBLIC_API_URL to apps/mobile/.env.development.local " +
        "(see apps/mobile/.env.staging for an example).",
    );
  }
  return url;
}

export function getWebUrl(): string | null {
  return useServerUrlStore.getState().webUrl;
}
