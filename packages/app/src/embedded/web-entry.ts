import * as metroRuntime from "@expo/metro-runtime";
import { createPaseoHostShell, type PaseoHostShell } from "./compact-host-shell.web";
import { mountPaseoApp, type MountedPaseoApp } from "./mount";
import type {
  PaseoHostActivity,
  PaseoMountCallbacks,
  PaseoMountSnapshot,
  PaseoSurface,
} from "./mount-environment";

void metroRuntime;

interface CompleteRootHarness {
  ready: Promise<void>;
  updateActivity(activity: PaseoHostActivity): Promise<void>;
  setSurface(surface: PaseoSurface): Promise<void>;
  dispose(): Promise<void>;
  remount(): Promise<void>;
  diagnostics():
    | (ReturnType<MountedPaseoApp["diagnostics"]> & {
        shell: ReturnType<PaseoHostShell["diagnostics"]>;
        minimizeRequestCount: number;
      })
    | null;
}

declare global {
  interface Window {
    __paseoCompleteRootV1?: CompleteRootHarness;
  }
}

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error('Complete Paseo App requires the Expo root element "#root"');
}
const hostRoot: HTMLElement = rootElement;

const originalStyles = {
  document: document.documentElement.style.cssText,
  body: document.body.style.cssText,
  root: hostRoot.style.cssText,
};
const search = new URLSearchParams(window.location.search);
const initialPath = search.get("paseoPath") ?? "/";
const initialActivity: PaseoHostActivity = {
  visible: true,
  focused: document.hasFocus(),
  foreground: document.visibilityState === "visible",
};
let snapshot: PaseoMountSnapshot = {
  surface: search.get("paseoSurface") === "compact" ? "compact" : "full",
  activity: initialActivity,
};
let mounted: MountedPaseoApp | null = null;
let shell: PaseoHostShell | null = null;
let requestCount = 0;
let minimizeRequestCount = 0;
let releaseHostSentinel: () => void = () => undefined;

const updateSurface = async (surface: PaseoSurface) => {
  snapshot = { ...snapshot, surface };
  shell?.setSurface(surface);
  await mounted?.update(snapshot);
};

const reportFatal = (error: unknown) => {
  callbacks.fatal({
    code: "surface-update-failed",
    message: error instanceof Error ? error.message : "Paseo surface update failed",
    cause: error,
  });
};

const callbacks: PaseoMountCallbacks = {
  requestSurface: (surface) => {
    requestCount += 1;
    hostRoot.dataset.paseoRequestedSurface = surface;
    hostRoot.dataset.paseoRequestCount = String(requestCount);
    void updateSurface(surface).catch(reportFatal);
  },
  requestMinimize: () => {
    minimizeRequestCount += 1;
    hostRoot.dataset.paseoMinimizeRequestCount = String(minimizeRequestCount);
  },
  surfaceCommitted: (surface) => {
    hostRoot.dataset.paseoCommittedSurface = surface;
  },
  shellPresentationChanged: (presentation) => {
    hostRoot.dataset.paseoPresentationTitle = presentation.title;
    hostRoot.dataset.paseoPresentationState = presentation.state;
  },
  firstCommit: () => {
    hostRoot.dataset.paseoFirstCommit = "true";
  },
  fatal: (failure) => {
    hostRoot.dataset.paseoFatal = failure.code;
    console.error("[CompletePaseoMount] fatal", failure);
  },
};

const start = async () => {
  applyMountStyles();
  shell = createPaseoHostShell({
    root: hostRoot,
    initialSurface: snapshot.surface,
    onRequestSurface: callbacks.requestSurface,
    onRequestMinimize: callbacks.requestMinimize,
  });
  releaseHostSentinel =
    search.get("paseoHostSentinel") === "1" ? installHostSentinel(hostRoot) : () => undefined;
  mounted = await mountPaseoApp({
    container: shell.container,
    initial: snapshot,
    initialPath,
    shellSlots: shell.slots,
    callbacks,
  });
};

let ready = start();

window.__paseoCompleteRootV1 = {
  ready,
  updateActivity: async (activity) => {
    await ready;
    snapshot = { ...snapshot, activity };
    await mounted?.update(snapshot);
  },
  setSurface: async (surface) => {
    await ready;
    await updateSurface(surface);
  },
  dispose: async () => {
    await ready;
    await mounted?.dispose();
    mounted = null;
    shell?.dispose();
    shell = null;
    releaseHostSentinel();
    releaseHostSentinel = () => undefined;
    restoreHostStyles();
  },
  remount: async () => {
    await ready;
    if (mounted || shell) {
      throw new Error("dispose the Complete Paseo App before remounting");
    }
    ready = start();
    await ready;
  },
  diagnostics: () => {
    const mountDiagnostics = mounted?.diagnostics();
    const shellDiagnostics = shell?.diagnostics();
    if (!mountDiagnostics || !shellDiagnostics) return null;
    return { ...mountDiagnostics, shell: shellDiagnostics, minimizeRequestCount };
  },
};

function applyMountStyles() {
  Object.assign(document.documentElement.style, { width: "100%", height: "100%" });
  Object.assign(document.body.style, {
    width: "100%",
    height: "100%",
    margin: "0",
    overflow: "hidden",
  });
  Object.assign(hostRoot.style, {
    position: "relative",
    width: "100%",
    height: "100%",
    overflow: "hidden",
  });
}

function restoreHostStyles() {
  document.documentElement.style.cssText = originalStyles.document;
  document.body.style.cssText = originalStyles.body;
  hostRoot.style.cssText = originalStyles.root;
  hostRoot.replaceChildren();
}

function installHostSentinel(root: HTMLElement): () => void {
  const sentinel = document.createElement("button");
  sentinel.type = "button";
  sentinel.dataset.paseoHostSentinel = "true";
  sentinel.textContent = "Host sentinel";
  Object.assign(sentinel.style, {
    position: "fixed",
    right: "8px",
    bottom: "8px",
    zIndex: "30000",
  });
  sentinel.addEventListener("click", () => {
    sentinel.dataset.clickCount = String(Number(sentinel.dataset.clickCount ?? "0") + 1);
  });
  root.parentElement?.insertBefore(sentinel, root);
  return () => sentinel.remove();
}
