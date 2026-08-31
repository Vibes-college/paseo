import { describe, expect, it, vi } from "vitest";
import relayWorker, { RelayDurableObject } from "./cloudflare-adapter.js";

type DurableObjectStateArg = ConstructorParameters<typeof RelayDurableObject>[0];
type RelayEnvArg = Parameters<typeof relayWorker.fetch>[1];

type MockSocket = WebSocket & {
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  serializeAttachment: ReturnType<typeof vi.fn>;
  deserializeAttachment: ReturnType<typeof vi.fn>;
};

function createMockSocket(attachment: unknown = null): MockSocket {
  let storedAttachment = attachment;
  return {
    send: vi.fn(),
    close: vi.fn(),
    serializeAttachment: vi.fn((value: unknown) => {
      storedAttachment = value;
    }),
    deserializeAttachment: vi.fn(() => storedAttachment),
  } as unknown as MockSocket;
}

function createMockState() {
  const socketsByTag = new Map<string, WebSocket[]>();
  const storedValues = new Map<string, unknown>();
  let alarm: number | null = null;
  const storage = {
    get: vi.fn(async <T>(key: string): Promise<T | undefined> => storedValues.get(key) as T),
    put: vi.fn(async <T>(key: string, value: T): Promise<void> => {
      storedValues.set(key, value);
    }),
    delete: vi.fn(async (key: string): Promise<boolean> => storedValues.delete(key)),
    list: vi.fn(async <T>(options?: { prefix?: string }): Promise<Map<string, T>> => {
      const prefix = options?.prefix ?? "";
      return new Map(
        Array.from(storedValues.entries()).filter(([key]) => key.startsWith(prefix)),
      ) as Map<string, T>;
    }),
    getAlarm: vi.fn(async (): Promise<number | null> => alarm),
    setAlarm: vi.fn(async (value: number | Date): Promise<void> => {
      alarm = value instanceof Date ? value.getTime() : value;
    }),
  };
  const state = {
    acceptWebSocket: vi.fn(),
    getWebSockets: vi.fn((tag?: string): WebSocket[] => {
      if (!tag) {
        const out: WebSocket[] = [];
        for (const sockets of socketsByTag.values()) out.push(...sockets);
        return out;
      }
      return socketsByTag.get(tag) ?? [];
    }),
    storage,
  };

  return {
    state,
    storage,
    storedValues,
    setTagSockets: (tag: string, sockets: WebSocket[]) => {
      socketsByTag.set(tag, sockets);
    },
  };
}

async function withMockWebSocketPair(
  run: (sockets: { clientWs: MockSocket; serverWs: MockSocket }) => Promise<void> | void,
): Promise<void> {
  const serverWs = createMockSocket();
  const clientWs = createMockSocket();
  const WebSocketPairMock = class {
    [index: number]: WebSocket;
    constructor() {
      this[0] = clientWs as unknown as WebSocket;
      this[1] = serverWs as unknown as WebSocket;
    }
  };

  const previousPair = (globalThis as unknown as { WebSocketPair?: unknown }).WebSocketPair;
  (globalThis as unknown as { WebSocketPair: unknown }).WebSocketPair = WebSocketPairMock;
  try {
    await run({ clientWs, serverWs });
  } finally {
    if (previousPair === undefined) {
      delete (globalThis as unknown as { WebSocketPair?: unknown }).WebSocketPair;
    } else {
      (globalThis as unknown as { WebSocketPair: unknown }).WebSocketPair = previousPair;
    }
  }
}

const swallow = () => undefined;

function throwStaleDestination(): never {
  throw new Error("stale destination");
}

