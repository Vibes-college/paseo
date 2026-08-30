import { expect, test } from "../support/fixtures";
import { buildAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";

test.describe.configure({ timeout: 180_000 });

test("mounts the Complete Root with isolated routing, owned overlays, and clean disposal", async ({
  page,
}) => {
  const agent = await seedMockAgentWorkspace({
    repoPrefix: "complete-root-mount-",
    title: "Complete Root mount contract",
    initialPrompt: "Stream a short Complete Root fixture.",
  });

  try {
    const internalPath = buildAgentRoute(agent.workspaceId, agent.agentId);
    const outerPath = `/?paseoPath=${encodeURIComponent(internalPath)}`;
    await page.goto(outerPath);
    await expect(page.getByRole("textbox", { name: "Message agent..." }).first()).toBeVisible({
      timeout: 60_000,
    });
    const outerUrl = page.url();
    const historyLength = await page.evaluate(() => window.history.length);

    const menuClose = page.locator('button[aria-label="Close menu"]:visible');
    await expect(menuClose).toBeVisible();
    await menuClose.click();
    await expect(page.locator('button[aria-label="Open menu"]:visible')).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Message agent..." }).first()).toBeVisible();
    expect(page.url()).toBe(outerUrl);

    await page.locator('button[aria-label="Open menu"]:visible').click();
    const explorerToggle = page.locator('button[aria-label="Open Explorer sidebar"]:visible');
    const compactRequest = page.locator('button[aria-label="Return to Compact"]:visible');
    await expect(explorerToggle).toBeVisible();
    await expect(compactRequest).toBeVisible();
    const [explorerBox, compactBox] = await Promise.all([
      explorerToggle.boundingBox(),
      compactRequest.boundingBox(),
    ]);
    expect(compactBox!.x).toBeGreaterThan(explorerBox!.x);

    await compactRequest.click();
    await expect(page.locator("#root")).toHaveAttribute("data-paseo-request-count", "1");
    await expect(page.locator("#root")).toHaveAttribute("data-paseo-requested-surface", "compact");
    await expect(page.locator("[data-paseo-app-root]")).toHaveCount(1);

    await page.locator('button[aria-label="Settings"]:visible').click();
    await expect(page.locator('button[aria-label="Back"]:visible')).toBeVisible();
    await expect(compactRequest).not.toBeVisible();
    expect(page.url()).toBe(outerUrl);
    expect(await page.evaluate(() => window.history.length)).toBe(historyLength);

    await page.locator('button[aria-label="Back"]:visible').click();
    await expect(compactRequest).toBeVisible();
    expect(page.url()).toBe(outerUrl);

    const overlayOwnership = await page.evaluate(() => {
      const overlay = document.querySelector("[data-paseo-overlay-root]");
      return {
        parentIsRoot: overlay?.parentElement?.id === "root",
        bodyOverlayCount: document.body.querySelectorAll(":scope > #overlay-root").length,
      };
    });
    expect(overlayOwnership).toEqual({ parentIsRoot: true, bodyOverlayCount: 0 });

    await page.evaluate(() => window.__paseoCompleteRootV1!.dispose());
    await expect(page.locator("[data-paseo-app-root]")).toHaveCount(0);
    await expect(page.locator("[data-paseo-overlay-root]")).toHaveCount(0);
    expect(await page.evaluate(() => window.__paseoCompleteRootV1!.diagnostics())).toBeNull();

    await page.evaluate(() => window.__paseoCompleteRootV1!.remount());
    await expect(page.locator("[data-paseo-app-root]")).toHaveCount(1);
    await expect
      .poll(() =>
        page.evaluate(() => window.__paseoCompleteRootV1!.diagnostics()?.rootGeneration ?? 0),
      )
      .toBeGreaterThan(1);
  } finally {
    await agent.cleanup();
  }
});
