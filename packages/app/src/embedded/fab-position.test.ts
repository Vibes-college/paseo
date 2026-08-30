import { describe, expect, it } from "vitest";
import { constrainPaseoFabPosition, snapPaseoFabPosition } from "./fab-position";

describe("Paseo FAB position", () => {
  it("clamps the FAB inside the viewport margin", () => {
    expect(
      constrainPaseoFabPosition(
        { x: -20, y: 900 },
        { width: 1000, height: 800 },
        { width: 40, height: 40 },
      ),
    ).toEqual({ x: 8, y: 752 });
  });

  it("snaps to the nearest horizontal edge without changing the clamped vertical position", () => {
    expect(
      snapPaseoFabPosition(
        { x: 200, y: 120 },
        { width: 1000, height: 800 },
        { width: 40, height: 40 },
      ),
    ).toEqual({ x: 8, y: 120 });
    expect(
      snapPaseoFabPosition(
        { x: 800, y: 120 },
        { width: 1000, height: 800 },
        { width: 40, height: 40 },
      ),
    ).toEqual({ x: 952, y: 120 });
  });
});
