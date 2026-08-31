import { describe, expect, it } from "vitest";
import { exportPublicKey, generateKeyPair } from "./crypto.js";
import {
  DEFAULT_RELAY_LIMITS,
  MAX_CLIENT_FRAME_PAYLOAD_BYTES,
  MAX_CONTROL_PAYLOAD_BYTES,
  consumeRateBudget,
  inspectIncomingFrame,
  isRelayPolicyReady,
  parseRelayPolicy,
  validateRouteKey,
} from "./cloudflare-policy.js";

describe("Cloudflare Relay route policy", () => {
  it("accepts 256 UTF-8 bytes and rejects one byte more", () => {
    expect(validateRouteKey("a".repeat(256))).toEqual({ ok: true });
    expect(validateRouteKey("a".repeat(257))).toEqual({
      ok: false,
      reason: "route_key_too_large",
    });
    expect(validateRouteKey("界".repeat(85))).toEqual({ ok: true });
    expect(validateRouteKey("界".repeat(86))).toEqual({
      ok: false,
      reason: "route_key_too_large",
    });
  });

  it("keeps the checked-in PoC disabled and rejects invalid numeric limits", () => {
    const disabled = parseRelayPolicy({});
    expect(disabled.mode).toBe("disabled");
    expect(disabled.limits).toEqual(DEFAULT_RELAY_LIMITS);

    expect(() =>
      parseRelayPolicy({
        PASEO_RELAY_MAX_SOCKETS_PER_SESSION: "0",
      }),
    ).toThrow("PASEO_RELAY_MAX_SOCKETS_PER_SESSION");
  });

  it("permits local mode only on loopback hosts", () => {
    const policy = parseRelayPolicy({
      PASEO_RELAY_POC_MODE: "local",
      PASEO_RELAY_ALLOWED_HOSTS: "127.0.0.1,relay-public.test",
    });

    expect(isRelayPolicyReady(policy, "127.0.0.1:8788")).toBe(true);
    expect(isRelayPolicyReady(policy, "relay-public.test")).toBe(false);
  });
});

describe("Cloudflare Relay frame policy", () => {
  it("accepts canonical E2EE hello keys without retaining the key", () => {
    const key = exportPublicKey(generateKeyPair().publicKey);
    const frame = JSON.stringify({
      type: "e2ee_hello",
      key,
      capabilities: { binaryCiphertext: true },
    });

    expect(inspectIncomingFrame({ role: "client", control: false, message: frame })).toEqual({
      ok: true,
      bytes: new TextEncoder().encode(frame).byteLength,
      handshake: "e2ee_hello",
    });
  });

  it("rejects malformed and unsupported X25519 handshake keys", () => {
    const zeroKey = Buffer.alloc(32).toString("base64");
    const frame = JSON.stringify({ type: "e2ee_hello", key: zeroKey });

    expect(inspectIncomingFrame({ role: "client", control: false, message: frame })).toEqual({
      ok: false,
      closeCode: 1008,
      reason: "invalid_handshake_key",
    });
  });

  it("accepts a valid handshake with extension fields beyond the inspection prefix", () => {
    const key = exportPublicKey(generateKeyPair().publicKey);
    const frame = JSON.stringify({ type: "e2ee_hello", key, padding: "x".repeat(5_000) });

    expect(inspectIncomingFrame({ role: "client", control: false, message: frame })).toEqual({
      ok: true,
      bytes: new TextEncoder().encode(frame).byteLength,
      handshake: "e2ee_hello",
    });
  });

  it("rejects malformed handshake capabilities and unrelated plaintext JSON", () => {
    const key = exportPublicKey(generateKeyPair().publicKey);
    expect(
      inspectIncomingFrame({
        role: "client",
        control: false,
        message: JSON.stringify({
          type: "e2ee_hello",
          key,
          capabilities: { binaryCiphertext: "yes" },
        }),
      }),
    ).toEqual({ ok: false, closeCode: 1008, reason: "invalid_handshake" });

    expect(
      inspectIncomingFrame({
        role: "client",
        control: false,
        message: JSON.stringify({ type: "application", padding: "x".repeat(5_000) }),
      }),
    ).toEqual({ ok: false, closeCode: 1008, reason: "unsupported_plaintext_frame" });
    expect(
      inspectIncomingFrame({
        role: "client",
        control: false,
        message: '{"type":"e2ee_hello"',
      }),
    ).toEqual({ ok: false, closeCode: 1008, reason: "unsupported_plaintext_frame" });
  });

  it("applies separate data and control ceilings", () => {
    expect(
      inspectIncomingFrame({
        role: "client",
        control: false,
        message: new ArrayBuffer(MAX_CLIENT_FRAME_PAYLOAD_BYTES + 1),
      }),
    ).toEqual({ ok: false, closeCode: 1009, reason: "frame_too_large" });

    expect(
      inspectIncomingFrame({
        role: "server",
        control: true,
        message: "x".repeat(MAX_CONTROL_PAYLOAD_BYTES + 1),
      }),
    ).toEqual({ ok: false, closeCode: 1009, reason: "control_frame_too_large" });
  });

  it("rejects unsupported plaintext control messages", () => {
    expect(
      inspectIncomingFrame({
        role: "server",
        control: true,
        message: JSON.stringify({ type: "unexpected", payload: "secret" }),
      }),
    ).toEqual({ ok: false, closeCode: 1008, reason: "unsupported_control_message" });
  });
});

describe("Cloudflare Relay attachment rate budget", () => {
  it("persists a fixed-window frame and byte budget without route identifiers", () => {
    const first = consumeRateBudget({
      now: 1_000,
      bytes: 40,
      previous: undefined,
      limits: {
        ...DEFAULT_RELAY_LIMITS,
        rateWindowMs: 1_000,
        maxFramesPerWindow: 2,
        maxBytesPerWindow: 100,
      },
    });
    expect(first).toEqual({
      ok: true,
      state: { startedAt: 1_000, frames: 1, bytes: 40 },
    });

    const second = consumeRateBudget({
      now: 1_100,
      bytes: 60,
      previous: first.state,
      limits: {
        ...DEFAULT_RELAY_LIMITS,
        rateWindowMs: 1_000,
        maxFramesPerWindow: 2,
        maxBytesPerWindow: 100,
      },
    });
    expect(second.ok).toBe(true);

    expect(
      consumeRateBudget({
        now: 1_200,
        bytes: 1,
        previous: second.state,
        limits: {
          ...DEFAULT_RELAY_LIMITS,
          rateWindowMs: 1_000,
          maxFramesPerWindow: 2,
          maxBytesPerWindow: 100,
        },
      }),
    ).toEqual({
      ok: false,
      reason: "frame_rate_exceeded",
      state: { startedAt: 1_000, frames: 2, bytes: 100 },
    });
  });
});
