export const COMPACT_MIN_WIDTH = 360;
export const COMPACT_MIN_HEIGHT = 480;
export const COMPACT_DEFAULT_WIDTH = 380;
export const COMPACT_DEFAULT_HEIGHT = 600;
export const COMPACT_MAX_VIEWPORT_RATIO = 0.9;
export const COMPACT_MOBILE_BREAKPOINT = 720;
export const COMPACT_MOBILE_EDGE_PADDING = 8;

export type CompactResizeDirection = "left" | "top" | "corner";

export interface CompactSize {
  width: number;
  height: number;
}

export interface CompactViewport {
  width: number;
  height: number;
}

export interface CompactVisualViewport extends CompactViewport {
  offsetLeft: number;
  offsetTop: number;
}

export interface CompactSafeAreaInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface ResolvedCompactSize extends CompactSize {
  maxWidth: number;
  maxHeight: number;
}

export interface ResolvedMobileCompactLayout extends ResolvedCompactSize {
  x: number;
  y: number;
}

export type CompactHostFormFactor = "desktop" | "mobile";

export function resolveCompactHostFormFactor(input: {
  viewportWidth: number;
  hasCoarsePointer: boolean;
}): CompactHostFormFactor {
  return input.hasCoarsePointer || input.viewportWidth < COMPACT_MOBILE_BREAKPOINT
    ? "mobile"
    : "desktop";
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

export function resolveMobileCompactLayout(input: {
  requested: CompactSize | undefined;
  viewport: CompactVisualViewport;
  safeArea: CompactSafeAreaInsets;
}): ResolvedMobileCompactLayout {
  const left = input.viewport.offsetLeft + input.safeArea.left + COMPACT_MOBILE_EDGE_PADDING;
  const top = input.viewport.offsetTop + input.safeArea.top + COMPACT_MOBILE_EDGE_PADDING;
  const availableWidth = Math.max(
    0,
    input.viewport.width -
      input.safeArea.left -
      input.safeArea.right -
      COMPACT_MOBILE_EDGE_PADDING * 2,
  );
  const availableHeight = Math.max(
    0,
    input.viewport.height -
      input.safeArea.top -
      input.safeArea.bottom -
      COMPACT_MOBILE_EDGE_PADDING * 2,
  );
  const size = resolveCompactSize(input.requested, {
    width: availableWidth,
    height: availableHeight,
  });
  return {
    ...size,
    x: left + (availableWidth - size.width) / 2,
    y: top + (availableHeight - size.height) / 2,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