describe("RelayDurableObject versioning", () => {
  it("accepts legacy v1 client sockets without connectionId", async () => {
    const { state } = createMockState();
    await withMockWebSocketPair(async () => {
      const relay = new RelayDurableObject(state as unknown as DurableObjectStateArg);
      const req = new Request("http://127.0.0.1/ws?role=client&serverId=srv_test&v=1", {
        headers: {
          Upgrade: "websocket",
        },
      });
      await relay.fetch(req).catch(swallow);
      expect(state.acceptWebSocket).toHaveBeenCalled();
    });
  });

  it("assigns a connectionId when v2 client connects without one", async () => {
    const { state } = createMockState();
    await withMockWebSocketPair(async ({ serverWs }) => {
      const relay = new RelayDurableObject(state as unknown as DurableObjectStateArg);
      const req = new Request("http://127.0.0.1/ws?role=client&serverId=srv_test&v=2", {
        headers: { Upgrade: "websocket" },
      });
      await relay.fetch(req).catch(swallow);
      expect(state.acceptWebSocket).toHaveBeenCalled();
      const attachment = serverWs.deserializeAttachment();
      expect(attachment).toMatchObject({
        role: "client",
        connectionId: expect.stringMatching(/^conn_/),
      });
    });
  });
});

describe("RelayDurableObject hibernation-safe routing", () => {
  it("stores a bounded client-before-daemon frame outside activation memory", async () => {
    const clientId = "clt_waiting_for_daemon";
    const client = createMockSocket({
      version: "2",
      role: "client",
      connectionId: clientId,
      serverId: "srv_test",
      createdAt: Date.now(),
    });
    const { state, storedValues, setTagSockets } = createMockState();
    setTagSockets("client", [client]);
    setTagSockets(`client:${clientId}`, [client]);
    setTagSockets(`server:${clientId}`, []);

    const relay = new RelayDurableObject(state as unknown as DurableObjectStateArg);
    const ciphertext = "opaque-ciphertext-before-daemon";
    await relay.webSocketMessage(client as unknown as WebSocket, ciphertext);

    expect(storedValues.get(`pending:2:${clientId}`)).toMatchObject({
      totalBytes: new TextEncoder().encode(ciphertext).byteLength,
      frames: [{ data: ciphertext }],
    });
  });

  it("persists a bounded public handshake until the daemon attaches", async () => {
    const clientId = "clt_handshake_retry";
    const client = createMockSocket({
      version: "2",
      role: "client",
      connectionId: clientId,
      serverId: "srv_test",
      createdAt: Date.now(),
    });
    const { state, storedValues, setTagSockets } = createMockState();
    setTagSockets(`server:${clientId}`, []);
    const relay = new RelayDurableObject(state as unknown as DurableObjectStateArg);
    const key = "hSDWTB/iMmcxR1EX8Yo7z94p7f/FWn6hBZULwpTCEUw=";
    const hello = JSON.stringify({ type: "e2ee_hello", key });

    await relay.webSocketMessage(client as unknown as WebSocket, hello);

    expect(storedValues.get(`pending:2:${clientId}`)).toMatchObject({
      totalBytes: new TextEncoder().encode(hello).byteLength,
      frames: [{ data: hello }],
    });
  });

  it("flushes a pending handshake after a new activation attaches data", async () => {
    const clientId = "clt_rehydrated";
    const hello = JSON.stringify({
      type: "e2ee_hello",
      key: "hSDWTB/iMmcxR1EX8Yo7z94p7f/FWn6hBZULwpTCEUw=",
    });
    const bytes = new TextEncoder().encode(hello).byteLength;
    const { state, storedValues } = createMockState();
    storedValues.set(`pending:2:${clientId}`, {
      createdAt: Date.now(),
      totalBytes: bytes,
      frames: [{ data: hello, bytes }],
    });

    await withMockWebSocketPair(async ({ serverWs }) => {
      const rehydratedRelay = new RelayDurableObject(state as unknown as DurableObjectStateArg);
      const request = new Request(
        `http://127.0.0.1/ws?role=server&serverId=srv_test&connectionId=${clientId}&v=2`,
        { headers: { Upgrade: "websocket" } },
      );
      await rehydratedRelay.fetch(request).catch(swallow);

      expect(serverWs.send).toHaveBeenCalledWith(hello);
      expect(storedValues.has(`pending:2:${clientId}`)).toBe(false);
    });
  });

  it("keeps pending traffic when the first delivery attempt fails", async () => {
    const clientId = "clt_retry_pending";
    const { state, storedValues } = createMockState();
    storedValues.set(`pending:2:${clientId}`, {
      createdAt: Date.now(),
      totalBytes: 8,
      frames: [
        { data: "one", bytes: 3 },
        { data: "two!!", bytes: 5 },
      ],
    });

    await withMockWebSocketPair(async ({ serverWs }) => {
      serverWs.send.mockImplementationOnce(throwStaleDestination);
      const relay = new RelayDurableObject(state as unknown as DurableObjectStateArg);
      const request = new Request(
        `http://127.0.0.1/ws?role=server&serverId=srv_test&connectionId=${clientId}&v=2`,
        { headers: { Upgrade: "websocket" } },
      );
      await relay.fetch(request).catch(swallow);

      expect(storedValues.has(`pending:2:${clientId}`)).toBe(true);
      expect(serverWs.close).toHaveBeenCalledWith(1012, "Pending frame delivery failed");
    });
  });

  it("expires pending traffic and closes the waiting client with a retryable code", async () => {
    const clientId = "clt_pending_expired";
    const client = createMockSocket({
      version: "2",
      role: "client",
      connectionId: clientId,
      serverId: "srv_test",
      createdAt: Date.now(),
    });
    const { state, storedValues, setTagSockets } = createMockState();
    storedValues.set(`pending:2:${clientId}`, {
      createdAt: Date.now() - 1_000,
      totalBytes: 4,
      frames: [{ data: "test", bytes: 4 }],
    });
    setTagSockets(`client:${clientId}`, [client]);
    const relay = new RelayDurableObject(state as unknown as DurableObjectStateArg, {
      PASEO_RELAY_PENDING_ATTACH_TIMEOUT_MS: "10",
    });

    await relay.alarm();

    expect(storedValues.has(`pending:2:${clientId}`)).toBe(false);
    expect(client.close).toHaveBeenCalledWith(1013, "Pending relay attach timed out");
  });

  it("does not replace existing client sockets for the same connectionId", async () => {
    const existingClient = createMockSocket({
      version: "2",
      role: "client",
      connectionId: "clt_same_session",
      serverId: "srv_test",
      createdAt: Date.now(),
    });
    const { state, setTagSockets } = createMockState();
    setTagSockets("client:clt_same_session", [existingClient]);
    setTagSockets("client", [existingClient]);

    await withMockWebSocketPair(async () => {
      const relay = new RelayDurableObject(state as unknown as DurableObjectStateArg);
      const req = new Request(
        "http://127.0.0.1/ws?role=client&serverId=srv_test&connectionId=clt_same_session&v=2",
        {
          headers: {
            Upgrade: "websocket",
          },
        },
      );

      await relay.fetch(req).catch(swallow);
      expect(existingClient.close).not.toHaveBeenCalled();
    });
  });

  it("keeps server data socket alive while at least one client socket remains", () => {
    const clientId = "clt_multi";
    const disconnectedClient = createMockSocket({
      version: "2",
      role: "client",
      connectionId: clientId,
      serverId: "srv_test",
      createdAt: Date.now(),
    });
    const stillConnectedClient = createMockSocket({
      version: "2",
      role: "client",
      connectionId: clientId,
      serverId: "srv_test",
      createdAt: Date.now(),
    });
    const serverData = createMockSocket();
    const control = createMockSocket();
    const { state, setTagSockets } = createMockState();

    setTagSockets("server-control", [control]);
    setTagSockets(`server:${clientId}`, [serverData]);
    setTagSockets("client", [stillConnectedClient]);
    setTagSockets(`client:${clientId}`, [stillConnectedClient]);

    const relay = new RelayDurableObject(state as unknown as DurableObjectStateArg);
    relay.webSocketClose(
      disconnectedClient as unknown as WebSocket,
      1001,
      "Client disconnected",
      true,
    );

    expect(serverData.close).not.toHaveBeenCalled();
    expect(control.send).not.toHaveBeenCalledWith(
      JSON.stringify({ type: "disconnected", connectionId: clientId }),
    );
  });

  it("does not close clients when a superseded server-data socket closes late", async () => {
    const connectionId = "clt_server_replaced";
    const oldServer = createMockSocket({
      version: "2",
      role: "server",
      socketId: "server-old",
      closedByPolicy: true,
      connectionId,
      serverId: "srv_test",
      createdAt: Date.now(),
    });
    const replacementServer = createMockSocket({
      version: "2",
      role: "server",
      socketId: "server-new",
      connectionId,
      serverId: "srv_test",
      createdAt: Date.now(),
    });
    const client = createMockSocket();
    const { state, setTagSockets } = createMockState();
    setTagSockets(`server:${connectionId}`, [replacementServer]);
    setTagSockets(`client:${connectionId}`, [client]);
    const relay = new RelayDurableObject(state as unknown as DurableObjectStateArg);

    await relay.webSocketClose(oldServer as unknown as WebSocket, 1008, "replaced", true);

    expect(client.close).not.toHaveBeenCalled();
  });

  it("recognizes a hibernated wrapper for the closing socket by attachment identity", async () => {
    const clientId = "clt_last_hibernated";
    const socketId = "socket-last";
    const closingClient = createMockSocket({
      version: "2",
      role: "client",
      socketId,
      connectionId: clientId,
      serverId: "srv_test",
      createdAt: Date.now(),
    });
    const hibernatedWrapper = createMockSocket({
      version: "2",
      role: "client",
      socketId,
      connectionId: clientId,
      serverId: "srv_test",
      createdAt: Date.now(),
    });
    const serverData = createMockSocket();
    const control = createMockSocket();
    const { state, setTagSockets } = createMockState();
    setTagSockets("server-control", [control]);
    setTagSockets(`server:${clientId}`, [serverData]);
    setTagSockets(`client:${clientId}`, [hibernatedWrapper]);

    const relay = new RelayDurableObject(state as unknown as DurableObjectStateArg);
    await relay.webSocketClose(
      closingClient as unknown as WebSocket,
      1001,
      "Client disconnected",
      true,
    );

    expect(serverData.close).toHaveBeenCalledWith(1001, "Client disconnected");
    expect(control.send).toHaveBeenCalledWith(
      JSON.stringify({ type: "disconnected", connectionId: clientId }),
    );
  });
});

