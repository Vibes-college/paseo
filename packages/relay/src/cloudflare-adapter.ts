/// <reference lib="dom" />
/**
 * Isolated Cloudflare Durable Object Relay PoC.
 *
 * Correctness survives Durable Object hibernation through WebSocket tags,
 * serialized attachments, and bounded pending-frame storage. Checked-in
 * configuration is disabled and has no Production route.
 */

import {
  type RateBudgetState,
  type RelayPocMode,
  type RelayPolicy,
  type RelayPolicyEnv,
  consumeRateBudget,
  inspectIncomingFrame,
  isRelayPolicyReady,
  parseRelayPolicy,
  validateRouteKey,
} from "./cloudflare-policy.js";
import type { ConnectionRole, RelaySessionAttachment } from "./types.js";

type RelayProtocolVersion = "1" | "2";
type AcceptedFrameInspection = Extract<ReturnType<typeof inspectIncomingFrame>, { ok: true }>;

const LEGACY_RELAY_VERSION: RelayProtocolVersion = "1";
const CURRENT_RELAY_VERSION: RelayProtocolVersion = "2";
const PENDING_STORAGE_PREFIX = "pending:";

interface WebSocketPair {
  0: WebSocket;
  1: WebSocket;
}

interface DurableObjectStorage {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<boolean>;
  list<T>(options?: { prefix?: string }): Promise<Map<string, T>>;
  getAlarm(): Promise<number | null>;
  setAlarm(scheduledTime: number | Date): Promise<void>;
}

interface DurableObjectState {
  acceptWebSocket(ws: WebSocket, tags?: string[]): void;
  getWebSockets(tag?: string): WebSocket[];
  storage?: DurableObjectStorage;
}

interface WebSocketWithAttachment extends WebSocket {
  serializeAttachment(value: unknown): void;
  deserializeAttachment(): unknown;
}

interface RelaySocketAttachment extends RelaySessionAttachment {
  socketId?: string;
  routeToken?: string;
  rateBudget?: RateBudgetState;
  closedByPolicy?: true;
}

interface StoredFrame {
  data: string | ArrayBuffer;
  bytes: number;
}

interface PendingFrameBatch {
  createdAt: number;
  totalBytes: number;
  frames: StoredFrame[];
}

interface EdgeRateLimiter {
  limit(input: { key: string }): Promise<{ success: boolean }>;
}

interface Env extends RelayPolicyEnv {
  RELAY: DurableObjectNamespace;
  RATE_LIMITER?: EdgeRateLimiter;
}

interface DurableObjectNamespace {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): DurableObjectStub;
}

interface DurableObjectId {
  toString(): string;
}

interface DurableObjectStub {
  fetch(request: Request): Promise<Response>;
}

interface CFResponseInit extends ResponseInit {
  webSocket?: WebSocket;
}

interface ActivationMetrics {
  acceptedFrames: number;
  acceptedBytes: number;
  forwardedFrames: number;
  forwardedBytes: number;
  maxFrameBytes: number;
  rejectedFrames: number;
  rateLimitedFrames: number;
  handshakeAccepted: number;
  handshakeRejected: number;
  pendingFramesStored: number;
  pendingFramesExpired: number;
  upgradesAccepted: number;
  upgradesRejected: number;
}

const workerMetrics = {
  upgradesAccepted: 0,
  upgradesRejected: 0,
  edgeRateLimited: 0,
};

function createActivationMetrics(): ActivationMetrics {
  return {
    acceptedFrames: 0,
    acceptedBytes: 0,
    forwardedFrames: 0,
    forwardedBytes: 0,
    maxFrameBytes: 0,
    rejectedFrames: 0,
    rateLimitedFrames: 0,
    handshakeAccepted: 0,
    handshakeRejected: 0,
    pendingFramesStored: 0,
    pendingFramesExpired: 0,
    upgradesAccepted: 0,
    upgradesRejected: 0,
  };
}

function resolveRelayVersion(rawValue: string | null): RelayProtocolVersion | null {
  if (rawValue == null || rawValue.trim() === "") return LEGACY_RELAY_VERSION;
  const value = rawValue.trim();
  return value === LEGACY_RELAY_VERSION || value === CURRENT_RELAY_VERSION ? value : null;
}

function hasAttachmentMethods(ws: WebSocket): ws is WebSocketWithAttachment {
  return (
    "serializeAttachment" in ws &&
    "deserializeAttachment" in ws &&
    typeof Reflect.get(ws, "serializeAttachment") === "function" &&
    typeof Reflect.get(ws, "deserializeAttachment") === "function"
  );
}

function deserializeAttachment(ws: WebSocket): RelaySocketAttachment | null {
  if (!hasAttachmentMethods(ws)) return null;
  try {
    const value: unknown = ws.deserializeAttachment();
    return isRecord(value) ? (value as unknown as RelaySocketAttachment) : null;
  } catch {
    return null;
  }
}

