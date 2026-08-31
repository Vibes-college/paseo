import { strict as assert } from "node:assert";
import { Buffer } from "node:buffer";
import { WebSocket, type RawData } from "ws";
import { exportPublicKey, generateKeyPair } from "./crypto.js";
import { MAX_CLIENT_FRAME_PAYLOAD_BYTES, MAX_CONTROL_PAYLOAD_BYTES } from "./cloudflare-policy.js";

export interface RelayPocCaseResult {
  id: string;
  status: "passed" | "failed";
  durationMs: number;
  detail?: Record<string, string | number | boolean>;
  error?: string;
}

export interface RelayPocMatrixResult {
  schema: "vibes-relay-poc-matrix/1";
  target: string;
  baseUrl: string;
  fullFrameBoundary: boolean;
  startedAt: string;
  finishedAt: string;
  cases: RelayPocCaseResult[];
  passed: number;
  failed: number;
}

interface RelayPocMatrixInput {
  target: string;
  baseUrl: string;
  runId: string;
  fullFrameBoundary?: boolean;
}

interface ReceivedFrame {
  data: Buffer;
  isBinary: boolean;
}

interface FrameWaiter {
  resolve(frame: ReceivedFrame): void;
  reject(error: Error): void;
  timeout: ReturnType<typeof setTimeout>;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const openSockets = new Set<WebSocket>();
const frameQueues = new WeakMap<WebSocket, ReceivedFrame[]>();
const frameWaiters = new WeakMap<WebSocket, FrameWaiter[]>();

export async function runRelayPocMatrix(input: RelayPocMatrixInput): Promise<RelayPocMatrixResult> {
  const startedAt = new Date().toISOString();
  const cases: RelayPocCaseResult[] = [];
  const baseUrl = input.baseUrl.replace(/\/$/u, "");
  const wsBaseUrl = baseUrl.replace(/^http/u, "ws");
  const casePrefix = input.runId.replace(/[^a-zA-Z0-9_-]/gu, "_");

  await runCase(cases, "operations", async () => {
    const health = await fetch(`${baseUrl}/health`);
    const ready = await fetch(`${baseUrl}/ready`);
    const metrics = await fetch(`${baseUrl}/metrics`);
    const metricsBody = await metrics.text();
    assert.equal(health.status, 200);
    assert.equal(ready.status, 200);
    assert.equal(metrics.status, 200);
    assert.match(metricsBody, /paseo_relay_/u);
    assert.doesNotMatch(metricsBody, /serverId|connectionId/u);
    return { health: health.status, ready: ready.status, metrics: metrics.status };
  });

  await runCase(cases, "v1-text-binary", async () => {
    const serverId = `${casePrefix}-v1`;
    const sockets: WebSocket[] = [];
    try {
      const server = await openSocket(
        relayUrl(wsBaseUrl, { serverId, role: "server", version: "1" }),
      );
      const client = await openSocket(
        relayUrl(wsBaseUrl, { serverId, role: "client", version: "1" }),
      );
      sockets.push(server, client);

      const clientText = nextFrame(client);
      server.send("v1-text");
      const text = await clientText;
      assert.equal(text.isBinary, false);
      assert.equal(text.data.toString("utf8"), "v1-text");

      const serverBinary = nextFrame(server);
      client.send(Buffer.from([0, 1, 2, 255]));
      const binary = await serverBinary;
      assert.equal(binary.isBinary, true);
      assert.deepEqual(binary.data, Buffer.from([0, 1, 2, 255]));
      return { textPreserved: true, binaryPreserved: true };
    } finally {
      closeSockets(sockets);
    }
  });

  await runCase(cases, "v1-v2-isolation", async () => {
    const serverId = `${casePrefix}-isolation`;
    const connectionId = "conn_isolated";
    const sockets: WebSocket[] = [];
    try {
      const v1Server = await openSocket(
        relayUrl(wsBaseUrl, { serverId, role: "server", version: "1" }),
      );
      const v1Client = await openSocket(
        relayUrl(wsBaseUrl, { serverId, role: "client", version: "1" }),
      );
      const v2Control = await openSocket(
        relayUrl(wsBaseUrl, { serverId, role: "server", version: "2" }),
      );
      const v2Client = await openSocket(
        relayUrl(wsBaseUrl, { serverId, role: "client", version: "2", connectionId }),
      );
      const v2Data = await openSocket(
        relayUrl(wsBaseUrl, { serverId, role: "server", version: "2", connectionId }),
      );
      sockets.push(v1Server, v1Client, v2Control, v2Client, v2Data);

      const v1Received = nextFrame(v1Client);
      const v2Silence = expectNoFrame(v2Client, 250);
      v1Server.send("v1-only");
      assert.equal((await v1Received).data.toString("utf8"), "v1-only");
      await v2Silence;

      const v1Silence = expectNoFrame(v1Client, 250);
      const v2Received = nextFrame(v2Client);
      v2Data.send("v2-only");
      assert.equal((await v2Received).data.toString("utf8"), "v2-only");
      await v1Silence;
      return { isolatedBothDirections: true };
    } finally {
      closeSockets(sockets);
    }
  });

  await runCase(cases, "v2-client-before-daemon", async () => {
    const serverId = `${casePrefix}-client-first`;
    const connectionId = "conn_client_first";
    const sockets: WebSocket[] = [];
    try {
      const client = await openSocket(
        relayUrl(wsBaseUrl, { serverId, role: "client", version: "2", connectionId }),
      );
      sockets.push(client);
      const key = exportPublicKey(generateKeyPair().publicKey);
      const hello = JSON.stringify({
        type: "e2ee_hello",
        key,
        capabilities: { binaryCiphertext: true },
      });
      client.send(hello);

      const control = await openSocket(
        relayUrl(wsBaseUrl, { serverId, role: "server", version: "2" }),
      );
      sockets.push(control);
      const data = await openSocket(
        relayUrl(wsBaseUrl, { serverId, role: "server", version: "2", connectionId }),
      );
      sockets.push(data);

      const receivedHello = await nextFrame(data);
      assert.equal(receivedHello.data.toString("utf8"), hello);
      const clientReady = nextFrame(client);
      data.send(JSON.stringify({ type: "e2ee_ready", capabilities: { binaryCiphertext: true } }));
      assert.match((await clientReady).data.toString("utf8"), /e2ee_ready/u);
      return { recoveredWithoutReconnect: true };
    } finally {
      closeSockets(sockets);
    }
  });

  await runCase(cases, "v2-control-replacement", async () => {
    const serverId = `${casePrefix}-control-replacement`;
    const connectionId = "conn_control_replacement";
    const sockets: WebSocket[] = [];
    try {
      const firstControl = await openSocket(
        relayUrl(wsBaseUrl, { serverId, role: "server", version: "2" }),
      );
      const client = await openSocket(
        relayUrl(wsBaseUrl, { serverId, role: "client", version: "2", connectionId }),
      );
      sockets.push(firstControl, client);
      await nextJsonFrameOfType(firstControl, "connected");
      const replacementControl = await openSocket(
        relayUrl(wsBaseUrl, { serverId, role: "server", version: "2" }),
      );
      sockets.push(replacementControl);
      const sync = await nextJsonFrameOfType(replacementControl, "sync");
      assert.deepEqual(sync.connectionIds, [connectionId]);

      const staleControlSilence = expectNoFrame(firstControl, 250);
      if (firstControl.readyState === WebSocket.OPEN) {
        firstControl.send(JSON.stringify({ type: "ping" }));
      }
      await staleControlSilence;
      const replacementPong = nextJsonFrameOfType(replacementControl, "pong");
      replacementControl.send(JSON.stringify({ type: "ping" }));
      await replacementPong;
      return { synchronized: true, staleControlSuppressed: true };
    } finally {
      closeSockets(sockets);
    }
  });

  await runCase(cases, "v2-multiple-clients", async () => {
    const serverId = `${casePrefix}-multi`;
    const connectionId = "conn_multi";
    const sockets: WebSocket[] = [];
    try {
      const control = await openSocket(
        relayUrl(wsBaseUrl, { serverId, role: "server", version: "2" }),
      );
      const clientA = await openSocket(
        relayUrl(wsBaseUrl, { serverId, role: "client", version: "2", connectionId }),
      );
      const clientB = await openSocket(
        relayUrl(wsBaseUrl, { serverId, role: "client", version: "2", connectionId }),
      );
      const data = await openSocket(
        relayUrl(wsBaseUrl, { serverId, role: "server", version: "2", connectionId }),
      );
      sockets.push(control, clientA, clientB, data);

      const firstA = nextFrame(clientA);
      const firstB = nextFrame(clientB);
      data.send("fanout-one");
      assert.equal((await firstA).data.toString("utf8"), "fanout-one");
      assert.equal((await firstB).data.toString("utf8"), "fanout-one");

      clientA.terminate();
      await delay(50);
      const secondB = nextFrame(clientB);
      data.send("fanout-two");
      assert.equal((await secondB).data.toString("utf8"), "fanout-two");

      const dataClosed = waitForClose(data);
      const disconnected = nextJsonFrameOfType(control, "disconnected");
      clientB.terminate();
      const [dataClose, notice] = await Promise.all([dataClosed, disconnected]);
      assert.equal(dataClose.code, 1001);
      assert.equal(notice.connectionId, connectionId);
      return { clients: 2, lastClientOwnsDataLifetime: true, lastClientCloseCode: 1001 };
    } finally {
      closeSockets(sockets);
    }
  });

  await runCase(cases, "invalid-handshake-key", async () => {
    const serverId = `${casePrefix}-invalid-key`;
    const client = await openSocket(
      relayUrl(wsBaseUrl, {
        serverId,
        role: "client",
        version: "2",
        connectionId: "conn_invalid_key",
      }),
    );
    try {
      const closed = waitForClose(client);
      client.send(JSON.stringify({ type: "e2ee_hello", key: Buffer.alloc(32).toString("base64") }));
      const close = await closed;
      assert.equal(close.code, 1008);
      return { closeCode: close.code };
    } finally {
      closeSockets([client]);
    }
  });

  await runCase(cases, "route-key-limit", async () => {
    const exactServerId = "s".repeat(256);
    const exactConnectionId = "c".repeat(256);
    const sockets: WebSocket[] = [];
    try {
      const client = await openSocket(
        relayUrl(wsBaseUrl, {
          serverId: exactServerId,
          role: "client",
          version: "2",
          connectionId: exactConnectionId,
        }),
      );
      const data = await openSocket(
        relayUrl(wsBaseUrl, {
          serverId: exactServerId,
          role: "server",
          version: "2",
          connectionId: exactConnectionId,
        }),
      );
      sockets.push(client, data);
      const received = nextFrame(data);
      client.send("exact-route-key");
      assert.equal((await received).data.toString("utf8"), "exact-route-key");
    } finally {
      closeSockets(sockets);
    }

    const status = await websocketUpgradeStatus(
      relayUrl(wsBaseUrl, { serverId: "x".repeat(257), role: "server", version: "2" }),
    );
    assert.equal(status, 400);
    return { acceptedBytes: 256, rejectedBytes: 257, oversizedStatus: status };
  });

  await runCase(cases, "sleep-wake", async () => {
    const serverId = `${casePrefix}-sleep`;
    const connectionId = "conn_sleep";
    const sockets: WebSocket[] = [];
    try {
      const control = await openSocket(
        relayUrl(wsBaseUrl, { serverId, role: "server", version: "2" }),
      );
      const client = await openSocket(
        relayUrl(wsBaseUrl, { serverId, role: "client", version: "2", connectionId }),
      );
      const data = await openSocket(
        relayUrl(wsBaseUrl, { serverId, role: "server", version: "2", connectionId }),
      );
      sockets.push(control, client, data);
      await delay(2_000);
      const received = nextFrame(client);
      data.send("wake-after-idle");
      assert.equal((await received).data.toString("utf8"), "wake-after-idle");
      return { idleMs: 2_000, resumed: true };
    } finally {
      closeSockets(sockets);
    }
  });

  await runCase(cases, "network-replacement", async () => {
    const serverId = `${casePrefix}-network`;
    const connectionId = "conn_network";
    const sockets: WebSocket[] = [];
    try {
      const control = await openSocket(
        relayUrl(wsBaseUrl, { serverId, role: "server", version: "2" }),
      );
      const firstClient = await openSocket(
        relayUrl(wsBaseUrl, { serverId, role: "client", version: "2", connectionId }),
      );
      const firstData = await openSocket(
        relayUrl(wsBaseUrl, { serverId, role: "server", version: "2", connectionId }),
      );
      sockets.push(control, firstClient, firstData);
      firstClient.terminate();
      await delay(50);

      const secondClient = await openSocket(
        relayUrl(wsBaseUrl, { serverId, role: "client", version: "2", connectionId }),
      );
      const secondData = await openSocket(
        relayUrl(wsBaseUrl, { serverId, role: "server", version: "2", connectionId }),
      );
      sockets.push(secondClient, secondData);
      const staleRouteSilence = expectNoFrame(secondClient, 250);
      if (firstData.readyState === WebSocket.OPEN) firstData.send("stale-network-route");
      await staleRouteSilence;
      const received = nextFrame(secondClient);
      secondData.send("after-network-change");
      assert.equal((await received).data.toString("utf8"), "after-network-change");
      return { reconnected: true, staleRouteSuppressed: true };
    } finally {
      closeSockets(sockets);
    }
  });

  if (input.fullFrameBoundary) {
    await runCase(cases, "maximum-frame-boundary", async () => {
      const exact = await sendFrameBoundary({
        wsBaseUrl,
        serverId: `${casePrefix}-frame-exact`,
        connectionId: "conn_frame_exact",
        bytes: MAX_CLIENT_FRAME_PAYLOAD_BYTES,
      });
      assert.equal(exact.receivedBytes, MAX_CLIENT_FRAME_PAYLOAD_BYTES);

      const over = await sendOversizedFrame({
        wsBaseUrl,
        serverId: `${casePrefix}-frame-over`,
        connectionId: "conn_frame_over",
        bytes: MAX_CLIENT_FRAME_PAYLOAD_BYTES + 1,
      });
      assert.equal(over.closeCode, 1009);
      return {
        acceptedBytes: exact.receivedBytes,
        rejectedBytes: MAX_CLIENT_FRAME_PAYLOAD_BYTES + 1,
        closeCode: over.closeCode,
      };
    });

    await runCase(cases, "maximum-control-boundary", async () => {
      const serverId = `${casePrefix}-control-frame`;
      const control = await openSocket(
        relayUrl(wsBaseUrl, { serverId, role: "server", version: "2" }),
      );
      try {
        const exact = buildControlFrame(MAX_CONTROL_PAYLOAD_BYTES);
        control.send(exact);
        const pong = await nextJsonFrameOfType(control, "pong");
        assert.equal(pong.type, "pong");
        const closed = waitForClose(control);
        control.send(buildControlFrame(MAX_CONTROL_PAYLOAD_BYTES + 1));
        const close = await closed;
        assert.equal(close.code, 1009);
        return {
          acceptedBytes: exact.length,
          rejectedBytes: exact.length + 1,
          closeCode: close.code,
        };
      } finally {
        closeSockets([control]);
      }
    });
  }

  closeSockets(Array.from(openSockets));
  openSockets.clear();
  const finishedAt = new Date().toISOString();
  return {
    schema: "vibes-relay-poc-matrix/1",
    target: input.target,
    baseUrl,
    fullFrameBoundary: input.fullFrameBoundary === true,
    startedAt,
    finishedAt,
    cases,
    passed: cases.filter((entry) => entry.status === "passed").length,
    failed: cases.filter((entry) => entry.status === "failed").length,
  };
}

async function runCase(
  results: RelayPocCaseResult[],
  id: string,
  run: () => Promise<Record<string, string | number | boolean> | undefined>,
): Promise<void> {
  const started = performance.now();
  try {
    const detail = await run();
    results.push({
      id,
      status: "passed",
      durationMs: Math.round(performance.now() - started),
      detail,
    });
  } catch (error) {
    results.push({
      id,
      status: "failed",
      durationMs: Math.round(performance.now() - started),
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function relayUrl(
  wsBaseUrl: string,
  input: {
    serverId: string;
    role: "server" | "client";
    version: "1" | "2";
    connectionId?: string;
  },
): string {
  const url = new URL("/ws", wsBaseUrl);
  url.searchParams.set("serverId", input.serverId);
  url.searchParams.set("role", input.role);
  url.searchParams.set("v", input.version);
  if (input.connectionId) url.searchParams.set("connectionId", input.connectionId);
  return url.toString();
}

async function openSocket(url: string): Promise<WebSocket> {
  const socket = new WebSocket(url, {
    perMessageDeflate: false,
    maxPayload: MAX_CLIENT_FRAME_PAYLOAD_BYTES + 1024,
  });
  openSockets.add(socket);
  frameQueues.set(socket, []);
  frameWaiters.set(socket, []);
  socket.on("message", (data: RawData, isBinary: boolean) => {
    const frame = { data: rawDataToBuffer(data), isBinary };
    const waiters = frameWaiters.get(socket) ?? [];
    const waiter = waiters.shift();
    if (waiter) {
      clearTimeout(waiter.timeout);
      waiter.resolve(frame);
      return;
    }
    frameQueues.get(socket)?.push(frame);
  });
  socket.once("close", (code, reason) => {
    openSockets.delete(socket);
    for (const waiter of frameWaiters.get(socket) ?? []) {
      clearTimeout(waiter.timeout);
      waiter.reject(new Error(`WebSocket closed before message: ${code} ${reason.toString()}`));
    }
    frameWaiters.set(socket, []);
  });
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("WebSocket open timed out")),
      DEFAULT_TIMEOUT_MS,
    );
    socket.once("open", () => {
      clearTimeout(timeout);
      resolve();
    });
    socket.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
  return socket;
}

function nextFrame(socket: WebSocket, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<ReceivedFrame> {
  const queued = frameQueues.get(socket)?.shift();
  if (queued) return Promise.resolve(queued);
  return new Promise((resolve, reject) => {
    const waiters = frameWaiters.get(socket);
    if (!waiters) {
      reject(new Error("WebSocket frame queue was not initialized"));
      return;
    }
    const waiter: FrameWaiter = {
      resolve,
      reject,
      timeout: setTimeout(() => {
        const current = frameWaiters.get(socket) ?? [];
        frameWaiters.set(
          socket,
          current.filter((candidate) => candidate !== waiter),
        );
        reject(new Error("WebSocket message timed out"));
      }, timeoutMs),
    };
    waiters.push(waiter);
  });
}

async function nextJsonFrameOfType(
  socket: WebSocket,
  expectedType: string,
): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parsed: unknown = JSON.parse((await nextFrame(socket)).data.toString("utf8"));
    if (parsed && typeof parsed === "object" && "type" in parsed && parsed.type === expectedType) {
      return parsed as Record<string, unknown>;
    }
  }
  throw new Error(`WebSocket did not receive ${expectedType}`);
}

function expectNoFrame(socket: WebSocket, durationMs: number): Promise<void> {
  if ((frameQueues.get(socket)?.length ?? 0) > 0) {
    return Promise.reject(new Error("Unexpected queued cross-version frame"));
  }
  return new Promise((resolve, reject) => {
    const onMessage = () => {
      clearTimeout(timeout);
      reject(new Error("Unexpected cross-version frame"));
    };
    const timeout = setTimeout(() => {
      socket.off("message", onMessage);
      resolve();
    }, durationMs);
    socket.once("message", onMessage);
  });
}

function waitForClose(
  socket: WebSocket,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<{ code: number; reason: string }> {
  if (socket.readyState === WebSocket.CLOSED)
    return Promise.resolve({ code: 1006, reason: "already closed" });
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("WebSocket close timed out")), timeoutMs);
    socket.once("close", (code, reason) => {
      clearTimeout(timeout);
      resolve({ code, reason: reason.toString() });
    });
  });
}

