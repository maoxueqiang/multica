/**
 * Pure-function tests for the mobile attachment URL resolver. We exercise
 * the with-base form for everything that needs a base, since `resolveAttachmentUrl`
 * itself reads the resolved API base from `lib/server-url-store` (override >
 * EXPO_PUBLIC_API_URL env default) at call time — the with-base helper is the
 * same code path with the API base passed in explicitly. `resolveAttachmentUrl`
 * is still exercised directly below, but only for the null/absolute cases,
 * which don't touch the store at all by design.
 *
 * Coverage target: every branch the call sites in the app rely on —
 *   - `comment-attachment-list.tsx`         → file chip Linking.openURL
 *   - `markdown-image.tsx`                  → mc:// + RN image loader
 *   - `composer-attachment-row.tsx`         → completed non-image chip
 *                                             tap → Linking.openURL
 */
import { describe, expect, it, vi } from "vitest";

// `resolveAttachmentUrl` pulls in `@/data/server-url-accessors` (for the
// server-relative branch only) → `@/lib/server-url-store` → `expo-secure-store`
// → react-native's Flow-typed source, which this Node-env runner can't parse
// (same reason `data/queries/*.test.ts` mock `@/data/api`). Mock it at the
// boundary; the cases below never actually need a resolved base anyway (see
// the "store-backed" describe) — this is purely to keep the module graph loadable.
vi.mock("@/data/server-url-accessors", () => ({
  getApiUrl: () => {
    throw new Error("getApiUrl should not be called by these test cases");
  },
}));

import {
  resolveAttachmentUrl,
  resolveAttachmentUrlWithBase,
} from "./attachment-url";

describe("resolveAttachmentUrlWithBase", () => {
  const BASE = "https://api.example.test";

  it("prepends the API base for a server-relative path", () => {
    expect(
      resolveAttachmentUrlWithBase("/api/attachments/att-1/download", BASE),
    ).toBe("https://api.example.test/api/attachments/att-1/download");
  });

  it("trims a trailing slash on the API base before joining", () => {
    expect(
      resolveAttachmentUrlWithBase(
        "/api/attachments/att-1/download",
        "https://api.example.test/",
      ),
    ).toBe("https://api.example.test/api/attachments/att-1/download");
  });

  it("passes an absolute https URL through unchanged (CloudFront / presigned)", () => {
    const signed =
      "https://cdn.example.test/att-1.bin?Policy=p&Signature=s&Key-Pair-Id=k";
    expect(resolveAttachmentUrlWithBase(signed, BASE)).toBe(signed);
  });

  it("passes an absolute http URL through unchanged (self-hosted dev)", () => {
    expect(
      resolveAttachmentUrlWithBase("http://localhost:8080/file.bin", BASE),
    ).toBe("http://localhost:8080/file.bin");
  });

  it("returns null for nullish or empty input", () => {
    expect(resolveAttachmentUrlWithBase(null, BASE)).toBeNull();
    expect(resolveAttachmentUrlWithBase(undefined, BASE)).toBeNull();
    expect(resolveAttachmentUrlWithBase("", BASE)).toBeNull();
  });

  it("keeps a relative path unchanged when the base is empty (web same-origin convention)", () => {
    // Mirrors `packages/core/workspace/avatar-url.ts` semantics for the
    // empty-base case — the host platform resolves the path against its
    // own document/page origin. RN doesn't have one, but exercising this
    // branch keeps the contract explicit.
    expect(
      resolveAttachmentUrlWithBase("/api/attachments/att-1/download", ""),
    ).toBe("/api/attachments/att-1/download");
  });
});

describe("composer file chip — completed non-image attachment", () => {
  // MUL-2976 (PR #3747 follow-up): when `api.uploadFile(...)` finishes on
  // a non-CloudFront deployment the returned `attachment.download_url` is
  // a server-relative path. `composer-attachment-row.tsx` taps that value
  // straight into `Linking.openURL` — and iOS rejects relative URLs with
  // "Cannot open URL". The fix wraps the value with `resolveAttachmentUrl`
  // before handing it to Linking; this test pins the behaviour we rely on.
  const BASE = "https://api.example.test";
  // Mirrors `ComposerAttachmentItem` after a successful non-image upload.
  const completedFileChip = {
    localId: "local-1",
    localUri: "file:///private/var/.../IMG_0001.pdf",
    filename: "report.pdf",
    mimeType: "application/pdf",
    status: "completed" as const,
    id: "att-42",
    url: "mc://file/att-42",
    downloadUrl: "/api/attachments/att-42/download",
  };

  it("resolves a server-relative downloadUrl against the API base", () => {
    expect(
      resolveAttachmentUrlWithBase(completedFileChip.downloadUrl, BASE),
    ).toBe("https://api.example.test/api/attachments/att-42/download");
  });

  it("preserves an absolute downloadUrl returned by CloudFront / presign", () => {
    const cloudFront = {
      ...completedFileChip,
      downloadUrl:
        "https://cdn.example.test/att-42.pdf?Signature=s&Key-Pair-Id=k",
    };
    expect(
      resolveAttachmentUrlWithBase(cloudFront.downloadUrl, BASE),
    ).toBe(cloudFront.downloadUrl);
  });

  it("returns null when the upload hasn't populated downloadUrl yet (no Linking call)", () => {
    // Mirrors a `completed` chip that arrived before the server response
    // (defensive; in practice `completed` implies downloadUrl is set).
    const partial = { ...completedFileChip, downloadUrl: undefined };
    expect(resolveAttachmentUrlWithBase(partial.downloadUrl, BASE)).toBeNull();
  });
});

describe("resolveAttachmentUrl (store-backed)", () => {
  it("passes an absolute URL through unchanged without touching the resolved API base", () => {
    // Server-relative resolution reads lib/server-url-store; absolute-URL
    // pass-through must not, so it stays valid even with no server configured.
    const absolute = "https://cdn.example.test/file.pdf?Signature=s";
    expect(resolveAttachmentUrl(absolute)).toBe(absolute);
  });

  it("returns null for empty input", () => {
    expect(resolveAttachmentUrl(undefined)).toBeNull();
    expect(resolveAttachmentUrl(null)).toBeNull();
    expect(resolveAttachmentUrl("")).toBeNull();
  });
});
