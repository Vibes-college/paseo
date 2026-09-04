import type { OpaquePaseoShellPresentation, PaseoSurface } from "./mount-environment";
import { constrainPaseoFabPosition, snapPaseoFabPosition, type Point } from "./fab-position";
import {
  COMPACT_DEFAULT_HEIGHT,
  COMPACT_DEFAULT_WIDTH,
  resolveCompactHostFormFactor,
  resolveCompactSize,
  resolveMobileCompactLayout,
  resizeCompactWindow,
  type CompactHostFormFactor,
  type CompactResizeDirection,
  type CompactSafeAreaInsets,
  type CompactSize,
  type CompactVisualViewport,
} from "./compact-shell-layout";

export interface PaseoCompactShellSlots {
  productHeader: HTMLElement;
  newRuntime: HTMLElement;
  runtimeMenu: HTMLElement;
}

export interface PaseoHostShellDiagnostics {
  surface: PaseoSurface;
  minimized: boolean;
  hostVisible: boolean;
  width: number;
  height: number;
  headerHeight: number;
  resizeHandles: number;
  dragging: boolean;
  fabVisible: boolean;
  fabFocused: boolean;
  fabRect: { x: number; y: number; width: number; height: number } | null;
  compactFormFactor: CompactHostFormFactor;
}

export interface PaseoHostShell {
  readonly container: HTMLElement;
  readonly slots: PaseoCompactShellSlots;
  setSurface(surface: PaseoSurface): void;
  setPresentation(presentation: OpaquePaseoShellPresentation): void;
  setHostVisible(visible: boolean): void;
  minimizeToFab(): void;
  restoreFromFab(): void;
  focusFullButton(): void;
  diagnostics(): PaseoHostShellDiagnostics;
  dispose(): void;
}

const HOST_STYLE = `
.vibes-paseo-surface{position:fixed;right:8px;bottom:8px;z-index:90;display:flex;min-width:0;min-height:0;flex-direction:column;box-sizing:border-box;overflow:hidden;border-radius:12px;background:#fff;box-shadow:0 16px 40px rgb(15 23 42 / 14%),0 3px 10px rgb(15 23 42 / 8%),0 0 0 1px #e4e4e7;color:#18181b}
.vibes-paseo-surface[data-surface="full"]{inset:0;width:100%;height:100%;border-radius:0;box-shadow:none}
.vibes-paseo-compact-header{position:relative;z-index:20;height:52px;min-height:52px;display:flex;align-items:center;gap:2px;padding:10px 16px;box-sizing:border-box;border-bottom:1px solid #e4e4e7;background:#fff}
.vibes-paseo-surface[data-surface="full"]>.vibes-paseo-compact-header{display:none}
.vibes-paseo-shell-slot{display:flex;min-width:0;align-items:center}.vibes-paseo-shell-slot[data-slot="runtime-menu"]{flex:1}.vibes-paseo-shell-slot[data-slot="product-header"]{flex:1;align-self:stretch;width:100%}
.vibes-paseo-compact-header:has(>.vibes-paseo-shell-slot[data-slot="product-header"]>*){height:56px;min-height:56px;gap:0;padding:0}.vibes-paseo-compact-header:has(>.vibes-paseo-shell-slot[data-slot="product-header"]>*)>:not([data-slot="product-header"]){display:none}
.vibes-paseo-host-button{width:32px;height:32px;display:inline-flex;flex:none;align-items:center;justify-content:center;padding:0;border:0;border-radius:8px;background:transparent;color:#71717a;cursor:pointer}
.vibes-paseo-host-button:hover{background:#f4f4f5;color:#18181b}.vibes-paseo-host-button:focus-visible{outline:2px solid #a1a1aa;outline-offset:2px}
.vibes-paseo-fab{position:fixed;right:8px;bottom:8px;z-index:90;width:40px;height:40px;display:none;align-items:center;justify-content:center;padding:0;border:0;border-radius:9999px;background:#fff;color:#71717a;box-shadow:0 16px 40px rgb(15 23 42 / 14%),0 3px 10px rgb(15 23 42 / 8%),0 0 0 1px #e4e4e7;cursor:grab;touch-action:none}.vibes-paseo-fab:hover{background:#f4f4f5;color:#18181b}.vibes-paseo-fab:active{cursor:grabbing}.vibes-paseo-fab:focus-visible{outline:2px solid #a1a1aa;outline-offset:2px}
.vibes-paseo-fab[data-state="running"]{animation:vibes-paseo-fab-pulse 1.8s ease-in-out infinite}@keyframes vibes-paseo-fab-pulse{0%,100%{transform:scale(1)}50%{transform:scale(.92)}}
.vibes-paseo-resize-handle{position:absolute;z-index:40}.vibes-paseo-resize-handle[data-direction="left"]{top:16px;bottom:0;left:0;width:4px;cursor:col-resize}.vibes-paseo-resize-handle[data-direction="top"]{top:0;right:0;left:16px;height:4px;cursor:row-resize}.vibes-paseo-resize-handle[data-direction="corner"]{top:0;left:0;width:16px;height:16px;cursor:nw-resize}
.vibes-paseo-surface[data-surface="full"]>.vibes-paseo-resize-handle{display:none}
.vibes-paseo-surface[data-surface="compact"][data-compact-form-factor="mobile"]>.vibes-paseo-compact-header{justify-content:flex-end}
.vibes-paseo-surface[data-surface="compact"][data-compact-form-factor="mobile"]>.vibes-paseo-compact-header>.vibes-paseo-shell-slot:not([data-slot="product-header"]),.vibes-paseo-surface[data-surface="compact"][data-compact-form-factor="mobile"]>.vibes-paseo-resize-handle{display:none}
`;

