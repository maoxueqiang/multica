// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchChangelogContent } from "./changelog-content";

const URL = "https://mc.ai.caijj.net/releases/desktop/changelog.json";
const VALID_CONTENT = {
  title: "Multica 更新日志",
  subtitle: "Multica 的最新更新和改进。",
  toc: "历史版本",
  categories: {
    features: "新功能",
    improvements: "改进",
    fixes: "问题修复",
  },
  entries: [
    {
      version: "1.0.0",
      date: "2026-09-10",
      title: "Multica 1.0.0",
      changes: [],
      features: ["桌面端统一连接业务服务。"],
    },
  ],
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("fetchChangelogContent", () => {
  it("loads fresh validated changelog content from the static release server", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(VALID_CONTENT), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchChangelogContent(URL)).resolves.toEqual(VALID_CONTENT);
    expect(fetchMock).toHaveBeenCalledWith(URL, { cache: "no-store" });
  });

  it.each([
    ["HTTP failure", new Response("missing", { status: 404 })],
    [
      "invalid JSON structure",
      new Response(JSON.stringify({ title: "Incomplete" }), { status: 200 }),
    ],
  ])("returns null for %s", async (_label, response) => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));

    await expect(fetchChangelogContent(URL)).resolves.toBeNull();
  });
});
