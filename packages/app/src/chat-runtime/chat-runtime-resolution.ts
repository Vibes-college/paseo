import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type {
  AgentModelDefinition,
  AgentProvider,
  ProviderSnapshotEntry,
} from "@getpaseo/protocol/agent-types";
import type { ServerInfoStatusPayload } from "@getpaseo/protocol/messages";

import type { FormPreferences, ProviderPreferences } from "@/create-agent-preferences/preferences";
import { findModelByReference } from "@/provider-selection/model-catalog";

/**
 * Host-scoped T1 boundary for Chat startup. It gates the new daemon RPC,
 * resolves the hidden workspace, and turns provider catalog + browser-local
 * preferences into one deterministic Agent config. It owns no UI, route,
 * history, draft, attachment, connection, or Agent lifecycle state.
 */

export interface ChatRuntimeClient {
  getLastServerInfoMessage(): ServerInfoStatusPayload | null;
  resolveChatWorkspace(
    requestId?: string,
  ): Promise<Awaited<ReturnType<DaemonClient["resolveChatWorkspace"]>>>;
  getProvidersSnapshot(options?: {
    cwd?: string;
  }): Promise<Awaited<ReturnType<DaemonClient["getProvidersSnapshot"]>>>;
}

type ChatWorkspace = NonNullable<
  Awaited<ReturnType<DaemonClient["resolveChatWorkspace"]>>["workspace"]
>;

export interface ChatAgentDefaults {
  provider: AgentProvider;
  model: string | null;
  modeId: string | null;
  thinkingOptionId: string | null;
  featureValues?: Record<string, unknown>;
}

export type ChatRuntimeResolution =
  | { status: "unsupported"; code: "host_update_required" }
  | {
      status: "pending";
      code: "host_handshake_pending";
      retryable: true;
    }
  | {
      status: "pending";
      code: "provider_catalog_loading";
      workspace: ChatWorkspace;
      retryable: true;
    }
  | {
      status: "error";
      code:
        | "workspace_duplicate_records"
        | "workspace_ownership_conflict"
        | "workspace_resolve_failed"
        | "provider_catalog_failed"
        | "provider_unavailable"
        | "no_provider_available";
      retryable: boolean;
    }
  | {
      status: "ready";
      workspace: ChatWorkspace;
      agentDefaults: ChatAgentDefaults;
    };

export async function resolveChatRuntime(input: {
  client: ChatRuntimeClient;
  preferences: FormPreferences;
}): Promise<ChatRuntimeResolution> {
  const serverInfo = input.client.getLastServerInfoMessage();
  if (!serverInfo) {
    return { status: "pending", code: "host_handshake_pending", retryable: true };
  }
  // COMPAT(chatWorkspace): added in v0.7.0, remove gate after 2027-09-02.
  if (serverInfo.features?.chatWorkspace !== true) {
    return { status: "unsupported", code: "host_update_required" };
  }

  const workspaceResolution = await resolveWorkspace(input.client);
  if (workspaceResolution.status !== "ready") return workspaceResolution;

  let snapshot: Awaited<ReturnType<ChatRuntimeClient["getProvidersSnapshot"]>>;
  try {
    snapshot = await input.client.getProvidersSnapshot({ cwd: workspaceResolution.workspace.cwd });
  } catch {
    return { status: "error", code: "provider_catalog_failed", retryable: true };
  }

  const defaults = resolveChatAgentDefaults({
    entries: snapshot.entries,
    preferences: input.preferences,
  });
  if (defaults.status === "pending") {
    return { ...defaults, workspace: workspaceResolution.workspace };
  }
  if (defaults.status === "error") return defaults;
  return {
    status: "ready",
    workspace: workspaceResolution.workspace,
    agentDefaults: defaults.agentDefaults,
  };
}

async function resolveWorkspace(
  client: ChatRuntimeClient,
): Promise<
  | { status: "ready"; workspace: ChatWorkspace }
  | Extract<ChatRuntimeResolution, { status: "error" }>
> {
  try {
    const result = await client.resolveChatWorkspace();
    if (result.workspace && !result.error) {
      return { status: "ready", workspace: result.workspace };
    }
    switch (result.error?.code) {
      case "duplicate_records":
        return { status: "error", code: "workspace_duplicate_records", retryable: false };
      case "ownership_conflict":
        return { status: "error", code: "workspace_ownership_conflict", retryable: false };
      default:
        return { status: "error", code: "workspace_resolve_failed", retryable: true };
    }
  } catch {
    return { status: "error", code: "workspace_resolve_failed", retryable: true };
  }
}