export function createPaseoHostShell(input: {
  root: HTMLElement;
  initialSurface: PaseoSurface;
  onRequestSurface(surface: PaseoSurface): void;
  onRequestMinimize(): void;
  onRestoreCompact(): void;
}): PaseoHostShell {
  const styleElement = document.createElement("style");
  styleElement.dataset.paseoCompactShellStyle = "true";
  styleElement.textContent = HOST_STYLE;
  document.head.appendChild(styleElement);

  const safeAreaProbe = document.createElement("div");
  safeAreaProbe.dataset.paseoSafeAreaProbe = "true";
  Object.assign(safeAreaProbe.style, {
    position: "fixed",
    visibility: "hidden",
    pointerEvents: "none",
    paddingTop: "env(safe-area-inset-top, 0px)",
    paddingRight: "env(safe-area-inset-right, 0px)",
    paddingBottom: "env(safe-area-inset-bottom, 0px)",
    paddingLeft: "env(safe-area-inset-left, 0px)",
  });
  document.body.appendChild(safeAreaProbe);

  const container = document.createElement("section");
  container.className = "vibes-paseo-surface";
  container.dataset.paseoHostSurface = "true";
  container.setAttribute("aria-label", "Paseo");

  const header = document.createElement("header");
  header.className = "vibes-paseo-compact-header";
  header.dataset.paseoCompactHeader = "true";

  const productHeader = createSlot("product-header");
  const newRuntime = createSlot("new-runtime");
  const runtimeMenu = createSlot("runtime-menu");
  const fullButton = createHostButton("Open full Paseo", FULL_ICON);
  const minimizeButton = createHostButton("Minimize", MINIMIZE_ICON);
  fullButton.dataset.paseoCompactFull = "true";
  minimizeButton.dataset.paseoCompactMinimize = "true";
  fullButton.addEventListener("click", () => input.onRequestSurface("full"));
  minimizeButton.addEventListener("click", input.onRequestMinimize);
  header.append(productHeader, newRuntime, runtimeMenu, fullButton, minimizeButton);

  const handles = (["left", "top", "corner"] as const).map((direction) => {
    const handle = document.createElement("div");
    handle.className = "vibes-paseo-resize-handle";
    handle.dataset.paseoResizeHandle = direction;
    handle.dataset.direction = direction;
    handle.setAttribute("aria-hidden", "true");
    return handle;
  });
  container.append(header, ...handles);

  const fab = document.createElement("button");
  fab.type = "button";
  fab.className = "vibes-paseo-fab";
  fab.dataset.paseoFab = "true";
  fab.dataset.state = "idle";
  fab.setAttribute("aria-label", "Open Agent console");
  fab.title = "Open Agent console";
  fab.innerHTML = FAB_ICON;
  input.root.replaceChildren(container, fab);

  let surface = input.initialSurface;
  let requestedSize: CompactSize = {
    width: COMPACT_DEFAULT_WIDTH,
    height: COMPACT_DEFAULT_HEIGHT,
  };
  let resolvedSize: CompactSize = { ...requestedSize };
  let compactFormFactor: CompactHostFormFactor = "desktop";
  let minimized = false;
  let hostVisible = true;
  let dragging = false;
  let disposeDrag: (() => void) | null = null;
  let fabPosition: Point | null = null;
  let fabDrag: {
    pointerId: number;
    pointer: Point;
    start: Point;
    moved: boolean;
  } | null = null;
  let suppressFabClick = false;
  let disposed = false;

  const visualViewport = (): CompactVisualViewport => ({
    offsetLeft: window.visualViewport?.offsetLeft ?? 0,
    offsetTop: window.visualViewport?.offsetTop ?? 0,
    width: window.visualViewport?.width ?? document.documentElement.clientWidth,
    height: window.visualViewport?.height ?? document.documentElement.clientHeight,
  });
  const viewport = () => {
    const current = visualViewport();
    return { width: current.width, height: current.height };
  };
  const coarsePointerQuery = window.matchMedia?.("(hover: none) and (pointer: coarse)") ?? null;
  const readSafeArea = (): CompactSafeAreaInsets => {
    const style = getComputedStyle(safeAreaProbe);
    const read = (value: string) => Number.parseFloat(value) || 0;
    return {
      top: read(style.paddingTop),
      right: read(style.paddingRight),
      bottom: read(style.paddingBottom),
      left: read(style.paddingLeft),
    };
  };
  const fabSize = () => {
    const rect = fab.getBoundingClientRect();
    return { width: rect.width || 40, height: rect.height || 40 };
  };
  const applyFabPosition = () => {
    if (!fabPosition) {
      fab.style.removeProperty("left");
      fab.style.removeProperty("top");
      fab.style.removeProperty("right");
      fab.style.removeProperty("bottom");
      return;
    }
    const next = constrainPaseoFabPosition(fabPosition, viewport(), fabSize());
    fabPosition = next;
    fab.style.left = `${next.x}px`;
    fab.style.top = `${next.y}px`;
    fab.style.right = "auto";
    fab.style.bottom = "auto";
  };
  const applyVisibility = () => {
    const surfaceVisible = hostVisible && !minimized;
    const fabVisible = hostVisible && minimized;
    container.dataset.minimized = String(minimized);
    container.dataset.hostVisible = String(hostVisible);
    container.style.visibility = surfaceVisible ? "visible" : "hidden";
    container.style.pointerEvents = surfaceVisible ? "auto" : "none";
    if (surfaceVisible) {
      container.removeAttribute("aria-hidden");
    } else {
      container.setAttribute("aria-hidden", "true");
    }
    fab.style.display = fabVisible ? "flex" : "none";
    if (fabVisible) applyFabPosition();
  };
  const applySize = () => {
    const currentViewport = visualViewport();
    compactFormFactor = resolveCompactHostFormFactor({
      viewportWidth: currentViewport.width,
      hasCoarsePointer: coarsePointerQuery?.matches ?? false,
    });
    container.dataset.compactFormFactor = compactFormFactor;
    const compactActionLabel = compactFormFactor === "mobile" ? "Close Compact" : "Minimize";
    minimizeButton.setAttribute("aria-label", compactActionLabel);
    minimizeButton.title = compactActionLabel;
    minimizeButton.innerHTML = compactFormFactor === "mobile" ? CLOSE_ICON : MINIMIZE_ICON;
    const resolved =
      compactFormFactor === "mobile"
        ? resolveMobileCompactLayout({
            requested: requestedSize,
            viewport: currentViewport,
            safeArea: readSafeArea(),
          })
        : resolveCompactSize(requestedSize, currentViewport);
    resolvedSize = { width: resolved.width, height: resolved.height };
    container.style.width = `${resolved.width}px`;
    container.style.height = `${resolved.height}px`;
    if ("x" in resolved && "y" in resolved) {
      container.style.left = `${resolved.x}px`;
      container.style.top = `${resolved.y}px`;
      container.style.right = "auto";
      container.style.bottom = "auto";
      container.style.margin = "0";
    } else {
      container.style.removeProperty("left");
      container.style.removeProperty("top");
      container.style.removeProperty("right");
      container.style.removeProperty("bottom");
      container.style.removeProperty("margin");
    }
    container.dataset.paseoCompactWidth = String(resolved.width);
    container.dataset.paseoCompactHeight = String(resolved.height);
  };
  const applySurface = () => {
    container.dataset.surface = surface;
    if (surface === "compact") {
      container.removeAttribute("role");
      container.removeAttribute("aria-modal");
      applySize();
    } else {
      container.setAttribute("role", "dialog");
      container.setAttribute("aria-modal", "true");
      container.style.removeProperty("width");
      container.style.removeProperty("height");
      container.style.removeProperty("left");
      container.style.removeProperty("top");
      container.style.removeProperty("right");
      container.style.removeProperty("bottom");
      container.style.removeProperty("margin");
    }
  };

  const startResize = (event: PointerEvent, direction: CompactResizeDirection) => {
    if (surface !== "compact" || compactFormFactor === "mobile") return;
    event.preventDefault();
    disposeDrag?.();
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture?.(event.pointerId);
    const pointerStart = { x: event.clientX, y: event.clientY };
    const start = { ...resolvedSize };
    dragging = true;
    container.dataset.paseoResizeDragging = direction;
    document.body.style.cursor = {
      left: "col-resize",
      top: "row-resize",
      corner: "nw-resize",
    }[direction];
    document.body.style.userSelect = "none";

    const onMove = (moveEvent: PointerEvent) => {
      const resolved = resizeCompactWindow({
        direction,
        start,
        pointerStart,
        pointerCurrent: { x: moveEvent.clientX, y: moveEvent.clientY },
        viewport: viewport(),
      });
      requestedSize = { width: resolved.width, height: resolved.height };
      applySize();
    };
    const finish = () => {
      if (!dragging) return;
      dragging = false;
      container.removeAttribute("data-paseo-resize-dragging");
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", finish);
      document.removeEventListener("pointercancel", finish);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      disposeDrag = null;
    };
    disposeDrag = finish;
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", finish);
    document.addEventListener("pointercancel", finish);
  };

  for (const handle of handles) {
    const direction = handle.dataset.direction as CompactResizeDirection;
    handle.addEventListener("pointerdown", (event) => startResize(event, direction));
  }

  fab.addEventListener("pointerdown", (event) => {
    if (!event.isPrimary || event.button !== 0) return;
    const rect = fab.getBoundingClientRect();
    fabDrag = {
      pointerId: event.pointerId,
      pointer: { x: event.clientX, y: event.clientY },
      start: { x: rect.x, y: rect.y },
      moved: false,
    };
    fab.setPointerCapture?.(event.pointerId);
  });
  fab.addEventListener("pointermove", (event) => {
    const drag = fabDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.pointer.x;
    const dy = event.clientY - drag.pointer.y;
    if (!drag.moved && Math.hypot(dx, dy) < 3) return;
    drag.moved = true;
    event.preventDefault();
    fabPosition = constrainPaseoFabPosition(
      { x: drag.start.x + dx, y: drag.start.y + dy },
      viewport(),
      fabSize(),
    );
    applyFabPosition();
  });
  const finishFabDrag = (event: PointerEvent, cancelled: boolean) => {
    const drag = fabDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    fabDrag = null;
    if (fab.hasPointerCapture?.(event.pointerId)) {
      fab.releasePointerCapture?.(event.pointerId);
    }
    if (!drag.moved || cancelled) return;
    fabPosition = snapPaseoFabPosition(
      {
        x: drag.start.x + event.clientX - drag.pointer.x,
        y: drag.start.y + event.clientY - drag.pointer.y,
      },
      viewport(),
      fabSize(),
    );
    suppressFabClick = true;
    applyFabPosition();
  };
  fab.addEventListener("pointerup", (event) => finishFabDrag(event, false));
  fab.addEventListener("pointercancel", (event) => finishFabDrag(event, true));
  fab.addEventListener("keydown", (event) => {
    if (event.key === "Home") {
      event.preventDefault();
      fabPosition = null;
      applyFabPosition();
      return;
    }
    const delta = {
      ArrowLeft: [-16, 0],
      ArrowRight: [16, 0],
      ArrowUp: [0, -16],
      ArrowDown: [0, 16],
    }[event.key];
    if (!delta) return;
    event.preventDefault();
    const rect = fab.getBoundingClientRect();
    fabPosition = constrainPaseoFabPosition(
      { x: rect.x + delta[0], y: rect.y + delta[1] },
      viewport(),
      fabSize(),
    );
    applyFabPosition();
  });
  fab.addEventListener("click", () => {
    if (suppressFabClick) {
      suppressFabClick = false;
      return;
    }
    input.onRestoreCompact();
  });

  const handleViewportResize = () => {
    if (surface === "compact") applySize();
    if (minimized && fabPosition) applyFabPosition();
  };
  window.addEventListener("resize", handleViewportResize);
  window.visualViewport?.addEventListener("resize", handleViewportResize);
  window.visualViewport?.addEventListener("scroll", handleViewportResize);
  window.addEventListener("orientationchange", handleViewportResize);
  coarsePointerQuery?.addEventListener("change", handleViewportResize);
  applySurface();
  applyVisibility();

  return {
    container,
    slots: { productHeader, newRuntime, runtimeMenu },
    setSurface(nextSurface) {
      if (disposed) return;
      surface = nextSurface;
      if (surface === "full" && minimized) {
        minimized = false;
        applyVisibility();
      }
      applySurface();
    },
    setPresentation(presentation) {
      if (disposed) return;
      fab.dataset.state = presentation.state;
      const label = `Open Agent console — ${presentation.title}`;
      fab.setAttribute("aria-label", label);
      fab.title = label;
    },
    setHostVisible(visible) {
      if (disposed || hostVisible === visible) return;
      hostVisible = visible;
      applyVisibility();
      if (!hostVisible && document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
    },
    minimizeToFab() {
      if (disposed || surface !== "compact" || minimized) return;
      minimized = true;
      applyVisibility();
      if (hostVisible) requestAnimationFrame(() => fab.focus());
    },
    restoreFromFab() {
      if (disposed || !minimized) return;
      minimized = false;
      surface = "compact";
      applySurface();
      applyVisibility();
    },
    focusFullButton() {
      if (disposed || minimized || !hostVisible || surface !== "compact") return;
      requestAnimationFrame(() => {
        const productOpenFull = productHeader.querySelector<HTMLElement>("#paseo-open-full");
        const target = productOpenFull ?? fullButton;
        target.focus();
        requestAnimationFrame(() => target.focus());
      });
    },
    diagnostics: () => {
      const containerRect = container.getBoundingClientRect();
      const fabRect = fab.getBoundingClientRect();
      const fabVisible = getComputedStyle(fab).display !== "none";
      return {
        surface,
        minimized,
        hostVisible,
        width: Math.round(containerRect.width),
        height: Math.round(containerRect.height),
        headerHeight: Math.round(header.getBoundingClientRect().height),
        resizeHandles: handles.filter((handle) => getComputedStyle(handle).display !== "none")
          .length,
        dragging,
        fabVisible,
        fabFocused: document.activeElement === fab,
        fabRect: fabVisible
          ? {
              x: Math.round(fabRect.x),
              y: Math.round(fabRect.y),
              width: Math.round(fabRect.width),
              height: Math.round(fabRect.height),
            }
          : null,
        compactFormFactor,
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      disposeDrag?.();
      window.removeEventListener("resize", handleViewportResize);
      window.visualViewport?.removeEventListener("resize", handleViewportResize);
      window.visualViewport?.removeEventListener("scroll", handleViewportResize);
      window.removeEventListener("orientationchange", handleViewportResize);
      coarsePointerQuery?.removeEventListener("change", handleViewportResize);
      styleElement.remove();
      safeAreaProbe.remove();
      container.remove();
      fab.remove();
    },
  };
}

function createSlot(name: string): HTMLElement {
  const slot = document.createElement("div");
  slot.className = "vibes-paseo-shell-slot";
  slot.dataset.paseoShellSlot = name;
  slot.dataset.slot = name;
  return slot;
}

function createHostButton(label: string, icon: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "vibes-paseo-host-button";
  button.setAttribute("aria-label", label);
  button.title = label;
  button.innerHTML = icon;
  return button;
}

const FULL_ICON =
  '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>';
const MINIMIZE_ICON =
  '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M5 12h14"/></svg>';
const CLOSE_ICON =
  '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="m6 6 12 12"/><path d="m18 6-12 12"/></svg>';
const FAB_ICON =
  '<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/></svg>';
