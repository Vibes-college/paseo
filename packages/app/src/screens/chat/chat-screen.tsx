import { useCallback, useEffect, useLayoutEffect, useMemo, type ReactNode } from "react";
import { Text, View } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import { useRouter } from "expo-router";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { AgentSnapshotPayload } from "@getpaseo/protocol/messages";

import {
  FloatingPanelPortalHost,
  FloatingPanelPortalHostNameProvider,
} from "@/components/ui/floating-panel-portal";
import { MenuHeader } from "@/components/headers/menu-header";
import { Button } from "@/components/ui/button";
import { useAppQueryClient, useFetchQuery } from "@/data/query";
import { agentHistoryQueryKey } from "@/hooks/agent-history-query-key";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { WorkspaceDraftAgentTab } from "@/composer/draft/workspace-tab";
import { AgentPanelContent } from "@/panels/agent-panel";
import {
  createPaneFocusContextValue,
  PaneFocusProvider,
  PaneProvider,
  type PaneContextValue,
} from "@/panels/pane-context";
import { getHostRuntimeStore, useHostRuntimeClient } from "@/runtime/host-runtime";
import { useSessionStore, type Agent } from "@/stores/session-store";
import { applyLegacyDaemonWorkspaceOwnership } from "@/workspace/legacy-daemon-workspaces";
import { normalizeAgentSnapshot } from "@/utils/agent-snapshots";
import { buildHostChatAgentRoute } from "@/utils/host-routes";
import type { WorkspaceDraftTabSetup } from "@/workspace-tabs/model";
import {
  navigateToChatDraft,
  rememberChatRoute,
  useRememberChatRoute,
} from "@/chat-runtime/navigation";
import { useChatRuntime } from "@/chat-runtime/use-chat-runtime";

/**
 * Chat owns one Host-level conversation surface: hidden-workspace resolution,
 * exact Agent validation, a stable new-conversation draft, and Timeline/Composer
 * rendering. Build layouts, tabs, files, terminals, Git, and workspace actions do
 * not mount here.
 */

const CHAT_DRAFT_ID = "chat-new";
const CHAT_DRAFT_TAB_ID = "chat-new";
const ThemedLoadingSpinner = withUnistyles(LoadingSpinner, (theme) => ({
  color: theme.colors.foregroundMuted,
}));

export function ChatScreen({ serverId, agentId }: { serverId: string; agentId?: string }) {
  const router = useRouter();
  const queryClient = useAppQueryClient();
  const isFocused = useIsFocused();
  const client = useHostRuntimeClient(serverId);
  const runtime = useChatRuntime(serverId);
  const retryRuntime = runtime.retry;
  const routeTarget = useMemo(
    () => (agentId ? ({ kind: "agent", agentId } as const) : ({ kind: "draft" } as const)),
    [agentId],
  );
  useRememberChatRoute(serverId, routeTarget);
  const readyRuntime = runtime.resolution.status === "ready" ? runtime.resolution : null;
  const expectedWorkspaceId = readyRuntime?.workspace.workspaceId ?? null;
  const agentQuery = useFetchQuery({
    queryKey: ["chatAgent", serverId, expectedWorkspaceId, agentId ?? null],
    enabled: Boolean(client && expectedWorkspaceId && agentId),
    retry: false,
    staleTimeMs: 0,
    dataShape: "value",
    queryFn: async () => {
      if (!client || !expectedWorkspaceId || !agentId) return null;
      const result = await client.fetchAgent({ agentId });
      if (!result?.agent || result.agent.workspaceId !== expectedWorkspaceId) return null;
      return result.agent;
    },
  });

  useEffect(() => {
    if (!agentQuery.data) return;
    storeChatAgentDetail(serverId, agentQuery.data);
  }, [agentQuery.data, serverId]);

  const initialSetup = useMemo<WorkspaceDraftTabSetup | undefined>(() => {
    if (!readyRuntime) return undefined;
    return {
      provider: readyRuntime.agentDefaults.provider,
      cwd: readyRuntime.workspace.cwd,
      modeId: readyRuntime.agentDefaults.modeId,
      model: readyRuntime.agentDefaults.model,
      thinkingOptionId: readyRuntime.agentDefaults.thinkingOptionId,
      featureValues: readyRuntime.agentDefaults.featureValues ?? {},
    };
  }, [readyRuntime]);
  const handleCreated = useCallback(
    (snapshot: AgentSnapshotPayload) => {
      storeChatAgentDetail(serverId, snapshot);
      rememberChatRoute(serverId, { kind: "agent", agentId: snapshot.id });
      if (expectedWorkspaceId) {
        void queryClient.invalidateQueries({
          queryKey: agentHistoryQueryKey(serverId, { workspaceIds: [expectedWorkspaceId] }),
        });
      }
      router.replace(buildHostChatAgentRoute(serverId, snapshot.id));
    },
    [expectedWorkspaceId, queryClient, router, serverId],
  );
  const ignoreWorkspaceFileOpen = useCallback(() => undefined, []);
  const handleRuntimeRetry = useCallback(() => {
    void retryRuntime();
  }, [retryRuntime]);
  const refetchAgent = agentQuery.refetch;
  const handleAgentRetry = useCallback(() => {
    void refetchAgent();
  }, [refetchAgent]);
  const portalHostName = useMemo(() => `chat-floating-panels:${serverId}`, [serverId]);

  let content;
  if (runtime.resolution.status === "pending") {
    content = (
      <ChatStatusView testID="chat-runtime-pending" message="Preparing Chat…">
        <ThemedLoadingSpinner size="large" />
      </ChatStatusView>
    );
  } else if (runtime.resolution.status === "unsupported") {
    content = (
      <ChatStatusView testID="chat-runtime-unsupported" message="Update this Host to use Chat." />
    );
  } else if (runtime.resolution.status === "error") {
    content = (
      <ChatStatusView testID="chat-runtime-error" message="Unable to prepare Chat.">
        {runtime.resolution.retryable ? (
          <Button testID="chat-runtime-retry" variant="secondary" onPress={handleRuntimeRetry}>
            Retry
          </Button>
        ) : null}
      </ChatStatusView>
    );
  } else if (agentId) {
    if (agentQuery.isPending) {
      content = (
        <ChatStatusView testID="chat-agent-loading" message="Loading chat…">
          <ThemedLoadingSpinner size="large" />
        </ChatStatusView>
      );
    } else if (agentQuery.isError) {
      content = (
        <ChatStatusView testID="chat-agent-error" message="Unable to load this chat.">
          <Button testID="chat-agent-retry" variant="secondary" onPress={handleAgentRetry}>
            Retry
          </Button>
        </ChatStatusView>
      );
    } else if (!agentQuery.data) {
      content = <ChatStatusView testID="chat-agent-not-found" message="Chat not found." />;
    } else {
      content = (
        <ChatAgentSurface
          serverId={serverId}
          workspaceId={runtime.resolution.workspace.workspaceId}
          agentId={agentId}
          isFocused={isFocused}
        />
      );
    }
  } else if (initialSetup) {
    content = (
      <WorkspaceDraftAgentTab
        serverId={serverId}
        workspaceId={runtime.resolution.workspace.workspaceId}
        tabId={CHAT_DRAFT_TAB_ID}
        draftId={CHAT_DRAFT_ID}
        initialSetup={initialSetup}
        workspaceDirectoryOverride={runtime.resolution.workspace.cwd}
        isPaneFocused={isFocused}
        onCreated={handleCreated}
        onOpenWorkspaceFile={ignoreWorkspaceFileOpen}
      />
    );
  }

  return (
    <View style={styles.container} testID="chat-mode-screen">
      <MenuHeader title="Chat" />
      <View style={styles.content}>
        <FloatingPanelPortalHostNameProvider hostName={portalHostName}>
          {content}
        </FloatingPanelPortalHostNameProvider>
        <FloatingPanelPortalHost name={portalHostName} />
      </View>
    </View>
  );
}

