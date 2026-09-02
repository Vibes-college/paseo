export interface AgentHistoryQueryScope {
  workspaceIds?: readonly string[];
}

function workspaceScopeKey(scope: AgentHistoryQueryScope | undefined): string[] {
  return [
    ...new Set(scope?.workspaceIds?.filter((workspaceId) => workspaceId.length > 0) ?? []),
  ].sort();
}

export function agentHistoryQueryKey(serverId: string | null, scope?: AgentHistoryQueryScope) {
  const workspaceIds = workspaceScopeKey(scope);
  return workspaceIds.length > 0
    ? (["agentHistory", serverId, "workspaces", ...workspaceIds] as const)
    : (["agentHistory", serverId] as const);
}

const ALL_AGENT_HISTORY_QUERY_ROOT = ["allAgentHistory"] as const;

export function allAgentHistoryQueryRootKey() {
  return ALL_AGENT_HISTORY_QUERY_ROOT;
}

export function allAgentHistoryQueryKey(
  serverIds: readonly string[],
  scope?: AgentHistoryQueryScope,
) {
  const workspaceIds = workspaceScopeKey(scope);
  return [
    ...ALL_AGENT_HISTORY_QUERY_ROOT,
    ...[...serverIds].sort(),
    ...(workspaceIds.length > 0 ? ["workspaces", ...workspaceIds] : []),
  ] as const;
}
