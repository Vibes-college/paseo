import { useCallback, useEffect, useMemo } from "react";

import { useFetchQuery } from "@/data/query";
import { useFormPreferences } from "@/hooks/use-form-preferences";
import { isHostRuntimeConnected, useHostRuntimeSnapshot } from "@/runtime/host-runtime";
import { resolveChatRuntime, type ChatRuntimeResolution } from "./chat-runtime-resolution";

/**
 * Shared React Query owner for one Host's Chat startup contract. Chat screens and
 * sidebar history consume the same resolution; neither creates a second Host
 * connection or hidden workspace owner.
 */

export interface UseChatRuntimeResult {
  resolution: ChatRuntimeResolution;
  retry(): Promise<void>;
}

const HOST_HANDSHAKE_PENDING: ChatRuntimeResolution = {
  status: "pending",
  code: "host_handshake_pending",
  retryable: true,
};

export function useChatRuntime(serverId: string): UseChatRuntimeResult {
  const runtime = useHostRuntimeSnapshot(serverId);
  const client = runtime?.client ?? null;
  const connected = isHostRuntimeConnected(runtime);
  const { preferences, isLoading: preferencesLoading } = useFormPreferences();
  const preferencesKey = useMemo(() => JSON.stringify(preferences), [preferences]);
  const query = useFetchQuery({
    queryKey: ["chatRuntime", serverId, runtime?.clientGeneration ?? 0, preferencesKey],
    enabled: Boolean(serverId && client && connected && !preferencesLoading),
    retry: false,
    staleTimeMs: 30_000,
    dataShape: "value",
    queryFn: async () => {
      if (!client) return HOST_HANDSHAKE_PENDING;
      return resolveChatRuntime({ client, preferences });
    },
  });
  const resolution = useMemo<ChatRuntimeResolution>(
    () =>
      !serverId || !client || !connected || preferencesLoading || query.isPending
        ? HOST_HANDSHAKE_PENDING
        : (query.data ?? {
            status: "error",
            code: "workspace_resolve_failed",
            retryable: true,
          }),
    [client, connected, preferencesLoading, query.data, query.isPending, serverId],
  );
  const refetch = query.refetch;
  const isProviderCatalogLoading =
    resolution.status === "pending" && resolution.code === "provider_catalog_loading";

  useEffect(() => {
    if (!client || !isProviderCatalogLoading) {
      return;
    }
    return client.on("providers_snapshot_update", () => {
      void refetch();
    });
  }, [client, isProviderCatalogLoading, refetch]);

  const retry = useCallback(async () => {
    if (!client || !connected || preferencesLoading) return;
    await refetch();
  }, [client, connected, preferencesLoading, refetch]);

  return { resolution, retry };
}
