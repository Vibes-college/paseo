import type { PaseoSurface } from "./mount-environment";
import {
  COMPACT_DEFAULT_HEIGHT,
  COMPACT_DEFAULT_WIDTH,
  resolveCompactSize,
  resizeCompactWindow,
  type CompactResizeDirection,
  type CompactSize,
} from "./compact-shell-layout";

export interface PaseoCompactShellSlots {
  newRuntime: HTMLElement;
  runtimeMenu: HTMLElement;
}

export interface PaseoHostShellDiagnostics {
  surface: PaseoSurface;
  width: number;
  height: number;
  headerHeight: number;
  resizeHandles: number;
  dragging: boolean;
}

export interface PaseoHostShell {
  readonly container: HTMLElement;
  readonly slots: PaseoCompactShellSlots;
  setSurface(surface: PaseoSurface): void;
  diagnostics(): PaseoHostShellDiagnostics;
  dispose(): void;
}

const HOST_STYLE = `
.vibes-paseo-surface{position:fixed;right:8px;bottom:8px;z-index:90;display:flex;min-width:0;min-height:0;flex-direction:column;box-sizing:border-box;overflow:hidden;border-radius:12px;background:#fff;box-shadow:0 16px 40px rgb(15 23 42 / 14%),0 3px 10px rgb(15 23 42 / 8%),0 0 0 1px #e4e4e7;color:#18181b}
.vibes-paseo-surface[data-surface="full"]{inset:0;width:100%;height:100%;border-radius:0;box-shadow:none}
.vibes-paseo-compact-header{position:relative;z-index:20;height:52px;min-height:52px;display:flex;align-items:center;gap:2px;padding:10px 16px;box-sizing:border-box;border-bottom:1px solid #e4e4e7;background:#fff}
.vibes-paseo-surface[data-surface="full"]>.vibes-paseo-compact-header{display:none}
.vibes-paseo-shell-slot{display:flex;min-width:0;align-items:center}.vibes-paseo-shell-slot[data-slot="runtime-menu"]{flex:1}
.vibes-paseo-host-button{width:32px;height:32px;display:inline-flex;flex:none;align-items:center;justify-content:center;padding:0;border:0;border-radius:8px;background:transparent;color:#71717a;cursor:pointer}
.vibes-paseo-host-button:hover{background:#f4f4f5;color:#18181b}.vibes-paseo-host-button:focus-visible{outline:2px solid #a1a1aa;outline-offset:2px}
.vibes-paseo-resize-handle{position:absolute;z-index:40}.vibes-paseo-resize-handle[data-direction="left"]{top:16px;bottom:0;left:0;width:4px;cursor:col-resize}.vibes-paseo-resize-handle[data-direction="top"]{top:0;right:0;left:16px;height:4px;cursor:row-resize}.vibes-paseo-resize-handle[data-direction="corner"]{top:0;left:0;width:16px;height:16px;cursor:nw-resize}
.vibes-paseo-surface[data-surface="full"]>.vibes-paseo-resize-handle{display:none}
`;

export function createPaseoHostShell(input: {
  root: HTMLElement;
  initialSurface: PaseoSurface;
  onRequestSurface(surface: PaseoSurface): void;
  onRequestMinimize(): void;
}): PaseoHostShell {
  const styleElement = document.createElement("style");
  styleElement.dataset.paseoCompactShellStyle = "true";
  styleElement.textContent = HOST_STYLE;
  document.head.appendChild(styleElement);

  const container = document.createElement("section");
  container.className = "vibes-paseo-surface";
  container.dataset.paseoHostSurface = "true";
  container.setAttribute("aria-label", "Paseo");

  const header = document.createElement("header");
  header.className = "vibes-paseo-compact-header";
  header.dataset.paseoCompactHeader = "true";

  const newRuntime = createSlot("new-runtime");
  const runtimeMenu = createSlot("runtime-menu");
  const fullButton = createHostButton("Open full Paseo", FULL_ICON);
  const minimizeButton = createHostButton("Minimize", MINIMIZE_ICON);
  fullButton.dataset.paseoCompactFull = "true";
  minimizeButton.dataset.paseoCompactMinimize = "true";
  fullButton.addEventListener("click", () => input.onRequestSurface("full"));
  minimizeButton.addEventListener("click", input.onRequestMinimize);
  header.append(newRuntime, runtimeMenu, fullButton, minimizeButton);

  const handles = (["left", "top", "corner"] as const).map((direction) => {
    const handle = document.createElement("div");
    handle.className = "vibes-paseo-resize-handle";
    handle.dataset.paseoResizeHandle = direction;
    handle.dataset.direction = direction;
    handle.setAttribute("aria-hidden", "true");
    return handle;
  });
  container.append(header, ...handles);
  input.root.replaceChildren(container);

  let surface = input.initialSurface;
  let size: CompactSize = { width: COMPACT_DEFAULT_WIDTH, height: COMPACT_DEFAULT_HEIGHT };
  let dragging = false;
  let disposeDrag: (() => void) | null = null;
  let disposed = false;

  const viewport = () => ({
    width: window.visualViewport?.width ?? document.documentElement.clientWidth,
    height: window.visualViewport?.height ?? document.documentElement.clientHeight,
  });
  const applySize = () => {
    const resolved = resolveCompactSize(size, viewport());
    size = { width: resolved.width, height: resolved.height };
    container.style.width = `${resolved.width}px`;
    container.style.height = `${resolved.height}px`;
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
    }
  };

  const startResize = (event: PointerEvent, direction: CompactResizeDirection) => {
    if (surface !== "compact") return;
    event.preventDefault();
    disposeDrag?.();
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture?.(event.pointerId);
    const pointerStart = { x: event.clientX, y: event.clientY };
    const start = { ...size };
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
      size = { width: resolved.width, height: resolved.height };
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

  const handleViewportResize = () => {
    if (surface === "compact") applySize();
  };
  window.addEventListener("resize", handleViewportResize);
  window.visualViewport?.addEventListener("resize", handleViewportResize);
  applySurface();

  return {
    container,
    slots: { newRuntime, runtimeMenu },
    setSurface(nextSurface) {
      if (disposed || surface === nextSurface) return;
      surface = nextSurface;
      applySurface();
    },
    diagnostics: () => ({
      surface,
      width: Math.round(container.getBoundingClientRect().width),
      height: Math.round(container.getBoundingClientRect().height),
      headerHeight: Math.round(header.getBoundingClientRect().height),
      resizeHandles: handles.filter((handle) => getComputedStyle(handle).display !== "none").length,
      dragging,
    }),
    dispose() {
      if (disposed) return;
      disposed = true;
      disposeDrag?.();
      window.removeEventListener("resize", handleViewportResize);
      window.visualViewport?.removeEventListener("resize", handleViewportResize);
      styleElement.remove();
      container.remove();
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