function ChatAgentSurface({
  serverId,
  workspaceId,
  agentId,
  isFocused,
}: {
  serverId: string;
  workspaceId: string;
  agentId: string;
  isFocused: boolean;
}) {
  const viewedTimelineSync = useSessionStore(
    (state) => state.sessions[serverId]?.viewedTimelineSync ?? null,
  );
  const visibilityOwner = `chat:${serverId}`;
  const visibleAgentIds = useMemo(() => (isFocused ? [agentId] : []), [agentId, isFocused]);
  useEffect(() => {
    if (!isFocused) return;
    void getHostRuntimeStore()
      .prepareAgentTimeline(serverId, agentId)
      .catch(() => undefined);
  }, [agentId, isFocused, serverId]);
  useLayoutEffect(() => {
    viewedTimelineSync?.replaceVisibleAgentIds(visibilityOwner, visibleAgentIds);
  }, [viewedTimelineSync, visibilityOwner, visibleAgentIds]);
  useEffect(() => {
    return () => viewedTimelineSync?.replaceVisibleAgentIds(visibilityOwner, []);
  }, [viewedTimelineSync, visibilityOwner]);

  const handleClose = useCallback(() => navigateToChatDraft(serverId), [serverId]);
  const handleRetarget = useCallback<PaneContextValue["retargetCurrentTab"]>(
    (target) => {
      if (target.kind === "draft") navigateToChatDraft(serverId);
    },
    [serverId],
  );
  const pane = useMemo<PaneContextValue>(
    () => ({
      serverId,
      workspaceId,
      host: "main",
      tabId: `chat:${agentId}`,
      target: { kind: "agent", agentId },
      openTab: ignorePaneAction,
      openPreferredTarget: ignorePaneAction,
      closeCurrentTab: handleClose,
      retargetCurrentTab: handleRetarget,
      setCurrentTabState: ignorePaneAction,
      openFileInWorkspace: ignorePaneAction,
      openImportSheet: ignorePaneAction,
    }),
    [agentId, handleClose, handleRetarget, serverId, workspaceId],
  );
  const focus = useMemo(
    () => createPaneFocusContextValue({ isWorkspaceFocused: isFocused, isPaneFocused: isFocused }),
    [isFocused],
  );

  return (
    <PaneProvider value={pane}>
      <PaneFocusProvider value={focus}>
        <AgentPanelContent
          serverId={serverId}
          workspaceId={workspaceId}
          agentId={agentId}
          isPaneFocused={isFocused}
          directoryScope="chat"
        />
      </PaneFocusProvider>
    </PaneProvider>
  );
}

function ignorePaneAction(): void {}

function storeChatAgentDetail(serverId: string, snapshot: AgentSnapshotPayload): Agent {
  const normalized = normalizeAgentSnapshot(snapshot, serverId);
  const agent = applyLegacyDaemonWorkspaceOwnership({
    serverId,
    agent: { ...normalized, projectPlacement: null },
  });
  useSessionStore.getState().setAgentDetails(serverId, (current) => {
    const next = new Map(current);
    next.set(agent.id, agent);
    return next;
  });
  return agent;
}

function ChatStatusView({
  testID,
  message,
  children,
}: {
  testID: string;
  message: string;
  children?: ReactNode;
}) {
  return (
    <View style={styles.status} testID={testID}>
      {children}
      <Text style={styles.statusText}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
  content: {
    flex: 1,
  },
  status: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[4],
    padding: theme.spacing[6],
  },
  statusText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    textAlign: "center",
  },
}));
