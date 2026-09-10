import type { Metadata } from "next";
import { ChangelogPageClient } from "@/features/landing/components/changelog-page-client";
import type { LandingDict } from "@/features/landing/i18n/types";
import { fetchChangelogContent } from "@/features/landing/utils/changelog-content";

const unavailableContent: LandingDict["changelog"] = {
  title: "Multica 更新日志",
  subtitle: "更新日志暂时不可用，请稍后刷新。",
  toc: "历史版本",
  categories: {
    features: "新功能",
    improvements: "改进",
    fixes: "问题修复",
  },
  entries: [],
};

export const metadata: Metadata = {
  title: "Changelog",
  description:
    "See what's new in Multica — latest features, improvements, and fixes.",
  openGraph: {
    title: "Changelog | Multica",
    description: "Latest updates and releases from Multica.",
    url: "/changelog",
  },
  alternates: {
    canonical: "/changelog",
  },
};

export default async function ChangelogPage() {
  const content = (await fetchChangelogContent()) ?? unavailableContent;
  return (
    <ChangelogPageClient
      content={content}
      localeOverride="zh-Hans"
    />
  );
}
