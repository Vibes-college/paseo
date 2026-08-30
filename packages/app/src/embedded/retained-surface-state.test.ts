import { afterEach, describe, expect, it } from "vitest";
import {
  clearRetainedSurfaceState,
  getRetainedExpandedToolState,
  setRetainedExpandedToolState,
} from "./retained-surface-state";

afterEach(clearRetainedSurfaceState);

describe("retained embedded surface state", () => {
  it("retains copied Tool disclosure ids until the app owner clears them", () => {
    const inlineToolCallIds = new Set(["inline-1"]);
    const toolCallGroupIds = new Set(["group-1"]);
    setRetainedExpandedToolState("server:agent", { inlineToolCallIds, toolCallGroupIds });
    inlineToolCallIds.clear();
    toolCallGroupIds.clear();

    expect(getRetainedExpandedToolState("server:agent")).toEqual({
      inlineToolCallIds: new Set(["inline-1"]),
      toolCallGroupIds: new Set(["group-1"]),
    });

    clearRetainedSurfaceState();
    expect(getRetainedExpandedToolState("server:agent")).toBeNull();
  });
});
