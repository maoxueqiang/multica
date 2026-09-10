import { z } from "zod";
import type { LandingDict } from "../i18n/types";

const DEFAULT_CHANGELOG_URL =
  "https://mc.ai.caijj.net/releases/desktop/changelog.json";

const ReleaseSchema = z.object({
  version: z.string().trim().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  title: z.string().trim().min(1),
  changes: z.array(z.string()),
  features: z.array(z.string()).optional(),
  improvements: z.array(z.string()).optional(),
  fixes: z.array(z.string()).optional(),
});

const ChangelogContentSchema = z.object({
  title: z.string().trim().min(1),
  subtitle: z.string().trim().min(1),
  toc: z.string().trim().min(1),
  categories: z.object({
    features: z.string().trim().min(1),
    improvements: z.string().trim().min(1),
    fixes: z.string().trim().min(1),
  }),
  entries: z.array(ReleaseSchema),
});

export async function fetchChangelogContent(
  url = process.env.CHANGELOG_DATA_URL ?? DEFAULT_CHANGELOG_URL,
): Promise<LandingDict["changelog"] | null> {
  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`changelog data responded ${response.status}`);
    }

    const result = ChangelogContentSchema.safeParse(await response.json());
    if (!result.success) {
      throw new Error("changelog data failed validation");
    }
    return result.data;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown error";
    console.warn(`[changelog] content unavailable: ${reason}`);
    return null;
  }
}
