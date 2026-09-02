import { useCallback, useMemo } from "react";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";

import { AgentList } from "@/components/agent-list";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";
import { useAgentHistory } from "@/hooks/use-agent-history";
import { navigateToChatAgent } from "./navigation";
import { useChatRuntime } from "./use-chat-runtime";

const ThemedLoadingSpinner = withUnistyles(LoadingSpinner, (theme) => ({
  color: theme.colors.foregroundMuted,
}));

/** Chat-only history projection. The hidden workspace identity never renders. */
export function ChatHistoryList({
  serverId,
  selectedAgentId,
  onSelect,
}: {
  serverId: string;
  selectedAgentId?: string;
  onSelect?: () => void;
}) {
  const runtime = useChatRuntime(serverId);
  const retryRuntime = runtime.retry;
  const workspaceIds = useMemo(
    () => (runtime.resolution.status === "ready" ? [runtime.resolution.workspace.workspaceId] : []),
    [runtime.resolution],
  );
  const history = useAgentHistory({
    serverId,
    workspaceIds,
    enabled: workspaceIds.length > 0,
  });
  const handleAgentPress = useCallback(
    (agent: AggregatedAgent) => {
      navigateToChatAgent(serverId, agent.id);
    },
    [serverId],
  );
  const refreshHistory = history.refreshAll;
  const handleRuntimeRetry = useCallback(() => {
    void retryRuntime();
  }, [retryRuntime]);
  const handleRefresh = useCallback(() => {
    void refreshHistory();
  }, [refreshHistory]);

  if (runtime.resolution.status === "pending") {
    return (
      <View style={styles.center} testID="chat-history-loading">
        <ThemedLoadingSpinner size="large" />
      </View>
    );
  }
  if (runtime.resolution.status === "unsupported") {
    return (
      <View style={styles.center} testID="chat-history-unsupported">
        <Text style={styles.message}>Update this Host to use Chat.</Text>
      </View>
    );
  }
  if (runtime.resolution.status === "error" || history.isError) {
    return (
      <View style={styles.center} testID="chat-history-error">
        <Text style={styles.message}>Unable to load Chat history.</Text>
        <Button variant="ghost" onPress={handleRuntimeRetry} testID="chat-history-retry">
          Retry
        </Button>
      </View>
    );
  }
  if (history.isInitialLoad) {
    return (
      <View style={styles.center} testID="chat-history-loading">
        <ThemedLoadingSpinner size="large" />
      </View>
    );
  }
  if (history.agents.length === 0) {
    return (
      <View style={styles.center} testID="chat-history-empty">
        <Text style={styles.message}>No chats yet</Text>
      </View>
    );
  }

  return (
    <View style={styles.list} testID="chat-history-list">
      <AgentList
        agents={history.agents}
        selectedAgentId={selectedAgentId ? `${serverId}:${selectedAgentId}` : undefined}
        onAgentSelect={onSelect}
        onAgentPress={handleAgentPress}
        showCheckoutInfo={false}
        showHostColumn={false}
        isRefreshing={history.isRevalidating}
        onRefresh={handleRefresh}
      />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  list: {
    flex: 1,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[3],
    padding: theme.spacing[4],
  },
  message: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
  },
}));
