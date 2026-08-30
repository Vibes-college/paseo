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

    const identityBeforeCompact = await page.evaluate(() => ({
      rootGeneration: window.__paseoCompleteRootV1!.diagnostics()!.rootGeneration,
      activeConnectionCount:
        window.__paseoCompleteRootV1!.diagnostics()!.owner!.runtime.activeConnectionCount,
    }));
    await compactRequest.click();
    await expect(page.locator("#root")).toHaveAttribute("data-paseo-request-count", "1");
    await expect(page.locator("#root")).toHaveAttribute("data-paseo-requested-surface", "compact");
    await expect(page.locator("#root")).toHaveAttribute("data-paseo-committed-surface", "compact");
    await expect(page.locator("[data-paseo-app-root]")).toHaveCount(1);

    const compactSurface = page.locator('[data-paseo-host-surface][data-surface="compact"]');
    await expect(compactSurface).toBeVisible();
    await expect(compactSurface).toHaveAttribute("data-paseo-compact-width", "380");
    await expect(compactSurface).toHaveAttribute("data-paseo-compact-height", "600");
    await expect(page.locator("[data-paseo-compact-header]:visible")).toHaveCount(1);
    await expect(page.locator('button[aria-label="New tab"]:visible')).toHaveCount(1);
    await expect(page.locator('button[aria-label^="Runtime menu"]:visible')).toHaveCount(1);
    const fullButton = page.locator('button[aria-label="Open full Paseo"]:visible');
    await expect(fullButton).toHaveCount(1);
    await expect(fullButton).toBeFocused();
    await expect(page.locator('button[aria-label="Minimize"]:visible')).toHaveCount(1);

    const retainedDraft = "Stage 3 retained selection draft";
    const compactComposer = page.locator("textarea:visible");
    await compactComposer.fill(retainedDraft);
    await compactComposer.evaluate((element: HTMLTextAreaElement) =>
      element.setSelectionRange(8, 17),
    );
    await fullButton.click();
    await expect(page.locator("#root")).toHaveAttribute("data-paseo-committed-surface", "full");
    const fullComposer = page.locator("textarea:visible");
    await expect(fullComposer).toHaveValue(retainedDraft);
    expect(
      await fullComposer.evaluate((element: HTMLTextAreaElement) => [
        element.selectionStart,
        element.selectionEnd,
      ]),
    ).toEqual([8, 17]);
    await compactRequest.click();
    await expect(page.locator("#root")).toHaveAttribute("data-paseo-committed-surface", "compact");
    await expect(compactComposer).toHaveValue(retainedDraft);
    expect(
      await compactComposer.evaluate((element: HTMLTextAreaElement) => [
        element.selectionStart,
        element.selectionEnd,
      ]),
    ).toEqual([8, 17]);
    await expect(fullButton).toBeFocused();

    await page.locator('button[aria-label^="Runtime menu"]:visible').click();
    await expect(page.locator('[data-testid="paseo-compact-runtime-menu"]:visible')).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator('[data-testid="paseo-compact-runtime-menu"]:visible')).toHaveCount(0);

    await page.locator('button[aria-label="Minimize"]:visible').click();
    await expect(page.locator("#root")).toHaveAttribute("data-paseo-minimize-request-count", "1");
    await expect(compactSurface).not.toBeVisible();
    const fab = page.locator("[data-paseo-fab]:visible");
    await expect(fab).toBeVisible();
    await expect(fab).toBeFocused();
    await fab.click();
    await expect(compactSurface).toBeVisible();
    await expect(fullButton).toBeFocused();
    expect(
      await page.evaluate(() => ({
        rootGeneration: window.__paseoCompleteRootV1!.diagnostics()!.rootGeneration,
        activeConnectionCount:
          window.__paseoCompleteRootV1!.diagnostics()!.owner!.runtime.activeConnectionCount,
      })),
    ).toEqual(identityBeforeCompact);

    await page.evaluate(() =>
      window.__paseoCompleteRootV1!.updateActivity({
        visible: false,
        focused: false,
        foreground: true,
      }),
    );
    await expect(compactSurface).not.toBeVisible();
    await expect(page.locator("[data-paseo-fab]:visible")).toHaveCount(0);
    await expect(page.locator("[data-paseo-app-root]")).toHaveCount(1);
    await page.evaluate(() =>
      window.__paseoCompleteRootV1!.updateActivity({
        visible: true,
        focused: true,
        foreground: true,
      }),
    );
    await expect(compactSurface).toBeVisible();

    await fullButton.click();
    await expect(page.locator("#root")).toHaveAttribute("data-paseo-request-count", "4");
    await expect(page.locator("#root")).toHaveAttribute("data-paseo-committed-surface", "full");
    await expect(compactRequest).toBeVisible();
    expect(
      await page.evaluate(() => ({
        rootGeneration: window.__paseoCompleteRootV1!.diagnostics()!.rootGeneration,
        activeConnectionCount:
          window.__paseoCompleteRootV1!.diagnostics()!.owner!.runtime.activeConnectionCount,
      })),
    ).toEqual(identityBeforeCompact);

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
        parentIsSurface: overlay?.parentElement?.hasAttribute("data-paseo-host-surface") === true,
        bodyOverlayCount: document.body.querySelectorAll(":scope > #overlay-root").length,
      };
    });
    expect(overlayOwnership).toEqual({ parentIsSurface: true, bodyOverlayCount: 0 });

    await page.evaluate(() => window.__paseoCompleteRootV1!.dispose());
    await expect(page.locator("[data-paseo-app-root]")).toHaveCount(0);
    await expect(page.locator("[data-paseo-overlay-root]")).toHaveCount(0);
    await expect(page.locator("[data-paseo-fab]")).toHaveCount(0);
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
