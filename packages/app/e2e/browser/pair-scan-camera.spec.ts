import { test, expect } from "../support/fixtures";
import { gotoAppShell, openSettings } from "../support/helpers/app";
import { openAddHostFlow } from "../support/helpers/settings";

test("browser camera decodes a pairing QR without exposing the offer", async ({ page }) => {
  const remoteDecoderRequests: string[] = [];
  page.on("request", (request) => {
    if (/cdn\.jsdelivr\.net|\/jsqr(?:@|\/)/i.test(request.url())) {
      remoteDecoderRequests.push(request.url());
    }
  });

  await gotoAppShell(page);
  await openSettings(page);
  await openAddHostFlow(page);
  await page.getByTestId("add-host-method-scan-qr").click();

  const grantPermission = page.getByTestId("pair-scan-grant");
  if (await grantPermission.isVisible()) {
    await grantPermission.click();
  }

  await expect(page.getByTestId("pair-scan-camera")).toBeVisible();
  const error = page.getByTestId("pair-scan-error");
  await expect(error).toBeVisible({ timeout: 20_000 });
  await expect(error).not.toContainText("#offer=");
  await expect(error).not.toContainText("daemonPublicKeyB64");
  expect(remoteDecoderRequests).toEqual([]);
  await expect(page.getByTestId("pair-scan-retry")).toBeEnabled();
  await expect(page.getByTestId("pair-scan-back")).toBeEnabled();
  await expect(page.getByTestId("pair-scan-camera")).toHaveCount(0);

  await page.getByTestId("pair-scan-back").click();
  await expect(page).toHaveURL(/\/settings(?:\/|$)/);
  await expect(page.getByTestId("pair-scan-camera")).toHaveCount(0);
});
