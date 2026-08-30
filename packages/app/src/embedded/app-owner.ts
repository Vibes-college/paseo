import { queryClient } from "@/data/query-client";
import { HostRuntimeStore, installOwnedHostRuntimeStore } from "@/runtime/host-runtime";
import { useAddProjectFlowStore } from "@/stores/add-project-flow-store";
import { useCreateFlowStore } from "@/stores/create-flow-store";
import { useDownloadStore } from "@/stores/download-store";
import { useKeyboardShortcutsStore } from "@/stores/keyboard-shortcuts-store";
import { useProviderSettingsStore } from "@/stores/provider-settings-store";
import { useSessionStore } from "@/stores/session-store";
import { useWorkspaceDraftSubmissionStore } from "@/stores/workspace-draft-submission-store";
import { useWorkspaceSetupStore } from "@/stores/workspace-setup-store";

interface ResettableStore {
  getInitialState(): unknown;
  setState(state: unknown, replace: true): void;
}

const transientStores = [
  useSessionStore,
  useWorkspaceDraftSubmissionStore,
  useKeyboardShortcutsStore,
  useCreateFlowStore,
  useDownloadStore,
  useProviderSettingsStore,
  useWorkspaceSetupStore,
  useAddProjectFlowStore,
] as unknown as ResettableStore[];

let activeOwner: PaseoAppOwner | null = null;
let nextGeneration = 0;

export interface PaseoAppOwnerDiagnostics {
  generation: number;
  installed: boolean;
  disposed: boolean;
  runtime: ReturnType<HostRuntimeStore["getOwnerDiagnostics"]>;
}

export interface PaseoAppOwner {
  readonly generation: number;
  diagnostics(): PaseoAppOwnerDiagnostics;
  dispose(): Promise<void>;
}

export function createPaseoAppOwner(): PaseoAppOwner {
  if (activeOwner) {
    throw new Error("a Paseo application owner is already installed");
  }

  const generation = ++nextGeneration;
  const runtime = new HostRuntimeStore();
  const releaseRuntime = installOwnedHostRuntimeStore(runtime);
  let disposed = false;

  const owner: PaseoAppOwner = {
    generation,
    diagnostics: () => ({
      generation,
      installed: activeOwner === owner,
      disposed,
      runtime: runtime.getOwnerDiagnostics(),
    }),
    dispose: async () => {
      if (disposed) return;
      disposed = true;
      await runtime.dispose();
      queryClient.clear();
      for (const store of transientStores) {
        store.setState(store.getInitialState(), true);
      }
      releaseRuntime();
      if (activeOwner === owner) {
        activeOwner = null;
      }
    },
  };

  activeOwner = owner;
  return owner;
}

export function getPaseoAppOwnerDiagnostics(): PaseoAppOwnerDiagnostics | null {
  return activeOwner?.diagnostics() ?? null;
}
