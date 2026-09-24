/**
 * Server settings subscreen — runtime override for API / web base URLs.
 *
 * Gated to __DEV__ builds only (settings.tsx hides the entry row otherwise):
 * a shipped client must never let users repoint the app at an arbitrary
 * server (session/token exfiltration risk), see lib/server-url-store.ts.
 *
 * Changing the API URL is treated as a hard boundary: the saved token
 * belongs to the OLD server, so Save always signs out + clears caches
 * (same sequence as the 401 handler in app/_layout.tsx) and lands on
 * /login — never silently carries a session across backends.
 */
import { useState } from "react";
import { Alert, KeyboardAvoidingView, Platform, ScrollView, View } from "react-native";
import { router } from "expo-router";
import { Text } from "@/components/ui/text";
import { TextField } from "@/components/ui/text-field";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { normalizeServerUrl } from "@/lib/server-url";
import {
  ENV_API_URL,
  ENV_WEB_URL,
  useServerUrlStore,
} from "@/lib/server-url-store";
import { useAuthStore } from "@/data/auth-store";
import { useWorkspaceStore } from "@/data/workspace-store";
import { queryClient } from "@/data/query-client";

function FieldGroup({
  label,
  description,
  value,
  defaultValue,
  onChangeText,
}: {
  label: string;
  description: string;
  /** Current committed override (null = using env default). Local draft
   *  state lives in the parent; this is just what's already saved. */
  value: string | null;
  defaultValue: string | null;
  onChangeText: (text: string) => void;
}) {
  return (
    <View className="gap-2">
      <View className="px-1">
        <Text className="text-xs uppercase tracking-wider text-muted-foreground">
          {label}
        </Text>
        <Text className="text-xs text-muted-foreground mt-1">{description}</Text>
      </View>
      <View className="rounded-md border border-border bg-card px-4 py-3 gap-2">
        <TextField
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          placeholder={defaultValue ?? "https://..."}
          value={value ?? ""}
          onChangeText={onChangeText}
        />
        {defaultValue ? (
          <Text className="text-xs text-muted-foreground">
            Default: {defaultValue}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

export default function ServerSettingsScreen() {
  const savedApiOverride = useServerUrlStore((s) => s.apiUrlOverride);
  const savedWebOverride = useServerUrlStore((s) => s.webUrlOverride);
  const setApiUrlOverride = useServerUrlStore((s) => s.setApiUrlOverride);
  const setWebUrlOverride = useServerUrlStore((s) => s.setWebUrlOverride);

  const [apiDraft, setApiDraft] = useState(savedApiOverride ?? "");
  const [webDraft, setWebDraft] = useState(savedWebOverride ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // The store's resolved value already reflects env-vs-override priority;
  // for "reset" we just need to know if anything is actually overridden.
  const hasOverride = savedApiOverride !== null || savedWebOverride !== null;

  // Shared by onSave + onReset: an API-base change means the saved token was
  // issued by the OLD server and is meaningless (or worse, actively wrong)
  // against the new one. Sign out unconditionally rather than carry a session
  // across backends. This is the same sequence as the 401 handler in
  // app/_layout.tsx, and the realtime provider tears down its socket via the
  // userId → null flip.
  const confirmServerChange = () => {
    Alert.alert(
      "Server changed",
      "You'll be signed out and need to sign in again on the new server.",
      [
        {
          text: "OK",
          onPress: async () => {
            await useAuthStore.getState().logout();
            await useWorkspaceStore.getState().clear();
            // Same singleton app/_layout.tsx's AuthInitializer clears on 401
            // — module-scope import is safe here (not a Node-env test file).
            queryClient.clear();
            router.replace("/login");
          },
        },
      ],
    );
  };

  const onSave = async () => {
    setError(null);

    const trimmedApi = apiDraft.trim();
    const trimmedWeb = webDraft.trim();

    let nextApi: string | null = null;
    if (trimmedApi) {
      const normalized = normalizeServerUrl(trimmedApi);
      if (!normalized) {
        setError("API server must be an http(s):// URL with a host.");
        return;
      }
      nextApi = normalized.value;
    }

    let nextWeb: string | null = null;
    if (trimmedWeb) {
      const normalized = normalizeServerUrl(trimmedWeb);
      if (!normalized) {
        setError("Web server must be an http(s):// URL with a host.");
        return;
      }
      nextWeb = normalized.value;
    }

    const apiChanged = nextApi !== savedApiOverride;

    setSaving(true);
    try {
      await setApiUrlOverride(nextApi);
      await setWebUrlOverride(nextWeb);
    } catch (err) {
      setSaving(false);
      setError(err instanceof Error ? err.message : "Couldn't save.");
      return;
    }
    setSaving(false);

    if (!apiChanged) {
      // Web URL only affects "Copy link" / "Open on web" menu items, which
      // read it fresh on tap (see getWebUrl() call sites) — no session or
      // cache is keyed off it, so nothing to invalidate.
      Alert.alert("Saved", "Web server URL updated.");
      return;
    }

    confirmServerChange();
  };

  // One-tap, not two: this clears the persisted override right away (not
  // just the local drafts) so the label matches what actually happens.
  const onReset = async () => {
    if (saving) return;
    const apiWasOverridden = savedApiOverride !== null;
    setSaving(true);
    try {
      await setApiUrlOverride(null);
      await setWebUrlOverride(null);
    } catch (err) {
      setSaving(false);
      setError(err instanceof Error ? err.message : "Couldn't reset.");
      return;
    }
    setSaving(false);
    setApiDraft("");
    setWebDraft("");
    setError(null);
    if (apiWasOverridden) confirmServerChange();
  };

  return (
    <KeyboardAvoidingView
      className="flex-1"
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        className="flex-1 bg-background"
        contentContainerClassName="px-4 py-4 gap-6"
        keyboardShouldPersistTaps="handled"
      >
        <FieldGroup
          label="API server"
          description="Where this app sends all of its requests. Only shown in dev builds."
          value={apiDraft}
          defaultValue={ENV_API_URL}
          onChangeText={(t) => {
            setApiDraft(t);
            setError(null);
          }}
        />

        <FieldGroup
          label="Web server"
          description="Used to build “Copy link” / “Open on web” URLs. Leave blank to hide those menu items."
          value={webDraft}
          defaultValue={ENV_WEB_URL}
          onChangeText={(t) => {
            setWebDraft(t);
            setError(null);
          }}
        />

        {error ? (
          <Text className="text-sm text-destructive">{error}</Text>
        ) : null}

        <View className="gap-3">
          <Button onPress={onSave} disabled={saving}>
            <Text>{saving ? "Saving…" : "Save"}</Text>
          </Button>
          {hasOverride ? (
            <>
              <Separator />
              <Button variant="ghost" onPress={onReset} disabled={saving}>
                <Text className="text-muted-foreground">
                  Reset to build default
                </Text>
              </Button>
            </>
          ) : null}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
