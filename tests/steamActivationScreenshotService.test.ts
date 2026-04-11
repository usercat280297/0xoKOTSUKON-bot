import { describe, expect, it } from "vitest";
import { scoreSteamActivationScreenshot } from "../src/services/steamActivationScreenshotService";

describe("scoreSteamActivationScreenshot", () => {
  it("passes when update blocker and folder path cues are present", () => {
    const result = scoreSteamActivationScreenshot({
      ocrText:
        "Windows Updates Option Disable Updates Protect Services Settings File folder Location E:\\SteamLibrary\\steamapps\\common Contains",
      hasRedStatusBadge: true
    });

    expect(result.passed).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(80);
  });

  it("fails when the screenshot misses the game folder cues", () => {
    const result = scoreSteamActivationScreenshot({
      ocrText: "Windows Updates Option Disable Updates Protect Services Settings",
      hasRedStatusBadge: true
    });

    expect(result.passed).toBe(false);
    expect(result.missingSignals.join(" ")).toContain("properties");
  });
});