describe("RelayDurableObject abuse and cost gates", () => {
  it("rejects a second client when the configured per-connection ceiling is full", async () => {
    const connectionId = "clt_capacity";
    const existingClient = createMockSocket({
      version: "2",
      role: "client",
      connectionId,
      serverId: "srv_test",
      createdAt: Date.now(),
    });
    const { state, setTagSockets } = createMockState();
    setTagSockets("client", [existingClient]);
    setTagSockets(`client:${connectionId}`, [existingClient]);

    const relay = new RelayDurableObject(state as unknown as DurableObjectStateArg, {
      PASEO_RELAY_MAX_CLIENTS_PER_CONNECTION: "1",
    });
    const response = await relay.fetch(
      new Request(
        `http://127.0.0.1/ws?role=client&serverId=srv_test&connectionId=${connectionId}&v=2`,
        { headers: { Upgrade: "websocket" } },
      ),
    );

    expect(response.status).toBe(429);
    await expect(response.text()).resolves.toBe("Client capacity reached");
  });

  it("counts server-only connection IDs toward the per-session ceiling", async () => {
    const existingServer = createMockSocket({
      version: "2",
      role: "server",
      connectionId: "conn_existing_server",
      serverId: "srv_test",
      createdAt: Date.now(),
    });
    const { state, setTagSockets } = createMockState();
    setTagSockets("server", [existingServer]);
    setTagSockets("server:conn_existing_server", [existingServer]);
    const relay = new RelayDurableObject(state as unknown as DurableObjectStateArg, {
      PASEO_RELAY_MAX_CONNECTIONS_PER_SESSION: "1",
    });

    const response = await relay.fetch(
      new Request(
        "http://127.0.0.1/ws?role=server&serverId=srv_test&connectionId=conn_new_server&v=2",
        { headers: { Upgrade: "websocket" } },
      ),
    );

    expect(response.status).toBe(503);
    await expect(response.text()).resolves.toBe("Connection capacity reached");
  });

  it("rejects upgrades after the per-session socket ceiling", async () => {
    const existingClient = createMockSocket({
      version: "2",
      role: "client",
      connectionId: "clt_existing",
      serverId: "srv_test",
      createdAt: Date.now(),
    });
    const { state, setTagSockets } = createMockState();
    setTagSockets("client", [existingClient]);
    const relay = new RelayDurableObject(state as unknown as DurableObjectStateArg, {
      PASEO_RELAY_MAX_SOCKETS_PER_SESSION: "1",
    });

    const response = await relay.fetch(
      new Request("http://127.0.0.1/ws?role=server&serverId=srv_test&v=2", {
        headers: { Upgrade: "websocket" },
      }),
    );

    expect(response.status).toBe(503);
    await expect(response.text()).resolves.toBe("Relay session capacity reached");
  });

  it("closes a client when pending bytes exceed the per-connection ceiling", async () => {
    const connectionId = "clt_pending_capacity";
    const client = createMockSocket({
      version: "2",
      role: "client",
      connectionId,
      serverId: "srv_test",
      createdAt: Date.now(),
    });
    const { state, setTagSockets } = createMockState();
    setTagSockets(`server:${connectionId}`, []);
    const relay = new RelayDurableObject(state as unknown as DurableObjectStateArg, {
      PASEO_RELAY_MAX_PENDING_BYTES: "10",
    });

    await relay.webSocketMessage(client as unknown as WebSocket, "123456");
    await relay.webSocketMessage(client as unknown as WebSocket, "abcdef");

    expect(client.close).toHaveBeenCalledWith(1013, "Pending relay capacity reached");
  });

  it("enforces a shared pending-byte ceiling across connection IDs", async () => {
    const first = createMockSocket({
      version: "2",
      role: "client",
      connectionId: "clt_pending_a",
      serverId: "srv_test",
      createdAt: Date.now(),
    });
    const second = createMockSocket({
      version: "2",
      role: "client",
      connectionId: "clt_pending_b",
      serverId: "srv_test",
      createdAt: Date.now(),
    });
    const { state } = createMockState();
    const relay = new RelayDurableObject(state as unknown as DurableObjectStateArg, {
      PASEO_RELAY_MAX_PENDING_BYTES: "100",
      PASEO_RELAY_MAX_PENDING_BYTES_PER_SESSION: "10",
    });

    await relay.webSocketMessage(first as unknown as WebSocket, "123456");
    await relay.webSocketMessage(second as unknown as WebSocket, "abcdef");

    expect(first.close).not.toHaveBeenCalled();
    expect(second.close).toHaveBeenCalledWith(1013, "Pending relay capacity reached");
  });

  it("closes invalid public-key handshakes without forwarding key material", async () => {
    const connectionId = "clt_invalid_handshake";
    const client = createMockSocket({
      version: "2",
      role: "client",
      connectionId,
      serverId: "srv_test",
      createdAt: Date.now(),
    });
    const server = createMockSocket();
    const { state, setTagSockets } = createMockState();
    setTagSockets(`server:${connectionId}`, [server]);
    const relay = new RelayDurableObject(state as unknown as DurableObjectStateArg);
    const invalidKey = Buffer.alloc(32).toString("base64");

    await relay.webSocketMessage(
      client as unknown as WebSocket,
      JSON.stringify({ type: "e2ee_hello", key: invalidKey }),
    );
    await relay.webSocketMessage(client as unknown as WebSocket, "opaque-after-rejection");

    expect(client.close).toHaveBeenCalledWith(1008, "invalid_handshake_key");
    expect(server.send).not.toHaveBeenCalled();
  });

  it("persists a per-socket rate window in the WebSocket attachment", async () => {
    const connectionId = "clt_rate";
    const client = createMockSocket({
      version: "2",
      role: "client",
      connectionId,
      serverId: "srv_test",
      createdAt: Date.now(),
    });
    const server = createMockSocket();
    const { state, setTagSockets } = createMockState();
    setTagSockets(`server:${connectionId}`, [server]);
    const relay = new RelayDurableObject(state as unknown as DurableObjectStateArg, {
      PASEO_RELAY_MAX_FRAMES_PER_WINDOW: "1",
    });

    await relay.webSocketMessage(client as unknown as WebSocket, "opaque-one");
    await relay.webSocketMessage(client as unknown as WebSocket, "opaque-two");

    expect(server.send).toHaveBeenCalledTimes(1);
    expect(client.close).toHaveBeenCalledWith(1013, "Relay rate limit reached");
    expect(client.serializeAttachment).toHaveBeenCalledWith(
      expect.objectContaining({
        rateBudget: expect.objectContaining({ frames: 1 }),
      }),
    );
  });
});

