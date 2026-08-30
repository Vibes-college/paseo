import { describe, expect, it } from "vitest";
import { clampSelectionRange, resolveRetainedScrollTop } from "./surface-retention-policy";

describe("Paseo surface retention", () => {
  it("restores a Timeline from its distance to the bottom across viewport heights", () => {
    expect(
      resolveRetainedScrollTop({ scrollHeight: 3000, clientHeight: 900, bottomOffset: 300 }),
    ).toBe(1800);
    expect(
      resolveRetainedScrollTop({ scrollHeight: 4453, clientHeight: 412, bottomOffset: 300.5 }),
    ).toBe(3740.5);
  });

  it("clamps a retained selection to the restored draft length", () => {
    expect(clampSelectionRange({ valueLength: 20, start: 4, end: 12 })).toEqual({
      start: 4,
      end: 12,
    });
    expect(clampSelectionRange({ valueLength: 6, start: 4, end: 12 })).toEqual({
      start: 4,
      end: 6,
    });
  });
});
