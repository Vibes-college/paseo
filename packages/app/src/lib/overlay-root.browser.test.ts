import { afterEach, describe, expect, it } from "vitest";
import { getOverlayRoot, getWebOverlayDiagnostics, installOwnedOverlayRoot } from "./overlay-root";

let release: (() => void) | null = null;

afterEach(() => {
  release?.();
  release = null;
  document.body.replaceChildren();
});

describe("owned web overlay root", () => {
  it("keeps embedded portals inside the mount container", () => {
    const container = document.createElement("div");
    const overlay = document.createElement("div");
    container.appendChild(overlay);
    document.body.appendChild(container);
    release = installOwnedOverlayRoot(overlay);

    expect(getOverlayRoot()).toBe(overlay);
    expect(overlay.parentElement).toBe(container);
    expect(getWebOverlayDiagnostics().ownedRootInstalled).toBe(true);
  });

  it("rejects a second overlay owner", () => {
    release = installOwnedOverlayRoot(document.createElement("div"));
    expect(() => installOwnedOverlayRoot(document.createElement("div"))).toThrow(
      "a Paseo overlay root owner is already installed",
    );
  });
});