function serializeAttachment(ws: WebSocket, value: RelaySocketAttachment): void {
  if (!hasAttachmentMethods(ws)) throw new Error("WebSocket does not support attachments");
  ws.serializeAttachment(value);
}

function getGlobalWebSocketPair(): (new () => WebSocketPair) | undefined {
  const WebSocketPairConstructor: unknown = Reflect.get(globalThis, "WebSocketPair");
  return typeof WebSocketPairConstructor === "function"
    ? (WebSocketPairConstructor as new () => WebSocketPair)
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function relayFrameByteLength(message: string | ArrayBuffer): number {
  return typeof message === "string"
    ? new TextEncoder().encode(message).byteLength
    : message.byteLength;
}

async function buildRouteToken(connectionId: string): Promise<string> {
  if (`client:${connectionId}`.length <= 256 && `server:${connectionId}`.length <= 256) {
    return connectionId;
  }
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(connectionId));
  return `sha256_${Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("")}`;
}

function clientTag(routeToken: string): string {
  return `client:${routeToken}`;
}

function serverTag(routeToken: string): string {
  return `server:${routeToken}`;
}

function uniqueSockets(sockets: WebSocket[]): WebSocket[] {
  return Array.from(new Set(sockets));
}

function safeRelayLog(
  level: "info" | "warn" | "error",
  event: string,
  fields: Record<string, string | number> = {},
): void {
  const entry = JSON.stringify({ event, ...fields });
  if (level === "error") console.error(`[Relay DO] ${entry}`);
  else if (level === "warn") console.warn(`[Relay DO] ${entry}`);
  else console.log(`[Relay DO] ${entry}`);
}

class MemoryDurableObjectStorage implements DurableObjectStorage {
  private values = new Map<string, unknown>();
  private alarm: number | null = null;

  async get<T>(key: string): Promise<T | undefined> {
    return this.values.get(key) as T | undefined;
  }

  async put<T>(key: string, value: T): Promise<void> {
    this.values.set(key, value);
  }

  async delete(key: string): Promise<boolean> {
    return this.values.delete(key);
  }

  async list<T>(options?: { prefix?: string }): Promise<Map<string, T>> {
    const prefix = options?.prefix ?? "";
    return new Map(
      Array.from(this.values.entries()).filter(([key]) => key.startsWith(prefix)),
    ) as Map<string, T>;
  }

  async getAlarm(): Promise<number | null> {
    return this.alarm;
  }

  async setAlarm(scheduledTime: number | Date): Promise<void> {
    this.alarm =
      scheduledTime instanceof Date ? scheduledTime.getTime() : Math.trunc(scheduledTime);
  }
}

export class RelayDurableObject {
  private readonly state: DurableObjectState;
  private readonly storage: DurableObjectStorage;
  private readonly policy: RelayPolicy;
  private readonly metrics = createActivationMetrics();
  private readonly activationStartedAtSeconds = Math.floor(Date.now() / 1000);

  constructor(state: DurableObjectState, env: RelayPolicyEnv = {}) {
    this.state = state;
    this.storage = state.storage ?? new MemoryDurableObjectStorage();
    this.policy = parseRelayPolicy(env);
  }

  private createWebSocketPair(): [WebSocket, WebSocket] {
    const WebSocketPairConstructor = getGlobalWebSocketPair();
    if (!WebSocketPairConstructor) throw new Error("WebSocketPair not available in global scope");
    const pair = new WebSocketPairConstructor();
    return [pair[0], pair[1]];
  }

  private allSockets(): WebSocket[] {
    return uniqueSockets(this.state.getWebSockets());
  }

