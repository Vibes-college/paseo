import { z } from "zod";

/**
 * Browser-local navigation memory for Chat mode. It owns only the last draft or
 * conversation route per Host; workspace, Agent, history, draft contents, and
 * VIBES account lifecycle remain with their existing owners.
 */

export type ChatRouteTarget =
  | { kind: "draft" }
  | {
      kind: "agent";
      agentId: string;
    };

export interface ChatRouteSelection {
  serverId: string;
  target: ChatRouteTarget;
}

export interface ChatRouteSelectionStorage {
  read(): Promise<string | null>;
  write(value: string): Promise<void>;
  clear(): Promise<void>;
}

const ChatRouteTargetSchema: z.ZodType<ChatRouteTarget> = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("draft") }),
  z.strictObject({ kind: z.literal("agent"), agentId: z.string().trim().min(1) }),
]);
const StoredChatRouteSelectionsSchema = z.record(z.string().trim().min(1), ChatRouteTargetSchema);

function parseSelections(value: string | null): Record<string, ChatRouteTarget> | null {
  if (!value) return {};
  try {
    const result = StoredChatRouteSelectionsSchema.safeParse(JSON.parse(value));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export function createChatRouteSelectionStore(storage: ChatRouteSelectionStorage) {
  let selections: Record<string, ChatRouteTarget> = {};
  let hydrated = false;
  let hydrationPromise: Promise<void> | null = null;
  let revision = 0;
  const listeners = new Set<() => void>();

  function notify(): void {
    for (const listener of listeners) listener();
  }

  function remember(selection: ChatRouteSelection): void {
    const serverId = selection.serverId.trim();
    const target = ChatRouteTargetSchema.safeParse(selection.target);
    if (!serverId || !target.success) return;
    const current = selections[serverId];
    if (
      current?.kind === target.data.kind &&
      (current.kind !== "agent" ||
        (target.data.kind === "agent" && current.agentId === target.data.agentId))
    ) {
      return;
    }
    selections = { ...selections, [serverId]: target.data };
    revision += 1;
    notify();
    void storage.write(JSON.stringify(selections)).catch(() => undefined);
  }

  function hydrate(): Promise<void> {
    if (hydrationPromise) return hydrationPromise;
    const hydrationRevision = revision;
    hydrationPromise = storage
      .read()
      .then((stored) => {
        if (revision !== hydrationRevision) return undefined;
        const parsed = parseSelections(stored);
        selections = parsed ?? {};
        if (stored !== null && parsed === null) {
          void storage.clear().catch(() => undefined);
        }
        return undefined;
      })
      .catch(() => {
        if (revision === hydrationRevision) selections = {};
        return undefined;
      })
      .finally(() => {
        hydrated = true;
        notify();
      });
    return hydrationPromise;
  }

  return {
    get(serverId: string): ChatRouteTarget | null {
      return selections[serverId.trim()] ?? null;
    },
    hydrate,
    isHydrated: () => hydrated,
    remember,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
