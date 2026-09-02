import { describe, expect, test } from "vitest";

import {
  createChatRouteSelectionStore,
  type ChatRouteSelectionStorage,
} from "./chat-route-selection";

class MemoryChatRouteStorage implements ChatRouteSelectionStorage {
  value: string | null;
  writes: string[] = [];
  clearCount = 0;

  constructor(value: string | null = null) {
    this.value = value;
  }

  async read(): Promise<string | null> {
    return this.value;
  }

  async write(value: string): Promise<void> {
    this.value = value;
    this.writes.push(value);
  }

  async clear(): Promise<void> {
    this.value = null;
    this.clearCount += 1;
  }
}

describe("Chat route selection", () => {
  test("persists independent draft or conversation targets for each Host", async () => {
    const storage = new MemoryChatRouteStorage();
    const store = createChatRouteSelectionStore(storage);
    await store.hydrate();

    store.remember({ serverId: "server-a", target: { kind: "agent", agentId: "agent-a" } });
    store.remember({ serverId: "server-b", target: { kind: "draft" } });

    expect(store.get("server-a")).toEqual({ kind: "agent", agentId: "agent-a" });
    expect(store.get("server-b")).toEqual({ kind: "draft" });

    const restored = createChatRouteSelectionStore(new MemoryChatRouteStorage(storage.value));
    await restored.hydrate();
    expect(restored.get("server-a")).toEqual({ kind: "agent", agentId: "agent-a" });
    expect(restored.get("server-b")).toEqual({ kind: "draft" });
  });

  test("does not let late hydration overwrite a route selected during startup", async () => {
    let releaseRead!: (value: string | null) => void;
    const read = new Promise<string | null>((resolve) => {
      releaseRead = resolve;
    });
    const storage: ChatRouteSelectionStorage = {
      read: () => read,
      write: async () => {},
      clear: async () => {},
    };
    const store = createChatRouteSelectionStore(storage);
    const hydration = store.hydrate();
    store.remember({ serverId: "server-a", target: { kind: "draft" } });
    releaseRead(
      JSON.stringify({
        "server-a": { kind: "agent", agentId: "stale-agent" },
      }),
    );
    await hydration;

    expect(store.get("server-a")).toEqual({ kind: "draft" });
  });

  test("clears invalid persisted state instead of guessing a route", async () => {
    const storage = new MemoryChatRouteStorage('{"server-a":{"kind":"agent","agentId":""}}');
    const store = createChatRouteSelectionStore(storage);

    await store.hydrate();

    expect(store.get("server-a")).toBeNull();
    expect(storage.clearCount).toBe(1);
  });
});
