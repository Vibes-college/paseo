import { expect, test } from "../support/fixtures";
import { buildAgentRoute, seedMockAgentWorkspace } from "../support/helpers/mock-agent";
import type { Page } from "@playwright/test";

function readVisualViewport(page: Page) {
  return page.evaluate(() => ({
    left: window.visualViewport?.offsetLeft ?? 0,
    top: window.visualViewport?.offsetTop ?? 0,
    width: window.visualViewport?.width ?? window.innerWidth,
    height: window.visualViewport?.height ?? window.innerHeight,
  }));
}

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

test.describe("mobile embedded Compact", () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 812 } });

  test("keeps only the agent timeline and Composer while retaining one Root", async ({ page }) => {
    const agent = await seedMockAgentWorkspace({
      repoPrefix: "mobile-complete-root-mount-",
      title: "Mobile Compact mount contract",
      initialPrompt: "Show the Mobile Compact timeline fixture.",
    });

    try {
      const internalPath = buildAgentRoute(agent.workspaceId, agent.agentId);
      await page.goto(`/?paseoSurface=compact&paseoPath=${encodeURIComponent(internalPath)}`);
      await expect(page.getByRole("textbox", { name: "Message agent..." }).first()).toBeVisible({
        timeout: 60_000,
      });

      const compactSurface = page.locator('[data-paseo-host-surface][data-surface="compact"]');
      await expect(compactSurface).toBeVisible();
      await expect(page.getByText("Show the Mobile Compact timeline fixture.")).toBeVisible();
      await expect(compactSurface).toHaveAttribute("data-compact-form-factor", "mobile");
      await expect(page.locator('button[aria-label="New tab"]:visible')).toHaveCount(0);
      await expect(page.locator('button[aria-label^="Runtime menu"]:visible')).toHaveCount(0);
      await expect(page.locator("[data-paseo-resize-handle]:visible")).toHaveCount(0);
      await expect(page.locator('button[aria-label="Close Compact"]:visible')).toHaveCount(1);
      await expect(page.locator('button[aria-label="Minimize"]:visible')).toHaveCount(0);
      await expect(page.locator('button[aria-label="Close menu"]:visible')).toHaveCount(0);
      await expect(page.locator('button[aria-label="Open menu"]:visible')).toHaveCount(0);
      await expect(page.locator('button[aria-label="Open Explorer sidebar"]:visible')).toHaveCount(
        0,
      );
      await expect(page.getByTestId("sidebar-home")).toHaveCount(0);
      await expect(page.getByTestId("sidebar-settings")).toHaveCount(0);
      await expect(page.getByTestId("sidebar-project-list")).toHaveCount(0);
      await expect(page.locator("[data-paseo-app-root]")).toHaveCount(1);

      const expectCenteredInVisualViewport = async () => {
        await expect
          .poll(async () => {
            const [surfaceRect, visualViewport] = await Promise.all([
              compactSurface.boundingBox(),
              readVisualViewport(page),
            ]);
            if (!surfaceRect) return { horizontallyCentered: false, verticallyCentered: false };
            return {
              horizontallyCentered:
                Math.abs(
                  surfaceRect.x +
                    surfaceRect.width / 2 -
                    (visualViewport.left + visualViewport.width / 2),
                ) < 0.5,
              verticallyCentered:
                Math.abs(
                  surfaceRect.y +
                    surfaceRect.height / 2 -
                    (visualViewport.top + visualViewport.height / 2),
                ) < 0.5,
            };
          })
          .toEqual({ horizontallyCentered: true, verticallyCentered: true });
        const [surfaceRect, visualViewport] = await Promise.all([
          compactSurface.boundingBox(),
          readVisualViewport(page),
        ]);
        expect(surfaceRect).not.toBeNull();
        expect(surfaceRect!.x).toBeGreaterThanOrEqual(0);
        expect(surfaceRect!.y).toBeGreaterThanOrEqual(0);
        expect(surfaceRect!.x + surfaceRect!.width).toBeLessThanOrEqual(
          visualViewport.left + visualViewport.width,
        );
        expect(surfaceRect!.y + surfaceRect!.height).toBeLessThanOrEqual(
          visualViewport.top + visualViewport.height,
        );
        return surfaceRect!;
      };
      const initialRect = await expectCenteredInVisualViewport();

      const headerRect = await page.locator("[data-paseo-compact-header]").boundingBox();
      expect(headerRect).not.toBeNull();
      await page.mouse.move(headerRect!.x + headerRect!.width / 2, headerRect!.y + 8);
      await page.mouse.down();
      await page.mouse.move(headerRect!.x + 48, headerRect!.y + 96, { steps: 4 });
      await page.mouse.up();
      expect(await compactSurface.boundingBox()).toEqual(initialRect);

      const cdp = await page.context().newCDPSession(page);
      const touchStart = { x: headerRect!.x + 16, y: headerRect!.y + 16 };
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ ...touchStart, radiusX: 2, radiusY: 2, force: 1 }],
      });
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [
          { x: touchStart.x + 64, y: touchStart.y + 96, radiusX: 2, radiusY: 2, force: 1 },
        ],
      });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await cdp.detach();
      expect(await compactSurface.boundingBox()).toEqual(initialRect);

      const identityBeforeFull = await page.evaluate(() => ({
        rootGeneration: window.__paseoCompleteRootV1!.diagnostics()!.rootGeneration,
        activeConnectionCount:
          window.__paseoCompleteRootV1!.diagnostics()!.owner!.runtime.activeConnectionCount,
      }));
      const compactComposer = page.locator("textarea:visible");
      await compactComposer.fill("Mobile Compact retained draft");
      await compactComposer.evaluate((element: HTMLTextAreaElement) =>
        element.setSelectionRange(7, 14),
      );

      await page.locator('button[aria-label="Open full Paseo"]:visible').click();
      await expect(page.locator("#root")).toHaveAttribute("data-paseo-committed-surface", "full");
      await page.locator('button[aria-label="Return to Compact"]:visible').click();
      await expect(page.locator("#root")).toHaveAttribute(
        "data-paseo-committed-surface",
        "compact",
      );
      await expect(compactComposer).toHaveValue("Mobile Compact retained draft");
      expect(
        await compactComposer.evaluate((element: HTMLTextAreaElement) => [
          element.selectionStart,
          element.selectionEnd,
        ]),
      ).toEqual([7, 14]);
      expect(
        await page.evaluate(() => ({
          rootGeneration: window.__paseoCompleteRootV1!.diagnostics()!.rootGeneration,
          activeConnectionCount:
            window.__paseoCompleteRootV1!.diagnostics()!.owner!.runtime.activeConnectionCount,
        })),
      ).toEqual(identityBeforeFull);

      await page.setViewportSize({ width: 375, height: 560 });
      await expectCenteredInVisualViewport();
      await expect(page.getByRole("textbox", { name: "Message agent..." }).first()).toBeVisible();

      await page.setViewportSize({ width: 812, height: 390 });
      await expect(compactSurface).toHaveAttribute("data-compact-form-factor", "mobile");
      await expectCenteredInVisualViewport();
      await expect(page.getByRole("textbox", { name: "Message agent..." }).first()).toBeVisible();

      await page.locator('button[aria-label="Close Compact"]:visible').click();
      await expect(compactSurface).not.toBeVisible();
      const fab = page.locator("[data-paseo-fab]:visible");
      await expect(fab).toBeVisible();
      await expect(fab).toBeFocused();
      await fab.click();
      await expect(compactSurface).toBeVisible();
      await expect(compactSurface).toHaveAttribute("data-compact-form-factor", "mobile");
      expect(
        await page.evaluate(() => ({
          rootGeneration: window.__paseoCompleteRootV1!.diagnostics()!.rootGeneration,
          activeConnectionCount:
            window.__paseoCompleteRootV1!.diagnostics()!.owner!.runtime.activeConnectionCount,
        })),
      ).toEqual(identityBeforeFull);
    } finally {
      await agent.cleanup();
    }
  });
});
