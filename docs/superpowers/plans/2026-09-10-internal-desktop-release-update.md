# Multica Internal Desktop Release and Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task with review checkpoints.

**Goal:** Make the self-hosted Web download page and all four supported Desktop builds use `https://mc.ai.caijj.net/releases/desktop/` with the smallest practical change from upstream.

**Architecture:** Next.js reads a small `release.json` manifest from the fixed company URL and renders the four supported platform rows while preserving the upstream CLI and Cloud sections. Electron Builder writes a generic-provider `app-update.yml`; architecture-specific channels keep four update feeds separate. Nginx serves release files from a dedicated read-only host directory. Existing CLI behavior and unrelated deployment configuration remain unchanged.

**Tech Stack:** TypeScript, React, Next.js, Electron, electron-builder/electron-updater, Vitest, Docker Compose, Nginx.

**Spec:** `docs/superpowers/specs/2026-09-10-internal-desktop-release-update-design.md`

## Global Constraints

- Work on `feature/internal-server`; do not merge or push without explicit user authorization.
- The public application origin is `https://mc.ai.caijj.net`; the release base URL is `https://mc.ai.caijj.net/releases/desktop/`.
- The Web page exposes four platform/architecture rows: both macOS rows show DMG and ZIP, while both Windows rows show EXE. Linux is not shown.
- macOS ZIP files also remain required updater payloads; blockmaps and four `latest*.yml` files stay hidden from users.
- Do not publish standalone `multica-cli-*` archives for employees. Existing Desktop CLI recovery behavior remains upstream-compatible.
- Web installer links and Desktop application updates must not fall back to official GitHub releases.
- Never publish a `latest*.yml` or `release.json` before all referenced immutable artifacts have passed existence, architecture, hash, and applicable signature checks.
- A macOS release is not production-ready until it is signed with Developer ID Application and notarized. Do not claim automatic Mac update success from an unsigned build.

## Task 1: Point the existing Web release fetcher at the internal manifest

**Files:**

- Modify: `apps/web/features/landing/utils/github-release.ts`
- Modify: `apps/web/features/landing/utils/github-release.test.ts`

**Step 1: Write failing manifest tests**

Cover these contracts:

- fetches the fixed company `release.json` URL with `next.revalidate = 300`;
- preserves the upstream GitHub Releases response shape and existing release-selection behavior;
- parses the six required desktop download assets across four supported platform rows;
- returns the empty release shape on non-200 response or malformed JSON;
- never requests `api.github.com` and has no GitHub fallback.

Use this public shape:

```ts
export interface LatestRelease {
  version: string | null;
  publishedAt: string | null;
  htmlUrl: string | null;
  assets: DownloadAssets;
}

export async function fetchLatestRelease(): Promise<LatestRelease>;
```

Run:

```bash
pnpm --filter @multica/web test -- github-release.test.ts
```

Expected: FAIL because the existing fetcher still requests the GitHub API.

**Step 2: Reuse the upstream release contract**

Change the existing request URL to `https://mc.ai.caijj.net/releases/desktop/release.json` and remove GitHub-specific request headers/token handling. Keep the existing GitHub Releases-compatible array shape, release selection and asset parser. Do not add a parallel fetcher or environment-variable plumbing.

**Step 3: Run tests and typecheck**

```bash
pnpm --filter @multica/web test -- github-release.test.ts
pnpm --filter @multica/web typecheck
```

**Step 4: Commit**

```bash
git add -- apps/web/features/landing/utils/github-release.ts apps/web/features/landing/utils/github-release.test.ts
git commit -m "feat(web): load internal desktop releases"
```

## Task 2: Restrict installer choices while preserving the existing download page sections

**Files:**

