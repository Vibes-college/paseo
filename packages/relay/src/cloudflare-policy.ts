import type { ConnectionRole } from "./types.js";

export type RelayPocMode = "disabled" | "local" | "preview";

export const MAX_ROUTE_KEY_BYTES = 256;
export const MAX_FRAME_WIRE_BYTES = 32 * 1024 * 1024;
export const MAX_CLIENT_FRAME_PAYLOAD_BYTES = MAX_FRAME_WIRE_BYTES - 14;
export const MAX_CONTROL_PAYLOAD_BYTES = 64 * 1024;

export interface RelayLimits {
  maxSocketsPerSession: number;
  maxConnectionsPerSession: number;
  maxClientsPerConnection: number;
  maxPendingFramesPerConnection: number;
  maxPendingBytesPerConnection: number;
  maxPendingBytesPerSession: number;
  pendingAttachTimeoutMs: number;
  rateWindowMs: number;
  maxFramesPerWindow: number;
  maxBytesPerWindow: number;
}

export const DEFAULT_RELAY_LIMITS: RelayLimits = {
  maxSocketsPerSession: 64,
  maxConnectionsPerSession: 16,
  maxClientsPerConnection: 2,
  maxPendingFramesPerConnection: 8,
  maxPendingBytesPerConnection: 256 * 1024,
  maxPendingBytesPerSession: 1024 * 1024,
  pendingAttachTimeoutMs: 15_000,
  rateWindowMs: 10_000,
  maxFramesPerWindow: 600,
  maxBytesPerWindow: 64 * 1024 * 1024,
};

export interface RelayPolicyEnv {
  PASEO_RELAY_POC_MODE?: string;
  PASEO_RELAY_ALLOWED_HOSTS?: string;
  PASEO_RELAY_MAX_SOCKETS_PER_SESSION?: string;
  PASEO_RELAY_MAX_CONNECTIONS_PER_SESSION?: string;
  PASEO_RELAY_MAX_CLIENTS_PER_CONNECTION?: string;
  PASEO_RELAY_MAX_PENDING_FRAMES?: string;
  PASEO_RELAY_MAX_PENDING_BYTES?: string;
  PASEO_RELAY_MAX_PENDING_BYTES_PER_SESSION?: string;
  PASEO_RELAY_PENDING_ATTACH_TIMEOUT_MS?: string;
  PASEO_RELAY_RATE_WINDOW_MS?: string;
  PASEO_RELAY_MAX_FRAMES_PER_WINDOW?: string;
  PASEO_RELAY_MAX_BYTES_PER_WINDOW?: string;
}

export interface RelayPolicy {
  mode: RelayPocMode;
  allowedHosts: ReadonlySet<string>;
  limits: RelayLimits;
}

interface IncomingFrameInput {
  role: ConnectionRole;
  control: boolean;
  message: string | ArrayBuffer;
}

export type IncomingFrameResult =
  | {
      ok: true;
      bytes: number;
      handshake: "hello" | "e2ee_hello" | null;
    }
  | {
      ok: false;
      closeCode: 1008 | 1009;
      reason:
        | "frame_too_large"
        | "control_frame_too_large"
        | "unsupported_control_message"
        | "invalid_handshake_key"
        | "invalid_handshake"
        | "unsupported_plaintext_frame";
    };

export interface RateBudgetState {
  startedAt: number;
  frames: number;
  bytes: number;
}

interface ConsumeRateBudgetInput {
  now: number;
  bytes: number;
  previous: RateBudgetState | undefined;
  limits: RelayLimits;
}

export type ConsumeRateBudgetResult =
  | { ok: true; state: RateBudgetState }
  | {
      ok: false;
      reason: "frame_rate_exceeded" | "byte_rate_exceeded";
      state: RateBudgetState;
    };

const UNSUPPORTED_X25519_PUBLIC_KEYS = new Set([
  "0000000000000000000000000000000000000000000000000000000000000000",
  "0100000000000000000000000000000000000000000000000000000000000000",
  "E0EB7A7C3B41B8AE1656E3FAF19FC46ADA098DEB9C32B1FD866205165F49B800",
  "5F9C95BCA3508C24B1D0B1559C83EF5B04445CC4581C8E86D8224EDDD09F1157",
  "ECFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF7F",
  "EDFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF7F",
  "EEFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF7F",
]);

const MAX_HANDSHAKE_INSPECTION_BYTES = 4 * 1024;

const X25519_FIELD_PRIME_LE = Uint8Array.from([
  0xed,
  ...Array.from({ length: 30 }, () => 0xff),
  0x7f,
]);