  private requireWebSocketUpgrade(request: Request): Response | null {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }
    return null;
  }

  private switchingProtocols(client: WebSocket): Response {
    return new Response(null, { status: 101, webSocket: client } as CFResponseInit);
  }

  private rejectUpgrade(status: number, body: string): Response {
    this.metrics.upgradesRejected += 1;
    safeRelayLog("warn", "upgrade_rejected", { status });
    return new Response(body, { status });
  }

  private ensureSocketCapacity(replacing: number): Response | null {
    if (this.allSockets().length - replacing >= this.policy.limits.maxSocketsPerSession) {
      return this.rejectUpgrade(503, "Relay session capacity reached");
    }
    return null;
  }

  private countConnectionIds(): number {
    const ids = new Set<string>();
    for (const socket of this.allSockets()) {
      const attachment = deserializeAttachment(socket);
      if (
        attachment?.version === CURRENT_RELAY_VERSION &&
        attachment.connectionId &&
        !attachment.closedByPolicy
      ) {
        ids.add(attachment.connectionId);
      }
    }
    return ids.size;
  }

  private hasConnectionId(connectionId: string): boolean {
    return this.allSockets().some((socket) => {
      const attachment = deserializeAttachment(socket);
      return attachment?.connectionId === connectionId && !attachment.closedByPolicy;
    });
  }

  private listConnectionIds(): string[] {
    const ids = new Set<string>();
    for (const socket of this.state.getWebSockets("client")) {
      const attachment = deserializeAttachment(socket);
      if (attachment?.connectionId) ids.add(attachment.connectionId);
    }
    return Array.from(ids);
  }

  private notifyControls(message: unknown): void {
    const text = JSON.stringify(message);
    for (const socket of this.state.getWebSockets("server-control")) {
      try {
        socket.send(text);
      } catch {
        try {
          socket.close(1012, "Control send failed");
        } catch {
          // The transport is already closed.
        }
      }
    }
  }

  private pendingKey(version: RelayProtocolVersion, connectionId: string | null): string {
    return `${PENDING_STORAGE_PREFIX}${version}:${encodeURIComponent(connectionId ?? "legacy")}`;
  }

  private async bufferFrame(args: {
    version: RelayProtocolVersion;
    connectionId: string | null;
    source: WebSocket;
    attachment: RelaySocketAttachment;
    message: string | ArrayBuffer;
    bytes: number;
  }): Promise<void> {
    const key = this.pendingKey(args.version, args.connectionId);
    const now = Date.now();
    const existing = await this.storage.get<PendingFrameBatch>(key);
    const batch =
      existing && now - existing.createdAt < this.policy.limits.pendingAttachTimeoutMs
        ? existing
        : { createdAt: now, totalBytes: 0, frames: [] };

    const allPending = await this.storage.list<PendingFrameBatch>({
      prefix: PENDING_STORAGE_PREFIX,
    });
    let otherPendingBytes = 0;
    for (const [storedKey, storedBatch] of allPending) {
      if (
        storedKey !== key &&
        now - storedBatch.createdAt < this.policy.limits.pendingAttachTimeoutMs
      ) {
        otherPendingBytes += storedBatch.totalBytes;
      }
    }

    if (
      batch.frames.length >= this.policy.limits.maxPendingFramesPerConnection ||
      batch.totalBytes + args.bytes > this.policy.limits.maxPendingBytesPerConnection ||
      otherPendingBytes + batch.totalBytes + args.bytes >
        this.policy.limits.maxPendingBytesPerSession
    ) {
      this.metrics.rejectedFrames += 1;
      this.closeByPolicy(args.source, args.attachment, 1013, "Pending relay capacity reached");
      safeRelayLog("warn", "pending_capacity_rejected");
      return;
    }

    batch.frames.push({ data: args.message, bytes: args.bytes });
    batch.totalBytes += args.bytes;
    await this.storage.put(key, batch);
    this.metrics.pendingFramesStored += 1;

    const expiry = batch.createdAt + this.policy.limits.pendingAttachTimeoutMs;
    const currentAlarm = await this.storage.getAlarm();
    if (currentAlarm === null || expiry < currentAlarm) await this.storage.setAlarm(expiry);
  }

  private recordForwardedFrame(message: string | ArrayBuffer, count = 1): void {
    this.metrics.forwardedFrames += count;
    this.metrics.forwardedBytes += relayFrameByteLength(message) * count;
  }

  private async flushFrames(
    version: RelayProtocolVersion,
    connectionId: string | null,
    destination: WebSocket,
  ): Promise<void> {
    const key = this.pendingKey(version, connectionId);
    const batch = await this.storage.get<PendingFrameBatch>(key);
    if (!batch) return;
    for (const frame of batch.frames) {
      try {
        destination.send(frame.data);
        this.recordForwardedFrame(frame.data);
      } catch {
        destination.close(1012, "Pending frame delivery failed");
        safeRelayLog("warn", "pending_delivery_failed");
        return;
      }
    }
    await this.storage.delete(key);
  }

  private closeByPolicy(
    socket: WebSocket,
    attachment: RelaySocketAttachment,
    code: 1008 | 1009 | 1013,
    reason: string,
  ): void {
    attachment.closedByPolicy = true;
    serializeAttachment(socket, attachment);
    socket.close(code, reason);
  }

  private acceptSocket(args: {
    socket: WebSocket;
    tags: string[];
    attachment: RelaySocketAttachment;
  }): void {
    this.state.acceptWebSocket(args.socket, args.tags);
    serializeAttachment(args.socket, args.attachment);
    this.metrics.upgradesAccepted += 1;
    safeRelayLog("info", "socket_connected", {
      version: Number(args.attachment.version ?? LEGACY_RELAY_VERSION),
      role: args.attachment.role === "server" ? 1 : 0,
    });
  }

  private async fetchV1(
    request: Request,
    role: ConnectionRole,
    serverId: string,
  ): Promise<Response> {
    const upgradeError = this.requireWebSocketUpgrade(request);
    if (upgradeError) return upgradeError;

    const existing = this.state.getWebSockets(role);
    const capacityError = this.ensureSocketCapacity(existing.length);
    if (capacityError) return capacityError;
    for (const socket of existing) {
      const attachment = deserializeAttachment(socket);
      if (attachment) this.closeByPolicy(socket, attachment, 1008, "Replaced by new connection");
      else socket.close(1008, "Replaced by new connection");
    }

    const [client, server] = this.createWebSocketPair();
    this.acceptSocket({
      socket: server,
      tags: [role],
      attachment: {
        serverId,
        role,
        version: LEGACY_RELAY_VERSION,
        connectionId: null,
        socketId: crypto.randomUUID(),
        createdAt: Date.now(),
      },
    });
    if (role === "server") await this.flushFrames(LEGACY_RELAY_VERSION, null, server);
    return this.switchingProtocols(client);
  }

  private async resolveV2SocketShape(
    role: ConnectionRole,
    connectionId: string,
  ): Promise<{
    connectionId: string;
    routeToken: string;
    isControl: boolean;
    isServerData: boolean;
    replacementTag: string | null;
    tags: string[];
  }> {
    const resolvedConnectionId =
      role === "client" && !connectionId
        ? `conn_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`
        : connectionId;
    const routeToken = resolvedConnectionId ? await buildRouteToken(resolvedConnectionId) : "";
    const isControl = role === "server" && !resolvedConnectionId;
    const isServerData = role === "server" && resolvedConnectionId.length > 0;
    let replacementTag: string | null = null;
    let tags: string[];
    if (role === "client") {
      tags = ["client", clientTag(routeToken)];
    } else if (isControl) {
      replacementTag = "server-control";
      tags = ["server-control"];
    } else {
      replacementTag = serverTag(routeToken);
      tags = ["server", replacementTag];
    }
    return {
      connectionId: resolvedConnectionId,
      routeToken,
      isControl,
      isServerData,
      replacementTag,
      tags,
    };
  }

  private validateV2Capacity(
    role: ConnectionRole,
    connectionId: string,
    routeToken: string,
    replacing: WebSocket[],
  ): Response | null {
    const socketCapacityError = this.ensureSocketCapacity(replacing.length);
    if (socketCapacityError) return socketCapacityError;
    if (
      connectionId &&
      !this.hasConnectionId(connectionId) &&
      this.countConnectionIds() >= this.policy.limits.maxConnectionsPerSession
    ) {
      return this.rejectUpgrade(503, "Connection capacity reached");
    }
    if (role !== "client") return null;

    const clients = this.state.getWebSockets(clientTag(routeToken));
    return clients.length >= this.policy.limits.maxClientsPerConnection
      ? this.rejectUpgrade(429, "Client capacity reached")
      : null;
  }

  private closeReplacedSockets(sockets: WebSocket[]): void {
    for (const socket of sockets) {
      const attachment = deserializeAttachment(socket);
      if (attachment) this.closeByPolicy(socket, attachment, 1008, "Replaced by new connection");
      else socket.close(1008, "Replaced by new connection");
    }
  }

  private async initializeV2Routing(args: {
    role: ConnectionRole;
    connectionId: string;
    isControl: boolean;
    isServerData: boolean;
    socket: WebSocket;
  }): Promise<void> {
    if (args.role === "client") {
      this.notifyControls({ type: "connected", connectionId: args.connectionId });
      return;
    }
    if (args.isControl) {
      args.socket.send(JSON.stringify({ type: "sync", connectionIds: this.listConnectionIds() }));
      return;
    }
    if (args.isServerData) {
      await this.flushFrames(CURRENT_RELAY_VERSION, args.connectionId, args.socket);
    }
  }

  private async fetchV2(args: {
    request: Request;
    role: ConnectionRole;
    serverId: string;
    connectionId: string;
  }): Promise<Response> {
    const upgradeError = this.requireWebSocketUpgrade(args.request);
    if (upgradeError) return upgradeError;

    const shape = await this.resolveV2SocketShape(args.role, args.connectionId);
    if (shape.connectionId && !validateRouteKey(shape.connectionId).ok) {
      return this.rejectUpgrade(400, "Invalid connectionId parameter");
    }

    const replacing = shape.replacementTag ? this.state.getWebSockets(shape.replacementTag) : [];
    const capacityError = this.validateV2Capacity(
      args.role,
      shape.connectionId,
      shape.routeToken,
      replacing,
    );
    if (capacityError) return capacityError;
    this.closeReplacedSockets(replacing);

    const [client, server] = this.createWebSocketPair();
    this.acceptSocket({
      socket: server,
      tags: shape.tags,
      attachment: {
        serverId: args.serverId,
        role: args.role,
        version: CURRENT_RELAY_VERSION,
        connectionId: shape.connectionId || null,
        routeToken: shape.routeToken || undefined,
        socketId: crypto.randomUUID(),
        createdAt: Date.now(),
      },
    });
    await this.initializeV2Routing({
      role: args.role,
      connectionId: shape.connectionId,
      isControl: shape.isControl,
      isServerData: shape.isServerData,
      socket: server,
    });
    return this.switchingProtocols(client);
  }

  private async renderMetrics(): Promise<string> {
    const sockets = this.allSockets();
    const pending = await this.storage.list<PendingFrameBatch>({ prefix: PENDING_STORAGE_PREFIX });
    let pendingFrames = 0;
    let pendingBytes = 0;
    for (const batch of pending.values()) {
      pendingFrames += batch.frames.length;
      pendingBytes += batch.totalBytes;
    }

    const values: Array<[string, number]> = [
      ["paseo_relay_activation_started_at_seconds", this.activationStartedAtSeconds],
      [
        "paseo_relay_session_ready",
        sockets.length < this.policy.limits.maxSocketsPerSession ? 1 : 0,
      ],
      ["paseo_relay_active_websockets", sockets.length],
      ["paseo_relay_active_connections", this.countConnectionIds()],
      ["paseo_relay_pending_frames", pendingFrames],
      ["paseo_relay_pending_bytes", pendingBytes],
      ["paseo_relay_frames_accepted_total", this.metrics.acceptedFrames],
      ["paseo_relay_bytes_accepted_total", this.metrics.acceptedBytes],
      ["paseo_relay_frames_forwarded_total", this.metrics.forwardedFrames],
      ["paseo_relay_bytes_forwarded_total", this.metrics.forwardedBytes],
      ["paseo_relay_max_frame_bytes", this.metrics.maxFrameBytes],
      ["paseo_relay_frames_rejected_total", this.metrics.rejectedFrames],
      ["paseo_relay_rate_limited_frames_total", this.metrics.rateLimitedFrames],
      ["paseo_relay_handshake_accepted_total", this.metrics.handshakeAccepted],
      ["paseo_relay_handshake_rejected_total", this.metrics.handshakeRejected],
      ["paseo_relay_pending_frames_stored_total", this.metrics.pendingFramesStored],
      ["paseo_relay_pending_frames_expired_total", this.metrics.pendingFramesExpired],
      ["paseo_relay_upgrades_accepted_total", this.metrics.upgradesAccepted],
      ["paseo_relay_upgrades_rejected_total", this.metrics.upgradesRejected],
      ["paseo_relay_session_socket_limit", this.policy.limits.maxSocketsPerSession],
      ["paseo_relay_session_connection_limit", this.policy.limits.maxConnectionsPerSession],
    ];
    return renderPrometheusMetrics(values);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/__poc__/ready") {
      const ready = this.allSockets().length < this.policy.limits.maxSocketsPerSession;
      return jsonResponse({ status: ready ? "ready" : "unready" }, ready ? 200 : 503);
    }
    if (url.pathname === "/__poc__/metrics") {
      return new Response(await this.renderMetrics(), {
        headers: { "content-type": "text/plain; version=0.0.4", "cache-control": "no-store" },
      });
    }

    const roleRaw = url.searchParams.get("role");
    const role = roleRaw === "server" || roleRaw === "client" ? roleRaw : null;
    const serverId = url.searchParams.get("serverId")?.trim() ?? "";
    const connectionId = url.searchParams.get("connectionId")?.trim() ?? "";
    const version = resolveRelayVersion(url.searchParams.get("v"));

    if (!role) return this.rejectUpgrade(400, "Missing or invalid role parameter");
    if (!validateRouteKey(serverId).ok)
      return this.rejectUpgrade(400, "Invalid serverId parameter");
    if (!version) return this.rejectUpgrade(400, "Invalid v parameter (expected 1 or 2)");
    if (connectionId && !validateRouteKey(connectionId).ok) {
      return this.rejectUpgrade(400, "Invalid connectionId parameter");
    }

    return version === LEGACY_RELAY_VERSION
      ? this.fetchV1(request, role, serverId)
      : this.fetchV2({ request, role, serverId, connectionId });
  }

  private inspectAndChargeFrame(
    ws: WebSocket,
    message: string | ArrayBuffer,
    attachment: RelaySocketAttachment,
  ): {
    version: RelayProtocolVersion;
    control: boolean;
    inspection: AcceptedFrameInspection;
  } | null {
    const version = attachment.version ?? LEGACY_RELAY_VERSION;
    const control =
      version === CURRENT_RELAY_VERSION && attachment.role === "server" && !attachment.connectionId;
    const inspection = inspectIncomingFrame({ role: attachment.role, control, message });
    if (!inspection.ok) {
      this.metrics.rejectedFrames += 1;
      if (
        inspection.reason === "invalid_handshake_key" ||
        inspection.reason === "invalid_handshake"
      ) {
        this.metrics.handshakeRejected += 1;
      }
      this.closeByPolicy(ws, attachment, inspection.closeCode, inspection.reason);
      safeRelayLog("warn", "frame_rejected", { code: inspection.closeCode });
      return null;
    }

    if (inspection.handshake) this.metrics.handshakeAccepted += 1;
    const rate = consumeRateBudget({
      now: Date.now(),
      bytes: inspection.bytes,
      previous: attachment.rateBudget,
      limits: this.policy.limits,
    });
    if (!rate.ok) {
      this.metrics.rateLimitedFrames += 1;
      this.closeByPolicy(ws, attachment, 1013, "Relay rate limit reached");
      safeRelayLog("warn", "frame_rate_limited");
      return null;
    }
    attachment.rateBudget = rate.state;
    serializeAttachment(ws, attachment);
    this.metrics.acceptedFrames += 1;
    this.metrics.acceptedBytes += inspection.bytes;
    this.metrics.maxFrameBytes = Math.max(this.metrics.maxFrameBytes, inspection.bytes);
    return { version, control, inspection };
  }

  private async queueFrameUntilServer(args: {
    version: RelayProtocolVersion;
    connectionId: string | null;
    source: WebSocket;
    attachment: RelaySocketAttachment;
    message: string | ArrayBuffer;
    inspection: AcceptedFrameInspection;
  }): Promise<void> {
    await this.bufferFrame({
      version: args.version,
      connectionId: args.connectionId,
      source: args.source,
      attachment: args.attachment,
      message: args.message,
      bytes: args.inspection.bytes,
    });
  }

  private async routeLegacyFrame(args: {
    source: WebSocket;
    attachment: RelaySocketAttachment;
    message: string | ArrayBuffer;
    inspection: AcceptedFrameInspection;
  }): Promise<void> {
    const targetRole = args.attachment.role === "server" ? "client" : "server";
    const targets = this.state.getWebSockets(targetRole);
    if (targets.length === 0 && args.attachment.role === "client") {
      await this.queueFrameUntilServer({
        version: LEGACY_RELAY_VERSION,
        connectionId: null,
        source: args.source,
        attachment: args.attachment,
        message: args.message,
        inspection: args.inspection,
      });
      return;
    }
    this.forwardFrame(targets, args.message);
  }

  private async routeV2Frame(args: {
    source: WebSocket;
    attachment: RelaySocketAttachment;
    message: string | ArrayBuffer;
    inspection: AcceptedFrameInspection;
    control: boolean;
  }): Promise<void> {
    if (args.control) {
      args.source.send(JSON.stringify({ type: "pong", ts: Date.now() }));
      return;
    }

    const connectionId = args.attachment.connectionId;
    if (!connectionId) {
      this.closeByPolicy(args.source, args.attachment, 1008, "Missing connection identity");
      return;
    }
    const routeToken = args.attachment.routeToken ?? connectionId;
    if (args.attachment.role !== "client") {
      this.forwardFrame(this.state.getWebSockets(clientTag(routeToken)), args.message);
      return;
    }

    const targets = this.state.getWebSockets(serverTag(routeToken));
    if (targets.length > 0) {
      this.forwardFrame(targets, args.message);
      return;
    }
    await this.queueFrameUntilServer({
      version: CURRENT_RELAY_VERSION,
      connectionId,
      source: args.source,
      attachment: args.attachment,
      message: args.message,
      inspection: args.inspection,
    });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const attachment = deserializeAttachment(ws);
    if (!attachment) {
      ws.close(1008, "Missing relay attachment");
      safeRelayLog("error", "attachment_missing");
      return;
    }

    if (attachment.closedByPolicy) return;

    const accepted = this.inspectAndChargeFrame(ws, message, attachment);
    if (!accepted) return;
    if (accepted.version === LEGACY_RELAY_VERSION) {
      await this.routeLegacyFrame({
        source: ws,
        attachment,
        message,
        inspection: accepted.inspection,
      });
      return;
    }
    await this.routeV2Frame({
      source: ws,
      attachment,
      message,
      inspection: accepted.inspection,
      control: accepted.control,
    });
  }

  private hasOtherClientSocket(
    connectionId: string,
    closingSocket: WebSocket,
    closingAttachment: RelaySocketAttachment,
  ): boolean {
    const routeToken = closingAttachment.routeToken ?? connectionId;
    return this.state.getWebSockets(clientTag(routeToken)).some((candidate) => {
      const candidateAttachment = deserializeAttachment(candidate);
      if (candidateAttachment?.closedByPolicy) return false;
      if (closingAttachment.socketId && candidateAttachment?.socketId) {
        return candidateAttachment.socketId !== closingAttachment.socketId;
      }
      return candidate !== closingSocket;
    });
  }

  private hasOtherServerSocket(
    connectionId: string,
    closingSocket: WebSocket,
    closingAttachment: RelaySocketAttachment,
  ): boolean {
    const routeToken = closingAttachment.routeToken ?? connectionId;
    return this.state.getWebSockets(serverTag(routeToken)).some((candidate) => {
      const candidateAttachment = deserializeAttachment(candidate);
      if (candidateAttachment?.closedByPolicy) return false;
      if (closingAttachment.socketId && candidateAttachment?.socketId) {
        return candidateAttachment.socketId !== closingAttachment.socketId;
      }
      return candidate !== closingSocket;
    });
  }

  async webSocketClose(
    ws: WebSocket,
    _code: number,
    _reason: string,
    _wasClean: boolean,
  ): Promise<void> {
    const attachment = deserializeAttachment(ws);
    if (!attachment) return;
    const version = attachment.version ?? LEGACY_RELAY_VERSION;
    safeRelayLog("info", "socket_disconnected", {
      version: Number(version),
      role: attachment.role === "server" ? 1 : 0,
    });

    if (version === LEGACY_RELAY_VERSION) {
      if (attachment.role === "client") {
        const key = this.pendingKey(version, null);
        await this.storage.delete(key);
      }
      return;
    }

    const connectionId = attachment.connectionId;
    if (!connectionId) return;
    if (attachment.role === "client") {
      if (this.hasOtherClientSocket(connectionId, ws, attachment)) return;
      const key = this.pendingKey(version, connectionId);
      await this.storage.delete(key);
      const routeToken = attachment.routeToken ?? connectionId;
      for (const serverSocket of this.state.getWebSockets(serverTag(routeToken))) {
        serverSocket.close(1001, "Client disconnected");
      }
      this.notifyControls({ type: "disconnected", connectionId });
      return;
    }

    if (attachment.closedByPolicy || this.hasOtherServerSocket(connectionId, ws, attachment)) {
      return;
    }
    const routeToken = attachment.routeToken ?? connectionId;
    for (const clientSocket of this.state.getWebSockets(clientTag(routeToken))) {
      clientSocket.close(1012, "Server disconnected");
    }
  }

  webSocketError(ws: WebSocket, _error: unknown): void {
    if (deserializeAttachment(ws)) safeRelayLog("error", "websocket_error");
  }

  private async closeClientsForExpiredPendingKey(key: string): Promise<void> {
    const route = key.slice(PENDING_STORAGE_PREFIX.length);
    const separator = route.indexOf(":");
    const version = route.slice(0, separator);
    const connectionId = decodeURIComponent(route.slice(separator + 1));
    const sockets =
      version === CURRENT_RELAY_VERSION
        ? this.state.getWebSockets(clientTag(await buildRouteToken(connectionId)))
        : this.state.getWebSockets("client");
    for (const socket of sockets) {
      const attachment = deserializeAttachment(socket);
      if (attachment) {
        this.closeByPolicy(socket, attachment, 1013, "Pending relay attach timed out");
      } else {
        socket.close(1013, "Pending relay attach timed out");
      }
    }
  }

  async alarm(): Promise<void> {
    const now = Date.now();
    const pending = await this.storage.list<PendingFrameBatch>({ prefix: PENDING_STORAGE_PREFIX });
    let nextExpiry: number | null = null;
    for (const [key, batch] of pending) {
      const expiry = batch.createdAt + this.policy.limits.pendingAttachTimeoutMs;
      if (expiry <= now) {
        await this.storage.delete(key);
        await this.closeClientsForExpiredPendingKey(key);
        this.metrics.pendingFramesExpired += batch.frames.length;
        continue;
      }
      nextExpiry = nextExpiry === null ? expiry : Math.min(nextExpiry, expiry);
    }
    if (nextExpiry !== null) await this.storage.setAlarm(nextExpiry);
  }

  private forwardFrame(targets: WebSocket[], message: string | ArrayBuffer): void {
    for (const target of targets) {
      try {
        target.send(message);
        this.recordForwardedFrame(message);
      } catch {
        target.close(1012, "Relay delivery failed");
        safeRelayLog("warn", "frame_delivery_failed");
      }
    }
  }
}