async function websocketUpgradeStatus(url: string): Promise<number> {
  return await new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const timeout = setTimeout(() => {
      socket.terminate();
      reject(new Error("WebSocket rejection timed out"));
    }, DEFAULT_TIMEOUT_MS);
    socket.once("unexpected-response", (_request, response) => {
      clearTimeout(timeout);
      response.resume();
      resolve(response.statusCode ?? 0);
    });
    socket.once("open", () => {
      clearTimeout(timeout);
      socket.close();
      reject(new Error("Oversized route key unexpectedly upgraded"));
    });
    socket.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
}

async function sendFrameBoundary(input: {
  wsBaseUrl: string;
  serverId: string;
  connectionId: string;
  bytes: number;
}): Promise<{ receivedBytes: number }> {
  const sockets: WebSocket[] = [];
  try {
    const control = await openSocket(
      relayUrl(input.wsBaseUrl, { serverId: input.serverId, role: "server", version: "2" }),
    );
    const client = await openSocket(
      relayUrl(input.wsBaseUrl, {
        serverId: input.serverId,
        role: "client",
        version: "2",
        connectionId: input.connectionId,
      }),
    );
    const data = await openSocket(
      relayUrl(input.wsBaseUrl, {
        serverId: input.serverId,
        role: "server",
        version: "2",
        connectionId: input.connectionId,
      }),
    );
    sockets.push(control, client, data);
    const received = nextFrame(data, 30_000);
    client.send(Buffer.alloc(input.bytes, 0xa5));
    return { receivedBytes: (await received).data.byteLength };
  } finally {
    closeSockets(sockets);
  }
}

async function sendOversizedFrame(input: {
  wsBaseUrl: string;
  serverId: string;
  connectionId: string;
  bytes: number;
}): Promise<{ closeCode: number }> {
  const sockets: WebSocket[] = [];
  try {
    const client = await openSocket(
      relayUrl(input.wsBaseUrl, {
        serverId: input.serverId,
        role: "client",
        version: "2",
        connectionId: input.connectionId,
      }),
    );
    sockets.push(client);
    const closed = waitForClose(client, 30_000);
    client.send(Buffer.alloc(input.bytes, 0xa5));
    return { closeCode: (await closed).code };
  } finally {
    closeSockets(sockets);
  }
}

function buildControlFrame(bytes: number): string {
  const prefix = '{"type":"ping","padding":"';
  const suffix = '"}';
  return `${prefix}${"x".repeat(bytes - prefix.length - suffix.length)}${suffix}`;
}

function rawDataToBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  return Buffer.concat(data);
}

function closeSockets(sockets: WebSocket[]): void {
  for (const socket of sockets) {
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
      socket.terminate();
    }
  }
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}
