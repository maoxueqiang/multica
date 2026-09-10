import {
  hasCompleteAssetSet,
  parseReleaseAssets,
  type DownloadAssets,
} from "./parse-release-assets";

/**
 * Server-side fetcher for the latest downloadable Multica release.
 * The company release manifest keeps the upstream GitHub Releases response
 * shape so the existing selection and asset parsing logic can be reused.
 * Response is cached by Next.js for 5 minutes.
 *
 * Desktop assets don't all land at the same time: CI uploads Linux and
 * Windows within a minute of each other, but macOS is packaged manually
 * (notarization credentials aren't wired into CI yet) and lands tens of
 * minutes later. A packaging job can also fail outright and leave a
 * release permanently short of some platforms. Either way the newest
 * release is not always the newest *downloadable* one, so we pull a
 * short window of recent releases and show the newest whose desktop
 * asset set is complete — every button on the page then resolves to a
 * real file.
 *
 * On any failure (network, rate limit, malformed payload) returns a
 * `null`-shaped result and logs — the page degrades to a "version
 * unavailable" view rather than 500ing.
 */

export interface LatestRelease {
  version: string | null;
  publishedAt: string | null;
  htmlUrl: string | null;
  assets: DownloadAssets;
}

// Five candidates tolerates four consecutive incomplete releases before
// the page has to fall back to showing the newest one as-is. Releases
// ship roughly daily, so that is days of head room — while staying one
// cheap request.
const RELEASES_URL =
  "https://mc.ai.caijj.net/releases/desktop/release.json";

const REVALIDATE_SECONDS = 300;

interface GitHubReleasePayload {
  tag_name?: string;
  published_at?: string;
  html_url?: string;
  prerelease?: boolean;
  draft?: boolean;
  assets?: Array<{ name: string; browser_download_url: string }>;
}

export async function fetchLatestRelease(): Promise<LatestRelease> {
  try {
    const res = await fetch(RELEASES_URL, {
      next: { revalidate: REVALIDATE_SECONDS },
    });
    if (!res.ok) {
      throw new Error(`release manifest responded ${res.status}`);
    }
    const data = (await res.json()) as GitHubReleasePayload[];

    // Defensive filter — Multica doesn't publish prereleases or drafts
    // today, but the endpoint returns them if that ever changes. A
    // prerelease shadowing a stable version on /download would be a
    // regression.
    const stable = data.filter((r) => !r.prerelease && !r.draft);
    const chosen = pickRelease(stable);
    if (!chosen) {
      return emptyRelease();
    }

    return {
      version: chosen.release.tag_name ?? null,
      publishedAt: chosen.release.published_at ?? null,
      htmlUrl: chosen.release.html_url ?? null,
      assets: chosen.assets,
    };
  } catch (err) {
    console.warn("[download] fetchLatestRelease failed:", err);
    return emptyRelease();
  }
}

interface PickedRelease {
  release: GitHubReleasePayload;
  assets: DownloadAssets;
}

/**
 * Newest release whose desktop assets are all present. Falls back to the
 * newest release overall when no candidate is complete — the page then
 * shows what does exist plus its "all releases" escape hatch, which
 * still beats reporting no version at all.
 */
function pickRelease(
  candidates: GitHubReleasePayload[],
): PickedRelease | undefined {
  const parsed = candidates.map((release) => ({
    release,
    assets: parseReleaseAssets(release.assets ?? []),
  }));

  const complete = parsed.find((c) => hasCompleteAssetSet(c.assets));
  if (complete) {
    if (complete !== parsed[0]) {
      // Worth a line in the logs: a release that never completes its
      // asset set is invisible on /download until someone notices.
      console.warn(
        `[download] skipping ${parsed[0]?.release.tag_name ?? "latest release"}` +
          ` — incomplete desktop assets; showing ${complete.release.tag_name}`,
      );
    }
    return complete;
  }
  return parsed[0];
}

function emptyRelease(): LatestRelease {
  return {
    version: null,
    publishedAt: null,
    htmlUrl: null,
    assets: {},
  };
}