export function parseRelayPolicy(env: RelayPolicyEnv): RelayPolicy {
  const rawMode = env.PASEO_RELAY_POC_MODE?.trim() || "disabled";
  if (rawMode !== "disabled" && rawMode !== "local" && rawMode !== "preview") {
    throw new Error("PASEO_RELAY_POC_MODE must be disabled, local, or preview");
  }

  const allowedHosts = new Set(
    (env.PASEO_RELAY_ALLOWED_HOSTS ?? "")
      .split(",")
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean),
  );

  return {
    mode: rawMode,
    allowedHosts,
    limits: {
      maxSocketsPerSession: readPositiveInteger(
        env.PASEO_RELAY_MAX_SOCKETS_PER_SESSION,
        "PASEO_RELAY_MAX_SOCKETS_PER_SESSION",
        DEFAULT_RELAY_LIMITS.maxSocketsPerSession,
      ),
      maxConnectionsPerSession: readPositiveInteger(
        env.PASEO_RELAY_MAX_CONNECTIONS_PER_SESSION,
        "PASEO_RELAY_MAX_CONNECTIONS_PER_SESSION",
        DEFAULT_RELAY_LIMITS.maxConnectionsPerSession,
      ),
      maxClientsPerConnection: readPositiveInteger(
        env.PASEO_RELAY_MAX_CLIENTS_PER_CONNECTION,
        "PASEO_RELAY_MAX_CLIENTS_PER_CONNECTION",
        DEFAULT_RELAY_LIMITS.maxClientsPerConnection,
      ),
      maxPendingFramesPerConnection: readPositiveInteger(
        env.PASEO_RELAY_MAX_PENDING_FRAMES,
        "PASEO_RELAY_MAX_PENDING_FRAMES",
        DEFAULT_RELAY_LIMITS.maxPendingFramesPerConnection,
      ),
      maxPendingBytesPerConnection: readPositiveInteger(
        env.PASEO_RELAY_MAX_PENDING_BYTES,
        "PASEO_RELAY_MAX_PENDING_BYTES",
        DEFAULT_RELAY_LIMITS.maxPendingBytesPerConnection,
      ),
      maxPendingBytesPerSession: readPositiveInteger(
        env.PASEO_RELAY_MAX_PENDING_BYTES_PER_SESSION,
        "PASEO_RELAY_MAX_PENDING_BYTES_PER_SESSION",
        DEFAULT_RELAY_LIMITS.maxPendingBytesPerSession,
      ),
      pendingAttachTimeoutMs: readPositiveInteger(
        env.PASEO_RELAY_PENDING_ATTACH_TIMEOUT_MS,
        "PASEO_RELAY_PENDING_ATTACH_TIMEOUT_MS",
        DEFAULT_RELAY_LIMITS.pendingAttachTimeoutMs,
      ),
      rateWindowMs: readPositiveInteger(
        env.PASEO_RELAY_RATE_WINDOW_MS,
        "PASEO_RELAY_RATE_WINDOW_MS",
        DEFAULT_RELAY_LIMITS.rateWindowMs,
      ),
      maxFramesPerWindow: readPositiveInteger(
        env.PASEO_RELAY_MAX_FRAMES_PER_WINDOW,
        "PASEO_RELAY_MAX_FRAMES_PER_WINDOW",
        DEFAULT_RELAY_LIMITS.maxFramesPerWindow,
      ),
      maxBytesPerWindow: readPositiveInteger(
        env.PASEO_RELAY_MAX_BYTES_PER_WINDOW,
        "PASEO_RELAY_MAX_BYTES_PER_WINDOW",
        DEFAULT_RELAY_LIMITS.maxBytesPerWindow,
      ),
    },
  };
}

export function isRelayPolicyReady(policy: RelayPolicy, requestHost?: string): boolean {
  if (policy.mode === "disabled" || policy.allowedHosts.size === 0 || !requestHost) return false;
  const host = normalizeHost(requestHost);
  if (policy.mode === "local" && !isLoopbackHost(host)) return false;
  return policy.allowedHosts.has(host);
}

export function validateRouteKey(value: string):
  | { ok: true }
  | {
      ok: false;
      reason: "route_key_empty" | "route_key_too_large";
    } {
  const bytes = new TextEncoder().encode(value.trim()).byteLength;
  if (bytes === 0) return { ok: false, reason: "route_key_empty" };
  if (bytes > MAX_ROUTE_KEY_BYTES) return { ok: false, reason: "route_key_too_large" };
  return { ok: true };
}

export function inspectIncomingFrame(input: IncomingFrameInput): IncomingFrameResult {
  const bytes = frameByteLength(input.message);
  if (input.control) {
    if (bytes > MAX_CONTROL_PAYLOAD_BYTES) {
      return { ok: false, closeCode: 1009, reason: "control_frame_too_large" };
    }
    if (!isSupportedControlMessage(input.message)) {
      return { ok: false, closeCode: 1008, reason: "unsupported_control_message" };
    }
    return { ok: true, bytes, handshake: null };
  }

  if (bytes > MAX_CLIENT_FRAME_PAYLOAD_BYTES) {
    return { ok: false, closeCode: 1009, reason: "frame_too_large" };
  }

  if (input.role !== "client") {
    return { ok: true, bytes, handshake: null };
  }

  const handshake = inspectHandshake(input.message, bytes);
  if (handshake === "invalid_key") {
    return { ok: false, closeCode: 1008, reason: "invalid_handshake_key" };
  }
  if (handshake === "invalid_handshake") {
    return { ok: false, closeCode: 1008, reason: "invalid_handshake" };
  }
  if (handshake === "unsupported_plaintext") {
    return { ok: false, closeCode: 1008, reason: "unsupported_plaintext_frame" };
  }
  return { ok: true, bytes, handshake };
}

