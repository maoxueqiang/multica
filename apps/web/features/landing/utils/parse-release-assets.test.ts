// @vitest-environment node
import { describe, expect, it } from "vitest";
import { hasCompleteAssetSet, parseReleaseAssets } from "./parse-release-assets";

function asset(name: string) {
  return {
    name,
    browser_download_url: `https://github.test/releases/${name}`,
  };
}

describe("parseReleaseAssets", () => {
  it("keeps both Apple Silicon and Intel macOS installers", () => {
    const assets = parseReleaseAssets([
      asset("multica-desktop-0.4.2-mac-arm64.dmg"),
      asset("multica-desktop-0.4.2-mac-arm64.zip"),
      asset("multica-desktop-0.4.2-mac-x64.dmg"),
      asset("multica-desktop-0.4.2-mac-x64.zip"),
      asset("multica-desktop-0.4.2-mac-x64.dmg.blockmap"),
      asset("latest-x64-mac.yml"),
    ]);

    expect(assets).toEqual({
      macArm64Dmg:
        "https://github.test/releases/multica-desktop-0.4.2-mac-arm64.dmg",
      macArm64Zip:
        "https://github.test/releases/multica-desktop-0.4.2-mac-arm64.zip",
      macX64Dmg:
        "https://github.test/releases/multica-desktop-0.4.2-mac-x64.dmg",
      macX64Zip:
        "https://github.test/releases/multica-desktop-0.4.2-mac-x64.zip",
    });
  });
});

/** Every employee-facing installer required by the internal download page. */
const ALL_ARTIFACT_NAMES = [
  "multica-desktop-0.4.27-mac-arm64.dmg",
  "multica-desktop-0.4.27-mac-arm64.zip",
  "multica-desktop-0.4.27-mac-x64.dmg",
  "multica-desktop-0.4.27-mac-x64.zip",
  "multica-desktop-0.4.27-windows-x64.exe",
  "multica-desktop-0.4.27-windows-arm64.exe",
];

describe("hasCompleteAssetSet", () => {
  it("accepts all download files for the four supported platform rows", () => {
    const assets = parseReleaseAssets(ALL_ARTIFACT_NAMES.map(asset));
    expect(hasCompleteAssetSet(assets)).toBe(true);
  });

  it("rejects a release missing any single artifact", () => {
    for (const dropped of ALL_ARTIFACT_NAMES) {
      const assets = parseReleaseAssets(
        ALL_ARTIFACT_NAMES.filter((n) => n !== dropped).map(asset),
      );
      expect(hasCompleteAssetSet(assets), `missing ${dropped}`).toBe(false);
    }
  });

  it("rejects an empty asset set", () => {
    expect(hasCompleteAssetSet({})).toBe(false);
  });
});
