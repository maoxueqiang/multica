/**
 * Runtime-configurable server URLs — Zustand store.
 *
 * Bakes the previously build-time-only `EXPO_PUBLIC_API_URL` /
 * `EXPO_PUBLIC_WEB_URL` into a per-device override layered ON TOP of the
 * env default:  override > env > (unconfigured → requests throw).
 * Overrides persist to SecureStore so cold starts resolve the same server
 * before the first fetch fires; `restore()` must therefore complete inside
 * auth-store `initialize()` — before the first `getMe()` — mirroring
 * `useWorkspaceStore.restoreSlug()`.
 *
 * The UI entry point is gated to `__DEV__` builds (more/settings/server):
 * a shipped build must not let users point the app at an arbitrary server.
 * The resolution itself is intentionally NOT gated — a staging Debug build
 * still falls back to its `.env.staging` default.
 *
 * Changing the API URL invalidates the current session: the token belongs
 * to the old server, so the settings screen signs out + clears caches
 * (same flow as the 401 handler in app/_layout.tsx) rather than carrying
 * cross-backend credentials. WS teardown rides the realtime provider's
 * `userId → null` effect; WS_URL is resolved at connect time, not module
 * load, so a remount after re-login picks up the new host automatically.
 *
 * Storage backend is expo-secure-store, matching data/secure-storage.ts and
 * workspace-store.ts. Sync read helpers follow the `getCurrentSlug()`
 * pattern so non-React callers (ApiClient.fetch, attachment-url) avoid
 * awaiting storage per request.
 */
import { create } from "zustand";
import * as SecureStore from "expo-secure-store";
import { normalizeServerUrl } from "@/lib/server-url";

const API_URL_KEY = "multica_server_api_url";
const WEB_URL_KEY = "multica_server_web_url";

/** Env default, already normalized at module load so getters stay cheap. */
function envDefault(raw: string | undefined): string | null {
  return raw ? normalizeServerUrl(raw)?.value ?? null : null;
}

export const ENV_API_URL = envDefault(process.env.EXPO_PUBLIC_API_URL);
export const ENV_WEB_URL = envDefault(process.env.EXPO_PUBLIC_WEB_URL);

interface ServerUrlState {
  /** Active API base, resolved (override > env). Null until restore() has
   *  run OR no override and no env default — requests surface the null
   *  as a descriptive throw rather than a silent bad URL. */
  apiUrl: string | null;
  /** Active web base for "Copy link" / "Open on web". Optional by design:
   *  without it those menu items just don't appear (pre-existing contract). */
  webUrl: string | null;
  /** Raw user override for each, so the settings screen can show what's
   *  stored and offer "Reset to default". */
  apiUrlOverride: string | null;
  webUrlOverride: string | null;
  restore: () => Promise<void>;
  /** Validate + persist (or clear, for null) one override and update the
   *  resolved values. Throws on invalid input so the caller can show an
   *  inline error without the store ever holding an unusable value. */
  setApiUrlOverride: (url: string | null) => Promise<void>;
  setWebUrlOverride: (url: string | null) => Promise<void>;
}

function resolve(override: string | null, fallback: string | null): string | null {
  return override ?? fallback;
}

export const useServerUrlStore = create<ServerUrlState>((set) => ({
  apiUrl: ENV_API_URL,
  webUrl: ENV_WEB_URL,
  apiUrlOverride: null,
  webUrlOverride: null,

  restore: async () => {
    const [apiOverrideRaw, webOverrideRaw] = await Promise.all([
      SecureStore.getItemAsync(API_URL_KEY),
      SecureStore.getItemAsync(WEB_URL_KEY),
    ]);
    // Re-normalize on read rather than trusting what's on disk: a hand-
    // edited / older-format value must not sneak a trailing slash into the
    // `${base}${path}` contract. Invalid junk is dropped (treated as unset).
    const apiUrlOverride = apiOverrideRaw
      ? normalizeServerUrl(apiOverrideRaw)?.value ?? null
      : null;
    const webUrlOverride = webOverrideRaw
      ? normalizeServerUrl(webOverrideRaw)?.value ?? null
      : null;
    set({
      apiUrlOverride,
      webUrlOverride,
      apiUrl: resolve(apiUrlOverride, ENV_API_URL),
      webUrl: resolve(webUrlOverride, ENV_WEB_URL),
    });
  },

  setApiUrlOverride: async (url) => {
    const normalized = url === null ? null : expectValid(url);
    if (normalized === null) {
      await SecureStore.deleteItemAsync(API_URL_KEY);
    } else {
      await SecureStore.setItemAsync(API_URL_KEY, normalized);
    }
    set({
      apiUrlOverride: normalized,
      apiUrl: resolve(normalized, ENV_API_URL),
    });
  },

  setWebUrlOverride: async (url) => {
    const normalized = url === null ? null : expectValid(url);
    if (normalized === null) {
      await SecureStore.deleteItemAsync(WEB_URL_KEY);
    } else {
      await SecureStore.setItemAsync(WEB_URL_KEY, normalized);
    }
    set({
      webUrlOverride: normalized,
      webUrl: resolve(normalized, ENV_WEB_URL),
    });
  },
}));

/** normalizeServerUrl that throws instead of returning null — the settings
 *  screen validates before calling in, so a null here means a race with a
 *  stale value, not user error worth an inline message. */
function expectValid(raw: string): string {
  const normalized = normalizeServerUrl(raw);
  if (!normalized) {
    throw new Error(`Invalid server URL: ${raw}`);
  }
  return normalized.value;
}