export default { fetch: handleWorkerFetch };

async function handleWorkerFetch(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/health") return jsonResponse({ status: "ok" }, 200);

  let policy: RelayPolicy;
  try {
    policy = parseRelayPolicy(env);
  } catch {
    return jsonResponse({ status: "unready", reason: "invalid_configuration" }, 503);
  }
  const host = request.headers.get("host") ?? url.host;
  const policyReady = isRelayPolicyReady(policy, host);
  const rateLimiterReady = policy.mode !== "preview" || env.RATE_LIMITER !== undefined;
  const ready = policyReady && rateLimiterReady;

  if (url.pathname === "/ready") return handleReadyRequest(env, ready);
  if (url.pathname === "/metrics") return handleMetricsRequest(url, env, ready, policy.mode);
  if (url.pathname === "/ws") return handleWorkerWebSocketUpgrade(request, url, env, ready);
  return new Response("Not found", { status: 404 });
}

async function handleReadyRequest(env: Env, ready: boolean): Promise<Response> {
  if (!ready) return jsonResponse({ status: "unready" }, 503);
  try {
    const probe = await fetchSessionOperation(
      env,
      "__poc_readiness__",
      CURRENT_RELAY_VERSION,
      "/__poc__/ready",
    );
    return jsonResponse({ status: probe.ok ? "ready" : "unready" }, probe.ok ? 200 : 503);
  } catch {
    return jsonResponse({ status: "unready" }, 503);
  }
}

