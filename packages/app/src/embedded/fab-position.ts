const VIEWPORT_MARGIN = 8;

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export function constrainPaseoFabPosition(position: Point, viewport: Size, fab: Size): Point {
  return {
    x: Math.max(
      VIEWPORT_MARGIN,
      Math.min(position.x, viewport.width - fab.width - VIEWPORT_MARGIN),
    ),
    y: Math.max(
      VIEWPORT_MARGIN,
      Math.min(position.y, viewport.height - fab.height - VIEWPORT_MARGIN),
    ),
  };
}

export function snapPaseoFabPosition(position: Point, viewport: Size, fab: Size): Point {
  const constrained = constrainPaseoFabPosition(position, viewport, fab);
  return {
    x:
      constrained.x + fab.width / 2 < viewport.width / 2
        ? VIEWPORT_MARGIN
        : viewport.width - fab.width - VIEWPORT_MARGIN,
    y: constrained.y,
  };
}