export function consumeRateBudget(input: ConsumeRateBudgetInput): ConsumeRateBudgetResult {
  const previous =
    input.previous && input.now - input.previous.startedAt < input.limits.rateWindowMs
      ? input.previous
      : undefined;
  const state: RateBudgetState = previous
    ? {
        startedAt: previous.startedAt,
        frames: previous.frames + 1,
        bytes: previous.bytes + input.bytes,
      }
    : { startedAt: input.now, frames: 1, bytes: input.bytes };

  if (state.frames > input.limits.maxFramesPerWindow) {
    return { ok: false, reason: "frame_rate_exceeded", state: previous ?? state };
  }
  if (state.bytes > input.limits.maxBytesPerWindow) {
    return { ok: false, reason: "byte_rate_exceeded", state: previous ?? state };
  }
  return { ok: true, state };
}

function isLoopbackHost(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
}

function normalizeHost(host: string): string {
  const value = host.trim().toLowerCase();
  if (value.startsWith("[")) {
    const end = value.indexOf("]");
    return end >= 0 ? value.slice(0, end + 1) : value;
  }
  return value.split(":", 1)[0] ?? value;
}

function readPositiveInteger(raw: string | undefined, name: string, fallback: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function frameByteLength(message: string | ArrayBuffer): number {
  return typeof message === "string"
    ? new TextEncoder().encode(message).byteLength
    : message.byteLength;
}

function isSupportedControlMessage(message: string | ArrayBuffer): boolean {
  try {
    const text = decodeFrameText(message);
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) && parsed.type === "ping";
  } catch {
    return false;
  }
}

function isHandshakeCapabilities(value: unknown): boolean {
  return (
    value === undefined ||
    (isRecord(value) &&
      (value.binaryCiphertext === undefined || typeof value.binaryCiphertext === "boolean"))
  );
}

function inspectHandshake(
  message: string | ArrayBuffer,
  bytes: number,
): "hello" | "e2ee_hello" | null | "invalid_key" | "invalid_handshake" | "unsupported_plaintext" {
  let text: string;
  try {
    text = decodeFrameText(message);
  } catch {
    return null;
  }
  if (!text.trimStart().startsWith("{")) return null;
  if (bytes > MAX_HANDSHAKE_INSPECTION_BYTES) return inspectLargeHandshakePrefix(text);

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return "unsupported_plaintext";
  }
  if (!isRecord(parsed) || (parsed.type !== "hello" && parsed.type !== "e2ee_hello")) {
    return "unsupported_plaintext";
  }
  if (!isHandshakeCapabilities(parsed.capabilities)) return "invalid_handshake";
  return isCanonicalX25519PublicKey(parsed.key) ? parsed.type : "invalid_key";
}

function inspectLargeHandshakePrefix(
  text: string,
): "hello" | "e2ee_hello" | null | "invalid_key" | "invalid_handshake" | "unsupported_plaintext" {
  const prefix = text.slice(0, MAX_HANDSHAKE_INSPECTION_BYTES);
  const typeMatch = prefix.match(/"type"\s*:\s*"(hello|e2ee_hello)"/u);
  if (!typeMatch) return "unsupported_plaintext";
  const type = typeMatch[1] as "hello" | "e2ee_hello";
  const keyMatch = prefix.match(/"key"\s*:\s*"([A-Za-z0-9+/]{43}=)"/u);
  return keyMatch && isCanonicalX25519PublicKey(keyMatch[1]) ? type : "invalid_key";
}

function isCanonicalX25519PublicKey(value: unknown): boolean {
  if (typeof value !== "string" || value.length !== 44) return false;
  let bytes: Uint8Array;
  try {
    const binary = atob(value);
    bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return false;
  }
  if (bytes.byteLength !== 32 || toCanonicalBase64(bytes) !== value) return false;
  if (!isLessThanLittleEndian(bytes, X25519_FIELD_PRIME_LE)) return false;
  return !UNSUPPORTED_X25519_PUBLIC_KEYS.has(toHex(bytes));
}

function toCanonicalBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function isLessThanLittleEndian(value: Uint8Array, limit: Uint8Array): boolean {
  for (let index = value.length - 1; index >= 0; index -= 1) {
    if (value[index] < limit[index]) return true;
    if (value[index] > limit[index]) return false;
  }
  return false;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

function decodeFrameText(message: string | ArrayBuffer): string {
  return typeof message === "string"
    ? message
    : new TextDecoder("utf-8", { fatal: true }).decode(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