async function handleMetricsRequest(
  url: URL,
  env: Env,
  ready: boolean,
  mode: RelayPocMode,
): Promise<Response> {
  const globalMetrics = renderWorkerMetrics({
    ready,
    rateLimiter: env.RATE_LIMITER !== undefined,
  });
  if (!ready || mode !== "local") return metricsResponse(globalMetrics);
  const serverId = url.searchParams.get("serverId")?.trim();
  if (!serverId || !validateRouteKey(serverId).ok) return metricsResponse(globalMetrics);

  const session = await fetchSessionOperation(
    env,
    serverId,
    resolveRelayVersion(url.searchParams.get("v")) ?? "2",
    "/__poc__/metrics",
  );
  return metricsResponse(`${globalMetrics}${await session.text()}`, session.status);
}

async function handleWorkerWebSocketUpgrade(
  request: Request,
  url: URL,
  env: Env,
  ready: boolean,
): Promise<Response> {
  if (!ready) {
    workerMetrics.upgradesRejected += 1;
    return new Response("Relay PoC is not ready for this host", { status: 503 });
  }

  const serverId = url.searchParams.get("serverId")?.trim() ?? "";
  const connectionId = url.searchParams.get("connectionId")?.trim() ?? "";
  const version = resolveRelayVersion(url.searchParams.get("v"));
  const routeKeysValid =
    validateRouteKey(serverId).ok && (!connectionId || validateRouteKey(connectionId).ok);
  if (!routeKeysValid) {
    workerMetrics.upgradesRejected += 1;
    return new Response("Invalid route key", { status: 400 });
  }
  if (!version) {
    workerMetrics.upgradesRejected += 1;
    return new Response("Invalid v parameter (expected 1 or 2)", { status: 400 });
  }
  const rateLimitResponse = await enforceEdgeRateLimit(request, env);
  if (rateLimitResponse) return rateLimitResponse;

  const id = env.RELAY.idFromName(`relay-v${version}:${serverId}`);
  const stub = env.RELAY.get(id);
  const normalizedUrl = new URL(request.url);
  normalizedUrl.searchParams.set("v", version);
  const response = await stub.fetch(new Request(normalizedUrl.toString(), request));
  if (response.status === 101) workerMetrics.upgradesAccepted += 1;
  else workerMetrics.upgradesRejected += 1;
  return response;
}

