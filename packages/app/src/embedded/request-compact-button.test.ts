import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const readSource = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

describe("embedded Full return action", () => {
  it("keeps the rightmost return action beside both desktop and mobile Explorer toggles", async () => {
    const [workspaceSource, buttonSource] = await Promise.all([
      readSource("../screens/workspace/workspace-screen.tsx"),
      readSource("./request-compact-button.tsx"),
    ]);

    expect(workspaceSource).toContain("<WorkspaceExplorerToggle");
    expect(workspaceSource).toContain("<PaseoRequestCompactButton />");
    expect(workspaceSource).not.toMatch(/!isMobile\s*\?\s*<PaseoRequestCompactButton/);
    expect(buttonSource).toContain('snapshot?.surface !== "full"');
    expect(buttonSource).toContain('accessibilityLabel="Return to Compact"');
    expect(buttonSource).toContain('requestSurface("compact")');
  });
});