- Modify: `apps/web/features/landing/utils/parse-release-assets.ts`
- Modify: `apps/web/features/landing/utils/parse-release-assets.test.ts`
- Modify: `apps/web/features/landing/components/download/all-platforms.tsx`
- Modify: `apps/web/features/landing/components/download/all-platforms.test.tsx`
- Modify: `apps/web/features/landing/components/download/hero.tsx`
- Modify: `apps/web/features/landing/components/download/hero.test.ts`
- Modify: `apps/web/app/(landing)/download/download-client.tsx`
- Modify: `apps/web/features/landing/components/changelog-page-client.tsx`
- Modify: `apps/web/features/landing/components/changelog-page-client.test.ts`
- Create: `apps/web/features/landing/content/internal-changelog.zh.ts`
- Modify: `apps/web/app/(landing)/changelog/page.tsx`
- Modify: `packages/views/layout/help-launcher.tsx`
- Modify: `packages/views/layout/help-launcher.test.tsx`
- Modify: `apps/desktop/src/renderer/src/components/update-notification.tsx`
- Modify: `apps/desktop/src/renderer/src/components/update-notification.test.tsx`

**Step 1: Write failing UI and asset-set tests**

Assert that:

- completeness requires two DMGs, two Mac ZIPs, and two Windows EXEs;
- the all-platform matrix renders four rows with Mac ZIP alternatives and no Linux rows;
- the Hero preserves the official Mac ZIP alternative but never exposes Linux downloads;
- incomplete manifests render unavailable controls rather than a GitHub escape link;
- the Web Help menu links to same-origin `/download`;
- the existing CLI and Cloud runtime sections remain rendered;
- the Desktop update prompt opens `https://mc.ai.caijj.net/changelog#release-<version>`;
- `/changelog` renders the company-maintained Chinese data through the existing page component.

Run:

```bash
pnpm --filter @multica/web test -- parse-release-assets.test.ts all-platforms.test.tsx hero.test.ts
pnpm --filter @multica/views test -- help-launcher.test.tsx
```

Expected: FAIL against the current twelve-artifact/GitHub UI.

**Step 2: Remove unsupported choices and fallbacks**

Keep `DownloadAssets` compatible with shared detection code if needed, but define the employee release completeness contract as:

```ts
const REQUIRED_ASSET_KEYS = [
  "macArm64Dmg",
  "macArm64Zip",
  "macX64Dmg",
  "macX64Zip",
  "winX64Exe",
  "winArm64Exe",
] as const;
```

Remove `ALL_RELEASES_URL`, GitHub download fallbacks, and Linux rows. Preserve the existing macOS ZIP alternatives, CLI section, Cloud runtime section, and a release-notes link only when `release.json.releaseNotesUrl` is valid. Refactor the existing changelog client to accept an optional content prop, then make `/changelog` read the separately maintained Chinese data module. Keep its visible title general enough for Desktop, Web, backend, and deployment changes, and do not overuse “内部版” in visible copy.

**Step 3: Run focused tests and typechecks**

```bash
pnpm --filter @multica/web test -- parse-release-assets.test.ts all-platforms.test.tsx hero.test.ts
pnpm --filter @multica/views test -- help-launcher.test.tsx
pnpm --filter @multica/desktop test -- src/renderer/src/components/update-notification.test.tsx
pnpm --filter @multica/web typecheck
pnpm --filter @multica/views typecheck
```

**Step 4: Commit**

```bash
git add -- apps/web packages/views/layout/help-launcher.tsx packages/views/layout/help-launcher.test.tsx apps/desktop/src/renderer/src/components/update-notification.tsx apps/desktop/src/renderer/src/components/update-notification.test.tsx
git commit -m "feat(web): show internal desktop installers"
```

## Task 3: Point packaged Desktop updates at the internal generic server

**Files:**

- Modify: `apps/desktop/electron-builder.yml`
- Modify: `apps/desktop/scripts/package.test.mjs`
- Modify: `apps/desktop/src/main/updater.test.ts`

**Step 1: Write failing packaging assertions**

Parse `electron-builder.yml` and assert:

```yaml
publish:
  provider: generic
  url: https://mc.ai.caijj.net/releases/desktop
```

Also assert the configuration contains neither GitHub `owner` nor `repo`, and preserve runtime channel behavior:

- Windows x64 → `latest.yml`;
- Windows arm64 → `latest-arm64.yml`;
- macOS arm64 → `latest-mac.yml`;
- macOS x64 → `latest-x64-mac.yml`.

Run:

```bash
pnpm --filter @multica/desktop test -- scripts/package.test.mjs src/main/updater.test.ts
```

Expected: FAIL because the provider is currently GitHub.

**Step 2: Change only the publish provider**

