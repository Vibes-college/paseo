import { ExpoRoot } from "expo-router/build/ExpoRoot";
import { Head } from "expo-router/build/head";
import { ctx } from "expo-router/_ctx";
import { AppRegistry } from "react-native";
import { createPaseoAppOwner, getPaseoAppOwnerDiagnostics } from "./app-owner";
import {
  PaseoMountCommitReporter,
  PaseoMountEnvironmentProvider,
  installPaseoMountController,
  type PaseoMountCallbacks,
  type PaseoMountController,
  type PaseoMountShellSlots,
  type PaseoMountSnapshot,
} from "./mount-environment";
import { getWebOverlayDiagnostics, installOwnedOverlayRoot } from "@/lib/overlay-root";
import type { PaseoLaunchSource } from "./launcher-draft";

const APP_KEY = "paseo-complete-root";
const EMBEDDED_LINKING = { enabled: false } as const;

export interface MountedPaseoApp {
  update(next: PaseoMountSnapshot): Promise<void>;
  dispose(): Promise<void>;
  diagnostics(): PaseoMountDiagnostics;
}

export interface PaseoMountDiagnostics {
  rootGeneration: number;
  disposed: boolean;
  rootNodes: number;
  owner: ReturnType<typeof getPaseoAppOwnerDiagnostics>;
  overlay: ReturnType<typeof getWebOverlayDiagnostics>;
}

interface RegisteredRootProps {
  controller: PaseoMountController;
}

class ExternalMountController implements PaseoMountController {
  private snapshot: PaseoMountSnapshot;
  private listeners = new Set<() => void>();

  constructor(
    readonly initialPath: string,
    readonly overlayRoot: HTMLElement,
    readonly shellSlots: PaseoMountShellSlots | null,
    readonly launchSource: PaseoLaunchSource | null,
    readonly callbacks: PaseoMountCallbacks,
    initial: PaseoMountSnapshot,
  ) {
    this.snapshot = initial;
  }

  getSnapshot = () => this.snapshot;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  update(next: PaseoMountSnapshot) {
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }
}

function CompletePaseoRoot({ controller }: RegisteredRootProps) {
  return (
    <PaseoMountEnvironmentProvider controller={controller}>
      <Head.Provider>
        <ExpoRoot context={ctx} location={controller.initialPath} linking={EMBEDDED_LINKING} />
      </Head.Provider>
      <PaseoMountCommitReporter />
    </PaseoMountEnvironmentProvider>
  );
}

function registerCompleteRoot() {
  if (!AppRegistry.getAppKeys().includes(APP_KEY)) {
    AppRegistry.registerComponent(APP_KEY, () => CompletePaseoRoot);
  }
}

export async function mountPaseoApp(input: {
  container: HTMLElement;
  initial: PaseoMountSnapshot;
  initialPath?: string;
  shellSlots?: PaseoMountShellSlots;
  launchSource?: PaseoLaunchSource;
  callbacks: PaseoMountCallbacks;
}): Promise<MountedPaseoApp> {
  if (!input.container.isConnected) {
    throw new Error("the Complete Paseo App container must be connected");
  }
  if (input.container.querySelector("[data-paseo-app-root]")) {
    throw new Error("the Complete Paseo App container is already mounted");
  }

  registerCompleteRoot();
  const owner = createPaseoAppOwner();
  const appNode = document.createElement("div");
  const overlayRoot = document.createElement("div");
  appNode.dataset.paseoAppRoot = String(owner.generation);
  overlayRoot.dataset.paseoOverlayRoot = String(owner.generation);
  Object.assign(appNode.style, {
    display: "flex",
    flex: "1 1 0%",
    width: "100%",
    height: "100%",
    minWidth: "0",
    minHeight: "0",
    overflow: "hidden",
  });
  Object.assign(overlayRoot.style, {
    position: "absolute",
    inset: "0",
    pointerEvents: "none",
    zIndex: "50",
  });
  input.container.append(appNode, overlayRoot);

  const controller = new ExternalMountController(
    normalizeInitialPath(input.initialPath),
    overlayRoot,
    input.shellSlots ?? null,
    input.launchSource ?? null,
    input.callbacks,
    input.initial,
  );
  let releaseController: (() => void) | null = null;
  let releaseOverlayRoot: (() => void) | null = null;
  let application: { unmount(): void } | null = null;
  let disposed = false;
  let queueTail = Promise.resolve();

  try {
    releaseController = installPaseoMountController(controller);
    releaseOverlayRoot = installOwnedOverlayRoot(overlayRoot);
    application = runApplication(appNode, controller);
  } catch (error) {
    releaseOverlayRoot?.();
    releaseController?.();
    appNode.remove();
    overlayRoot.remove();
    await owner.dispose();
    input.callbacks.fatal({
      code: "mount-failed",
      message: error instanceof Error ? error.message : "Complete Paseo App mount failed",
      cause: error,
    });
    throw error;
  }

  const enqueue = <T,>(task: () => Promise<T> | T): Promise<T> => {
    const result = queueTail.then(task);
    queueTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  const dispose = () =>
    enqueue(async () => {
      if (disposed) return;
      disposed = true;
      application?.unmount();
      application = null;
      await owner.dispose();
      releaseOverlayRoot?.();
      releaseOverlayRoot = null;
      releaseController?.();
      releaseController = null;
      appNode.remove();
      overlayRoot.remove();
    });

  return {
    update: (next) =>
      enqueue(() => {
        if (disposed) {
          throw new Error("the Complete Paseo App mount is disposed");
        }
        controller.update(next);
      }),
    dispose,
    diagnostics: () => ({
      rootGeneration: owner.generation,
      disposed,
      rootNodes: input.container.querySelectorAll("[data-paseo-app-root]").length,
      owner: getPaseoAppOwnerDiagnostics(),
      overlay: getWebOverlayDiagnostics(),
    }),
  };
}

function runApplication(
  rootTag: HTMLElement,
  controller: PaseoMountController,
): { unmount(): void } {
  const run = AppRegistry.runApplication as unknown as (
    appKey: string,
    parameters: {
      rootTag: HTMLElement;
      initialProps: RegisteredRootProps;
      mode: "concurrent";
    },
  ) => { unmount(): void };
  return run(APP_KEY, {
    rootTag,
    initialProps: { controller },
    mode: "concurrent",
  });
}

function normalizeInitialPath(value: string | undefined): string {
  const path = value?.trim();
  if (!path || !path.startsWith("/")) return "/";
  return path;
}
