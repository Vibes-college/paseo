import { describe, expect, it } from "vitest";
import {
  COMPACT_DEFAULT_HEIGHT,
  COMPACT_DEFAULT_WIDTH,
  COMPACT_MIN_HEIGHT,
  COMPACT_MIN_WIDTH,
  resolveCompactHostFormFactor,
  resolveCompactSize,
  resolveMobileCompactLayout,
  resizeCompactWindow,
} from "./compact-shell-layout";

describe("Compact host shell layout", () => {
  it("uses the approved default size within a desktop viewport", () => {
    expect(resolveCompactSize(undefined, { width: 1496, height: 731 })).toEqual({
      width: COMPACT_DEFAULT_WIDTH,
      height: COMPACT_DEFAULT_HEIGHT,
      maxWidth: 1346,
      maxHeight: 657,
    });
  });

  it("clamps size to the approved minimum and ninety percent viewport maximum", () => {
    expect(resolveCompactSize({ width: 120, height: 180 }, { width: 1496, height: 731 })).toEqual({
      width: COMPACT_MIN_WIDTH,
      height: COMPACT_MIN_HEIGHT,
      maxWidth: 1346,
      maxHeight: 657,
    });
    expect(resolveCompactSize({ width: 2000, height: 1200 }, { width: 1000, height: 800 })).toEqual(
      {
        width: 900,
        height: 720,
        maxWidth: 900,
        maxHeight: 720,
      },
    );
  });

  it("resizes only from the approved left, top, and top-left handles", () => {
    const input = {
      start: { width: 380, height: 600 },
      pointerStart: { x: 400, y: 200 },
      pointerCurrent: { x: 340, y: 160 },
      viewport: { width: 1496, height: 731 },
    };
    expect(resizeCompactWindow({ ...input, direction: "left" })).toMatchObject({
      width: 440,
      height: 600,
    });
    expect(resizeCompactWindow({ ...input, direction: "top" })).toMatchObject({
      width: 380,
      height: 640,
    });
    expect(resizeCompactWindow({ ...input, direction: "corner" })).toMatchObject({
      width: 440,
      height: 640,
    });
  });

  it("keeps coarse-pointer phones mobile through rotation without treating desktop as mobile", () => {
    expect(resolveCompactHostFormFactor({ viewportWidth: 390, hasCoarsePointer: false })).toBe(
      "mobile",
    );
    expect(resolveCompactHostFormFactor({ viewportWidth: 812, hasCoarsePointer: true })).toBe(
      "mobile",
    );
    expect(resolveCompactHostFormFactor({ viewportWidth: 812, hasCoarsePointer: false })).toBe(
      "desktop",
    );
  });

  it("centers Mobile Compact inside the safe visual viewport", () => {
    expect(
      resolveMobileCompactLayout({
        requested: { width: 380, height: 600 },
        viewport: { offsetLeft: 3, offsetTop: 100, width: 390, height: 400 },
        safeArea: { top: 47, right: 0, bottom: 34, left: 0 },
      }),
    ).toEqual({
      x: 30,
      y: 170.5,
      width: 336,
      height: 272,
      maxWidth: 336,
      maxHeight: 272,
    });
  });
});