Do not call `autoUpdater.setFeedURL`; let electron-builder embed the generic provider in packaged `app-update.yml`. Keep the existing architecture channels in `package.mjs` and `updater.ts`.

**Step 3: Run focused tests and node typecheck**

```bash
pnpm --filter @multica/desktop test -- scripts/package.test.mjs src/main/updater.test.ts
pnpm --filter @multica/desktop run typecheck:node
```

**Step 4: Commit**

```bash
git add -- apps/desktop/electron-builder.yml apps/desktop/scripts/package.test.mjs apps/desktop/src/main/updater.test.ts
git commit -m "feat(desktop): use internal update feed"
```

## Task 4: Configure the existing gateway after approval

**External files only:**

- Modify on server: `/opt/multica-poc/nginx.conf`
- Modify on server: `/opt/multica-poc/compose.poc.yml`

**Step 1: Apply the static release route**

The Nginx snippets must:

- redirect `/releases/desktop` to the slash form;
- serve `/releases/desktop/` from `/srv/releases/desktop/` with `^~` precedence;
- allow only GET/HEAD;
- disable directory listing;
- set no-cache headers on `release.json`, `checksums.txt`, and `latest*.yml`;
- permit immutable caching for versioned artifacts.

The existing `compose.poc.yml` must mount `/opt/multica-releases:/srv/releases:ro` into `gateway`. Do not add repository-owned deployment wrappers solely for this environment.

**Step 2: Validate the actual server configuration**

```bash
docker compose -f docker-compose.selfhost.yml -f compose.poc.yml -f compose.images.lock.yml config --quiet
docker exec multica-poc-gateway-1 nginx -t
```

This task is deferred until the user authorizes server changes. It does not create repository files or a source commit.

## Task 5: Full verification, candidate build, and gated deployment

**Files:**

- Verify all files changed by Tasks 1–4.
- Produce ignored build output under `apps/desktop/dist/` only after source verification passes.

**Step 1: Run the full relevant verification suite**

```bash
pnpm --filter @multica/web test
pnpm --filter @multica/web typecheck
pnpm --filter @multica/views test
pnpm --filter @multica/views typecheck
pnpm --filter @multica/desktop test
pnpm --filter @multica/desktop typecheck
git diff --check
```

**Step 2: Build clean versioned candidates**

Build from a clean `v1.0.0` release commit using the existing architecture matrix. Do not reuse the earlier `0.0.0-gca47495fc-dirty` packages. Verify packaged `app-update.yml` contains only the internal generic provider and verify the bundled CLI architecture matches its Desktop package.

**Step 3: Enforce signing gates**

- macOS: `codesign --verify --deep --strict`, `spctl --assess`, notarization status, and `hdiutil verify` must pass before publishing Mac manifests.
- Windows: record Authenticode state and perform a real Windows 10/11 install/update test; unsigned candidates remain pilot-only.

If signing credentials are unavailable, stop before production manifest publication and report the exact gate. Code and unsigned candidate verification may still complete.

**Step 4: Inspect the release directory**

Confirm that the required installer/update artifacts and manually maintained `release.json` reference the same version before any mutable manifest is published.

**Step 5: Deploy only after artifact approval**

On `10.200.193.65`:

1. back up `/opt/multica-poc/nginx.conf` and `/opt/multica-poc/compose.poc.yml`;
2. create `/opt/multica-releases/desktop` with `0755` directories and `0644` files;
3. upload immutable versioned artifacts to a temporary directory;
4. validate hashes, then atomically move immutable artifacts into place;
5. apply the gateway mount and Nginx location, validate Compose and `nginx -t`;
6. recreate only `gateway`;
7. deploy the updated Web frontend;
8. publish `latest*.yml` and `release.json` last.

**Step 6: Validate from the employee network**

Require:

- `release.json` and four `latest*.yml` URLs return 200 without `-k`;
- a byte-range request to each installer/update payload returns 206;
- `/download` offers exactly four internal installer URLs;
- Web contains no official GitHub release request;
- packaged Desktop checks the internal generic provider;
- one device of each supported architecture completes overwrite migration and a subsequent higher-version update.

**Step 7: Final source commit if verification required adjustments**

Stage only exact source/document paths changed by those adjustments. Do not commit installers, signing credentials, server backups, or secrets.
