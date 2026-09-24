/**
 * Pure-function tests for normalizeServerUrl — the validation gate in front
 * of the runtime server-URL override (lib/server-url-store.ts). No native
 * imports here (unlike the store itself), so this runs cleanly in the
 * Node-env vitest lane described in vitest.config.ts.
 */
import { describe, expect, it } from "vitest";
import { normalizeServerUrl } from "./server-url";

describe("normalizeServerUrl", () => {
  it("accepts a plain https URL unchanged", () => {
    expect(normalizeServerUrl("https://api.example.test")).toEqual({
      value: "https://api.example.test",
    });
  });

  it("accepts a plain http URL (LAN dev backend case)", () => {
    expect(normalizeServerUrl("http://192.168.1.42:8080")).toEqual({
      value: "http://192.168.1.42:8080",
    });
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeServerUrl("  https://api.example.test  ")).toEqual({
      value: "https://api.example.test",
    });
  });

  it("lowercases only the scheme, leaving the rest untouched", () => {
    expect(normalizeServerUrl("HTTPS://API.Example.Test/Path")).toEqual({
      value: "https://API.Example.Test/Path",
    });
  });

  it("strips a single trailing slash", () => {
    expect(normalizeServerUrl("https://api.example.test/")).toEqual({
      value: "https://api.example.test",
    });
  });

  it("strips repeated trailing slashes", () => {
    expect(normalizeServerUrl("https://api.example.test///")).toEqual({
      value: "https://api.example.test",
    });
  });

  it("keeps a non-root path intact", () => {
    expect(normalizeServerUrl("https://example.test/api-gateway")).toEqual({
      value: "https://example.test/api-gateway",
    });
  });

  it("rejects empty or whitespace-only input", () => {
    expect(normalizeServerUrl("")).toBeNull();
    expect(normalizeServerUrl("   ")).toBeNull();
  });

  it("rejects a missing scheme", () => {
    expect(normalizeServerUrl("api.example.test")).toBeNull();
  });

  it("rejects a non-http scheme", () => {
    expect(normalizeServerUrl("ftp://files.example.test")).toBeNull();
    expect(normalizeServerUrl("ws://realtime.example.test")).toBeNull();
  });

  it("rejects a scheme with no host", () => {
    expect(normalizeServerUrl("https://")).toBeNull();
    expect(normalizeServerUrl("https:///only-a-path")).toBeNull();
  });
});