describe("relay worker endpoint routing", () => {
  it("routes missing v to legacy v1 isolated DO ids", async () => {
    const fetch = vi.fn(
      async (request: Request) => new Response(`ok:${new URL(request.url).searchParams.get("v")}`),
    );
    const get = vi.fn(() => ({ fetch }));
    const idFromName = vi.fn(() => ({ toString: () => "id" }));

    const response = await relayWorker.fetch(
      new Request("http://127.0.0.1/ws?serverId=srv_test&role=server"),
      {
        RELAY: { idFromName, get },
        PASEO_RELAY_POC_MODE: "local",
        PASEO_RELAY_ALLOWED_HOSTS: "127.0.0.1",
      } as unknown as RelayEnvArg,
    );

    expect(idFromName).toHaveBeenCalledWith("relay-v1:srv_test");
    expect(fetch).toHaveBeenCalledTimes(1);
    await expect(response.text()).resolves.toBe("ok:1");
  });

  it("routes v=2 to v2 isolated DO ids", async () => {
    const fetch = vi.fn(
      async (request: Request) => new Response(`ok:${new URL(request.url).searchParams.get("v")}`),
    );
    const get = vi.fn(() => ({ fetch }));
    const idFromName = vi.fn(() => ({ toString: () => "id" }));

    const response = await relayWorker.fetch(
      new Request("http://127.0.0.1/ws?serverId=srv_test&role=server&v=2"),
      {
        RELAY: { idFromName, get },
        PASEO_RELAY_POC_MODE: "local",
        PASEO_RELAY_ALLOWED_HOSTS: "127.0.0.1",
      } as unknown as RelayEnvArg,
    );

    expect(idFromName).toHaveBeenCalledWith("relay-v2:srv_test");
    expect(fetch).toHaveBeenCalledTimes(1);
    await expect(response.text()).resolves.toBe("ok:2");
  });

  it("rejects invalid v values", async () => {
    const fetch = vi.fn();
    const get = vi.fn(() => ({ fetch }));
    const idFromName = vi.fn(() => ({ toString: () => "id" }));

    const response = await relayWorker.fetch(
      new Request("http://127.0.0.1/ws?serverId=srv_test&role=server&v=nope"),
      {
        RELAY: { idFromName, get },
        PASEO_RELAY_POC_MODE: "local",
        PASEO_RELAY_ALLOWED_HOSTS: "127.0.0.1",
      } as unknown as RelayEnvArg,
    );

    expect(response.status).toBe(400);
    await expect(response.text()).resolves.toBe("Invalid v parameter (expected 1 or 2)");
    expect(idFromName).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps the checked-in disabled mode unready", async () => {
    const response = await relayWorker.fetch(new Request("http://127.0.0.1/ready"), {
      RELAY: { idFromName: vi.fn(), get: vi.fn() },
    } as unknown as RelayEnvArg);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ status: "unready" });
  });

  it("does not route disabled session metrics to caller-selected Durable Objects", async () => {
    const idFromName = vi.fn();
    const response = await relayWorker.fetch(
      new Request("http://127.0.0.1/metrics?serverId=attacker-selected"),
      { RELAY: { idFromName, get: vi.fn() } } as unknown as RelayEnvArg,
    );

    expect(response.status).toBe(200);
    expect(idFromName).not.toHaveBeenCalled();
  });

  it("keeps health live when readiness configuration is invalid", async () => {
    const response = await relayWorker.fetch(new Request("http://127.0.0.1/health"), {
      RELAY: { idFromName: vi.fn(), get: vi.fn() },
      PASEO_RELAY_POC_MODE: "invalid",
    } as unknown as RelayEnvArg);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });

  it("requires an edge rate limiter in Preview mode", async () => {
    const response = await relayWorker.fetch(new Request("https://relay-preview.test/ready"), {
      RELAY: { idFromName: vi.fn(), get: vi.fn() },
      PASEO_RELAY_POC_MODE: "preview",
      PASEO_RELAY_ALLOWED_HOSTS: "relay-preview.test",
    } as unknown as RelayEnvArg);

    expect(response.status).toBe(503);
  });

  it("reports local readiness and low-cardinality metrics", async () => {
    const sessionFetch = vi.fn(async () => new Response("ready"));
    const env = {
      RELAY: {
        idFromName: vi.fn(() => ({ toString: () => "id" })),
        get: vi.fn(() => ({ fetch: sessionFetch })),
      },
      PASEO_RELAY_POC_MODE: "local",
      PASEO_RELAY_ALLOWED_HOSTS: "127.0.0.1",
    } as unknown as RelayEnvArg;

    const ready = await relayWorker.fetch(new Request("http://127.0.0.1/ready"), env);
    expect(ready.status).toBe(200);
    const metrics = await relayWorker.fetch(new Request("http://127.0.0.1/metrics"), env);
    const body = await metrics.text();
    expect(body).toContain("paseo_relay_ready 1");
    expect(body).toContain("paseo_relay_edge_rate_limiter_configured 0");
    expect(body).toContain("# TYPE paseo_relay_worker_upgrades_accepted_total counter");
    expect(body).not.toContain("serverId");
    expect(body).not.toContain("connectionId");
  });

  it("rejects oversized route keys before allocating a Durable Object", async () => {
    const idFromName = vi.fn();
    const response = await relayWorker.fetch(
      new Request(`http://127.0.0.1/ws?serverId=${"a".repeat(257)}&role=server&v=2`),
      {
        RELAY: { idFromName, get: vi.fn() },
        PASEO_RELAY_POC_MODE: "local",
        PASEO_RELAY_ALLOWED_HOSTS: "127.0.0.1",
      } as unknown as RelayEnvArg,
    );

    expect(response.status).toBe(400);
    expect(idFromName).not.toHaveBeenCalled();
  });

  it("enforces the configured edge rate limiter before Durable Object routing", async () => {
    const idFromName = vi.fn();
    const response = await relayWorker.fetch(
      new Request("https://relay-preview.test/ws?serverId=srv_test&role=server&v=2", {
        headers: { "cf-connecting-ip": "192.0.2.1" },
      }),
      {
        RELAY: { idFromName, get: vi.fn() },
        RATE_LIMITER: { limit: vi.fn(async () => ({ success: false })) },
        PASEO_RELAY_POC_MODE: "preview",
        PASEO_RELAY_ALLOWED_HOSTS: "relay-preview.test",
      } as unknown as RelayEnvArg,
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(idFromName).not.toHaveBeenCalled();
  });
});
