import { describe, expect, it, vi } from "vitest";
import {
  getActivePaseoMountController,
  installPaseoMountController,
  isEmbeddedPaseoApp,
  type PaseoMountController,
} from "./mount-environment";

function controller(): PaseoMountController {
  return {
    initialPath: "/",
    overlayRoot: {} as HTMLElement,
    shellSlots: null,
    callbacks: {
      requestSurface: vi.fn(),
      requestMinimize: vi.fn(),
      surfaceCommitted: vi.fn(),
      shellPresentationChanged: vi.fn(),
      firstCommit: vi.fn(),
      fatal: vi.fn(),
    },
    getSnapshot: () => ({
      surface: "full",
      activity: { visible: true, focused: true, foreground: true },
    }),
    subscribe: () => () => undefined,
  };
}

describe("Complete Paseo mount environment", () => {
  it("installs one exclusive controller and releases idempotently", () => {
    const first = controller();
    const release = installPaseoMountController(first);

    expect(isEmbeddedPaseoApp()).toBe(true);
    expect(getActivePaseoMountController()).toBe(first);
    expect(() => installPaseoMountController(controller())).toThrow(
      "a Complete Paseo App mount is already active",
    );

    release();
    release();
    expect(isEmbeddedPaseoApp()).toBe(false);
    expect(getActivePaseoMountController()).toBeNull();
  });
});