type ChatAgentDefaultsResolution =
  | { status: "ready"; agentDefaults: ChatAgentDefaults }
  | {
      status: "pending";
      code: "provider_catalog_loading";
      retryable: true;
    }
  | {
      status: "error";
      code: "provider_unavailable" | "no_provider_available";
      retryable: true;
    };

export function resolveChatAgentDefaults(input: {
  entries: ProviderSnapshotEntry[];
  preferences: FormPreferences;
}): ChatAgentDefaultsResolution {
  const enabledEntries = input.entries.filter((entry) => entry.enabled !== false);
  const preferredProvider = input.preferences.provider?.trim() ?? "";
  const providerResolution = preferredProvider
    ? resolvePreferredProvider(enabledEntries, preferredProvider)
    : resolveFirstReadyProvider(enabledEntries);
  if (providerResolution.status !== "ready") return providerResolution;

  const entry = providerResolution.entry;
  const providerPreferences = input.preferences.providerPreferences?.[entry.provider];
  const model = resolveModel(entry, providerPreferences);
  return {
    status: "ready",
    agentDefaults: {
      provider: entry.provider,
      model: model?.id ?? null,
      modeId: resolveModeId(entry, providerPreferences),
      thinkingOptionId: resolveThinkingOptionId(model, providerPreferences),
      ...(providerPreferences?.featureValues
        ? { featureValues: providerPreferences.featureValues }
        : {}),
    },
  };
}

type ProviderResolution =
  | { status: "ready"; entry: ProviderSnapshotEntry }
  | Extract<ChatAgentDefaultsResolution, { status: "pending" | "error" }>;

function resolvePreferredProvider(
  entries: ProviderSnapshotEntry[],
  preferredProvider: string,
): ProviderResolution {
  const entry = entries.find((candidate) => candidate.provider === preferredProvider);
  if (entry?.status === "ready") return { status: "ready", entry };
  if (entry?.status === "loading") {
    return { status: "pending", code: "provider_catalog_loading", retryable: true };
  }
  return { status: "error", code: "provider_unavailable", retryable: true };
}

function resolveFirstReadyProvider(entries: ProviderSnapshotEntry[]): ProviderResolution {
  const ready = entries
    .filter((entry) => entry.status === "ready")
    .sort((left, right) => left.provider.localeCompare(right.provider))[0];
  if (ready) return { status: "ready", entry: ready };
  if (entries.some((entry) => entry.status === "loading")) {
    return { status: "pending", code: "provider_catalog_loading", retryable: true };
  }
  return { status: "error", code: "no_provider_available", retryable: true };
}

function resolveModel(
  entry: ProviderSnapshotEntry,
  preferences: ProviderPreferences | undefined,
): AgentModelDefinition | null {
  const models = (entry.models ?? []).filter((model) => model.isSelectable !== false);
  const preferredModel = preferences?.model?.trim() ?? "";
  return (
    (preferredModel ? findModelByReference(models, preferredModel) : null) ??
    models.find((model) => model.isDefault) ??
    models[0] ??
    null
  );
}

function resolveModeId(
  entry: ProviderSnapshotEntry,
  preferences: ProviderPreferences | undefined,
): string | null {
  const modes = entry.modes ?? [];
  const preferredMode = preferences?.mode?.trim() ?? "";
  if (preferredMode && (modes.length === 0 || modes.some((mode) => mode.id === preferredMode))) {
    return preferredMode;
  }
  const defaultMode = entry.defaultModeId?.trim() ?? "";
  if (defaultMode && (modes.length === 0 || modes.some((mode) => mode.id === defaultMode))) {
    return defaultMode;
  }
  return modes[0]?.id ?? null;
}

function resolveThinkingOptionId(
  model: AgentModelDefinition | null,
  preferences: ProviderPreferences | undefined,
): string | null {
  if (!model) return null;
  const options = model.thinkingOptions ?? [];
  const references = [model.id, ...(model.aliases ?? [])];
  for (const reference of references) {
    const preferred = preferences?.thinkingByModel?.[reference]?.trim();
    if (preferred && options.some((option) => option.id === preferred)) return preferred;
  }
  const defaultOption = model.defaultThinkingOptionId?.trim() ?? "";
  if (defaultOption && options.some((option) => option.id === defaultOption)) return defaultOption;
  return options[0]?.id ?? null;
}