async function enforceEdgeRateLimit(request: Request, env: Env): Promise<Response | null> {
  if (!env.RATE_LIMITER) return null;
  const key = request.headers.get("cf-connecting-ip")?.trim() || "unknown";
  const result = await env.RATE_LIMITER.limit({ key });
  if (result.success) return null;
  workerMetrics.edgeRateLimited += 1;
  workerMetrics.upgradesRejected += 1;
  return new Response("Relay edge rate limit reached", {
    status: 429,
    headers: { "retry-after": "60" },
  });
}

function metricsResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/plain; version=0.0.4", "cache-control": "no-store" },
  });
}

async function fetchSessionOperation(
  env: Env,
  serverId: string,
  version: RelayProtocolVersion,
  pathname: string,
): Promise<Response> {
  const id = env.RELAY.idFromName(`relay-v${version}:${serverId}`);
  const stub = env.RELAY.get(id);
  return stub.fetch(new Request(`https://relay-poc.invalid${pathname}`));
}

function renderPrometheusMetrics(values: Array<[string, number]>): string {
  const lines = values.map(([name, value]) => {
    const type = name.endsWith("_total") ? "counter" : "gauge";
    return `# TYPE ${name} ${type}\n${name} ${value}`;
  });
  return `${lines.join("\n")}\n`;
}

function renderWorkerMetrics(input: { ready: boolean; rateLimiter: boolean }): string {
  const values: Array<[string, number]> = [
    ["paseo_relay_ready", input.ready ? 1 : 0],
    ["paseo_relay_edge_rate_limiter_configured", input.rateLimiter ? 1 : 0],
    ["paseo_relay_worker_upgrades_accepted_total", workerMetrics.upgradesAccepted],
    ["paseo_relay_worker_upgrades_rejected_total", workerMetrics.upgradesRejected],
    ["paseo_relay_worker_edge_rate_limited_total", workerMetrics.edgeRateLimited],
  ];
  return renderPrometheusMetrics(values);
}

function jsonResponse(body: Record<string, string>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
