import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AllPlatforms } from "./all-platforms";

vi.mock("../../i18n", () => ({
  useLocale: () => ({
    t: {
      download: {
        allPlatforms: {
          title: "All platforms",
          macArm64Label: "macOS · Apple Silicon",
          macX64Label: "macOS · Intel",
          winX64Label: "Windows · x64",
          winArm64Label: "Windows · ARM64",
          linuxX64Label: "Linux · x64",
          linuxArm64Label: "Linux · ARM64",
          formatDmg: ".dmg",
          formatZip: ".zip",
          formatExe: ".exe",
          formatAppImage: ".AppImage",
          formatDeb: ".deb",
          formatRpm: ".rpm",
          unavailable: "Not available",
        },
        footer: { allReleases: "View all releases" },
      },
    },
  }),
}));

describe("AllPlatforms", () => {
  it("shows only four internal DMG and EXE installers", () => {
    render(
      <AllPlatforms
        assets={{
          macArm64Dmg: "https://downloads.test/mac-arm64.dmg",
          macArm64Zip: "https://downloads.test/mac-arm64.zip",
          macX64Dmg: "https://downloads.test/mac-x64.dmg",
          macX64Zip: "https://downloads.test/mac-x64.zip",
          winX64Exe: "https://downloads.test/windows-x64.exe",
          winArm64Exe: "https://downloads.test/windows-arm64.exe",
          linuxAmd64AppImage: "https://downloads.test/linux-x64.AppImage",
        }}
      />,
    );

    const intelLabel = screen.getByText("macOS · Intel");
    const intelRow = intelLabel.parentElement?.parentElement;
    expect(intelRow).not.toBeNull();
    expect(within(intelRow!).getByRole("link", { name: ".dmg" })).toHaveAttribute(
      "href",
      "https://downloads.test/mac-x64.dmg",
    );
    expect(screen.getByText("macOS · Apple Silicon")).toBeInTheDocument();
    expect(screen.getByText("Windows · x64")).toBeInTheDocument();
    expect(screen.getByText("Windows · ARM64")).toBeInTheDocument();
    expect(screen.queryByText("Linux · x64")).not.toBeInTheDocument();
    expect(screen.queryByText("Linux · ARM64")).not.toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: ".zip" })).toHaveLength(2);
    expect(
      screen.queryByRole("link", { name: "View all releases" }),
    ).not.toBeInTheDocument();
  });
});
