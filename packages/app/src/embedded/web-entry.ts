import * as metroRuntime from "@expo/metro-runtime";
import { mountPaseoApp, type MountedPaseoApp } from "./mount";
import type {
  PaseoHostActivity,
  PaseoMountCallbacks,
  PaseoMountSnapshot,
} from "./mount-environment";

void metroRuntime;

interface CompleteRootHarness {
  ready: Promise<void>;
  updateActivity(activity: PaseoHostActivity): Promise<void>;
  dispose(): Promise<void>;
  remount(): Promise<void>;
  diagnostics(): ReturnType<MountedPaseoApp["diagnostics"]> | null;
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
const container: HTMLElement = rootElement;

const originalStyles = {
  document: document.documentElement.style.cssText,
  body: document.body.style.cssText,
  container: container.style.cssText,
};
const search = new URLSearchParams(window.location.search);
const initialPath = search.get("paseoPath") ?? "/";
const initialActivity: PaseoHostActivity = {
  visible: true,
  focused: document.hasFocus(),
  foreground: document.visibilityState === "visible",
};
let snapshot: PaseoMountSnapshot = {
  surface: "full",
  activity: initialActivity,
};
let mounted: MountedPaseoApp | null = null;
let requestCount = 0;
let releaseHostSentinel: () => void = () => undefined;

const callbacks: PaseoMountCallbacks = {
  requestSurface: (surface) => {
    requestCount += 1;
    container.dataset.paseoRequestedSurface = surface;
    container.dataset.paseoRequestCount = String(requestCount);
  },
  surfaceCommitted: (surface) => {
    container.dataset.paseoCommittedSurface = surface;
  },
  shellPresentationChanged: (presentation) => {
    container.dataset.paseoPresentationState = presentation.state;
  },
  firstCommit: () => {
    container.dataset.paseoFirstCommit = "true";
  },
  fatal: (failure) => {
    container.dataset.paseoFatal = failure.code;
    console.error("[CompletePaseoMount] fatal", failure);
  },
};

const start = async () => {
  applyMountStyles();
  releaseHostSentinel =
    search.get("paseoHostSentinel") === "1" ? installHostSentinel(container) : () => undefined;
  mounted = await mountPaseoApp({
    container,
    initial: snapshot,
    initialPath,
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
  dispose: async () => {
    await ready;
    await mounted?.dispose();
    mounted = null;
    releaseHostSentinel();
    releaseHostSentinel = () => undefined;
    restoreHostStyles();
  },
  remount: async () => {
    await ready;
    if (mounted) {
      throw new Error("dispose the Complete Paseo App before remounting");
    }
    ready = start();
    await ready;
  },
  diagnostics: () => mounted?.diagnostics() ?? null,
};

function applyMountStyles() {
  Object.assign(document.documentElement.style, { width: "100%", height: "100%" });
  Object.assign(document.body.style, {
    width: "100%",
    height: "100%",
    margin: "0",
    overflow: "hidden",
  });
  Object.assign(container.style, { width: "100%", height: "100%", overflow: "hidden" });
}

function restoreHostStyles() {
  document.documentElement.style.cssText = originalStyles.document;
  document.body.style.cssText = originalStyles.body;
  container.style.cssText = originalStyles.container;
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
