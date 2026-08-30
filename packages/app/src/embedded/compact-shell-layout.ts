export const COMPACT_MIN_WIDTH = 360;
export const COMPACT_MIN_HEIGHT = 480;
export const COMPACT_DEFAULT_WIDTH = 380;
export const COMPACT_DEFAULT_HEIGHT = 600;
export const COMPACT_MAX_VIEWPORT_RATIO = 0.9;

export type CompactResizeDirection = "left" | "top" | "corner";

export interface CompactSize {
  width: number;
  height: number;
}

export interface CompactViewport {
  width: number;
  height: number;
}

export interface ResolvedCompactSize extends CompactSize {
  maxWidth: number;
  maxHeight: number;
}

export function resolveCompactSize(
  requested: CompactSize | undefined,
  viewport: CompactViewport,
): ResolvedCompactSize {
  const maxWidth = Math.floor(viewport.width * COMPACT_MAX_VIEWPORT_RATIO);
  const maxHeight = Math.floor(viewport.height * COMPACT_MAX_VIEWPORT_RATIO);
  const minWidth = Math.min(COMPACT_MIN_WIDTH, maxWidth);
  const minHeight = Math.min(COMPACT_MIN_HEIGHT, maxHeight);
  return {
    width: clamp(requested?.width ?? COMPACT_DEFAULT_WIDTH, minWidth, maxWidth),
    height: clamp(requested?.height ?? COMPACT_DEFAULT_HEIGHT, minHeight, maxHeight),
    maxWidth,
    maxHeight,
  };
}

export function resizeCompactWindow(input: {
  direction: CompactResizeDirection;
  start: CompactSize;
  pointerStart: { x: number; y: number };
  pointerCurrent: { x: number; y: number };
  viewport: CompactViewport;
}): ResolvedCompactSize {
  const changesWidth = input.direction === "left" || input.direction === "corner";
  const changesHeight = input.direction === "top" || input.direction === "corner";
  return resolveCompactSize(
    {
      width: changesWidth
        ? input.start.width - (input.pointerCurrent.x - input.pointerStart.x)
        : input.start.width,
      height: changesHeight
        ? input.start.height - (input.pointerCurrent.y - input.pointerStart.y)
        : input.start.height,
    },
    input.viewport,
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
