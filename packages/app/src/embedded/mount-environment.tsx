import type { PaseoLaunchRequest, PaseoLaunchSource } from "./launcher-draft";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";

export type PaseoSurface = "compact" | "full";

export interface PaseoHostActivity {
  visible: boolean;
  focused: boolean;
  foreground: boolean;
}

export interface PaseoMountSnapshot {
  surface: PaseoSurface;
  activity: PaseoHostActivity;
}

export interface OpaquePaseoShellPresentation {
  title: string;
  state: "idle" | "running" | "attention";
}

export interface PaseoMountFailure {
  code: string;
  message: string;
  cause?: unknown;
}

export interface PaseoMountCallbacks {
  requestSurface(surface: PaseoSurface): void;
  requestMinimize(): void;
  surfaceCommitted(surface: PaseoSurface): void;
  shellPresentationChanged(presentation: OpaquePaseoShellPresentation): void;
  firstCommit(): void;
  fatal(error: PaseoMountFailure): void;
}

export interface PaseoMountShellSlots {
  // COMPAT(productHeaderSlot): added in v0.7.0, remove fallback after 2027-09-02.
  productHeader?: HTMLElement;
  newRuntime: HTMLElement;
  runtimeMenu: HTMLElement;
}

export interface PaseoMountController {
  readonly initialPath: string;
  readonly overlayRoot: HTMLElement;
  readonly shellSlots: PaseoMountShellSlots | null;
  readonly launchSource: PaseoLaunchSource | null;
  readonly callbacks: PaseoMountCallbacks;
  getSnapshot(): PaseoMountSnapshot;
  subscribe(listener: () => void): () => void;
}

const MountEnvironmentContext = createContext<PaseoMountController | null>(null);
let activeMountController: PaseoMountController | null = null;

export function installPaseoMountController(controller: PaseoMountController): () => void {
  if (activeMountController && activeMountController !== controller) {
    throw new Error("a Complete Paseo App mount is already active");
  }
  activeMountController = controller;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (activeMountController === controller) {
      activeMountController = null;
    }
  };
}

export function getActivePaseoMountController(): PaseoMountController | null {
  return activeMountController;
}

export function isEmbeddedPaseoApp(): boolean {
  return activeMountController !== null;
}

export function PaseoMountEnvironmentProvider({
  controller,
  children,
}: {
  controller: PaseoMountController;
  children: ReactNode;
}) {
  return (
    <MountEnvironmentContext.Provider value={controller}>
      {children}
    </MountEnvironmentContext.Provider>
  );
}

export function usePaseoMountEnvironment(): PaseoMountController | null {
  return useContext(MountEnvironmentContext);
}

export function usePaseoMountSnapshot(): PaseoMountSnapshot | null {
  const controller = usePaseoMountEnvironment();
  return useSyncExternalStore(
    controller?.subscribe ?? noopSubscribe,
    controller?.getSnapshot ?? nullSnapshot,
    controller?.getSnapshot ?? nullSnapshot,
  );
}

export function usePaseoLaunchRequest(): PaseoLaunchRequest | null {
  const source = usePaseoMountEnvironment()?.launchSource;
  return useSyncExternalStore(
    source?.subscribe ?? noopSubscribe,
    source?.getSnapshot ?? nullSnapshot,
    source?.getSnapshot ?? nullSnapshot,
  );
}

export function PaseoMountCommitReporter() {
  const controller = usePaseoMountEnvironment();
  const snapshot = usePaseoMountSnapshot();
  const firstCommitReported = useRef(false);

  useEffect(() => {
    if (!controller || !snapshot) return;
    if (!firstCommitReported.current) {
      firstCommitReported.current = true;
      controller.callbacks.firstCommit();
    }
    controller.callbacks.surfaceCommitted(snapshot.surface);
  }, [controller, snapshot]);

  return null;
}

function noopSubscribe() {
  return () => undefined;
}

function nullSnapshot() {
  return null;
}
