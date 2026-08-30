interface RetainedExpandedToolState {
  inlineToolCallIds: Set<string>;
  toolCallGroupIds: Set<string>;
}

const expandedToolsByAgent = new Map<string, RetainedExpandedToolState>();

export function getRetainedExpandedToolState(key: string): RetainedExpandedToolState | null {
  const retained = expandedToolsByAgent.get(key);
  if (!retained) return null;
  return {
    inlineToolCallIds: new Set(retained.inlineToolCallIds),
    toolCallGroupIds: new Set(retained.toolCallGroupIds),
  };
}

export function setRetainedExpandedToolState(key: string, state: RetainedExpandedToolState): void {
  expandedToolsByAgent.set(key, {
    inlineToolCallIds: new Set(state.inlineToolCallIds),
    toolCallGroupIds: new Set(state.toolCallGroupIds),
  });
}

export function clearRetainedSurfaceState(): void {
  expandedToolsByAgent.clear();
}
