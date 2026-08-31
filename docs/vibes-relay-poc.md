# VIBES Relay PoC

This PoC compares the official Elixir Relay with a modern Cloudflare Durable Object adapter. It does not select a Production route and must not deploy to `relay.paseo.sh` or a VIBES Production domain.

## Authority

| Authority                                       | Pinned value                                                         |
| ----------------------------------------------- | -------------------------------------------------------------------- |
| Paseo client, daemon, protocol, and E2EE source | `vibes-stage7-accepted` / `30d60666938c3873b90f86f4ed84464dd6b33143` |
| VIBES Relay PoC branch point                    | `c03968c392a7e5c525184c1d04c3de1703dc7767`                           |
| Official Relay repository                       | `https://github.com/getpaseo/paseo-relay.git`                        |
| Official Relay commit                           | `3fc41c96c8c63f3a7109e832899cc57d473c4531`                           |
| Official Relay tree                             | `b9d008468867246e9baef11a469f48c2547c09b9`                           |
| Official Relay license                          | Apache-2.0                                                           |

The official Relay has no release tag at this pin. The full commit and tree are the immutable reference. A comparison run must reject another checkout instead of silently using its current `main`.

## Remote-access contract

VIBES remote access keeps the daemon outbound-only. A browser or mobile client and an isolated daemon meet by opaque `serverId`; v2 adds one control socket and a data socket per `connectionId`. The relay forwards frames without becoming a Paseo application endpoint.

The pass contract is:

- route v1 and v2 without changing their public query shape;
- keep `serverId` and `connectionId` at or below 256 UTF-8 bytes;
- preserve E2EE `e2ee_hello` / `e2ee_ready`, optional `binaryCiphertext`, and frame opcode;
- validate canonical 32-byte X25519 public keys without logging key material;
- keep the masked data-frame wire ceiling at 32 MiB and the control-frame ceiling at 64 KiB;
- allow a client to arrive before the daemon, multiple clients on one v2 connection, and reconnect after relay or network replacement;
- preserve hibernated socket identity through serialized attachments and keep pre-daemon buffering bounded; the public hello may live only in the same expiring, byte-limited pending batch;
- expose liveness, readiness, low-cardinality metrics, active-capacity state, activation-scoped rejection counters, and frame-size observations;
- fail closed on route-key abuse, socket capacity, pending-byte capacity, rate limits, invalid handshakes, and unsupported control messages;
- never log frame contents, public keys, `serverId`, `connectionId`, tokens, cookies, or daemon configuration;
- keep the PoC disabled unless an isolated local or Preview mode and an exact host allowlist are configured.

## Threat model

Assets are the daemon secret key, encrypted application traffic, session availability, the user's local coding environment, and the cost ceiling of the relay account.

The relay is untrusted for confidentiality and integrity. It may observe IP addresses, route identifiers, timing, frame sizes, and public handshake messages. E2EE must make payload reads, payload forgery, and cross-session replay fail. Replay within one live E2EE session remains an upstream protocol limitation because the channel does not track message counters.

The adapter must also resist:

| Threat                                               | Gate                                                                                      |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Random `serverId` fan-out that creates unbounded DOs | exact Preview host, edge rate-limit binding, route-key limit, disabled-by-default mode    |
| Too many sockets in one session                      | per-session WebSocket ceiling and retryable rejection                                     |
| Too many clients or connection IDs                   | per-connection and per-session limits                                                     |
| Oversized or fragmented messages                     | 32 MiB wire-compatible data ceiling and 64 KiB control ceiling                            |
| Pre-daemon buffering as storage amplification        | frame-count, byte-count, and attach-time bounds                                           |
| High-rate frames from one socket                     | attachment-backed frame and byte windows                                                  |
| Invalid or low-order X25519 keys                     | canonical key validation and close `1008`                                                 |
| Slow or absent peer                                  | bounded pending data, reconnectable close codes, no unbounded mailbox                     |
| Hibernation or isolate restart                       | serialized socket attachments; no correctness-only timer or in-memory route map           |
| Deployment or network replacement                    | reconnect and fresh E2EE handshake; no transparent migration claim                        |
| Log disclosure                                       | low-cardinality event names and counters only                                             |
| Metrics cardinality or cost leak                     | no route identifiers as metric labels; explicit capacity gauges and Preview cost evidence |

## PoC topology

```text
isolated client fixtures
        │ v1/v2 WebSocket + E2EE
        ▼
┌────────────────────────────┐
│ one isolated relay target  │
│                            │
│ A. pinned official Elixir  │
│ B. local/Preview DO PoC    │
└─────────────┬──────────────┘
              │ outbound daemon transport
              ▼
isolated PASEO_HOME + OS-assigned port
```

Port `6767`, Production Relay DNS, Production secrets, Production D1, and existing user sessions are outside the PoC.

The DO Worker has no custom route, no account id, no upstream proxy, and no enabled deployment mode in its checked-in Wrangler configuration. Local tests set `local` mode and a loopback host explicitly. A future Preview run must use `preview` mode, an exact isolated hostname, and a Cloudflare rate-limit binding.

## Verification matrix

Run the same black-box protocol cases against both targets:

1. `/health`, `/ready`, and Prometheus metrics;
2. v1 server/client forwarding;
3. v2 control, data routing, and v1/v2 isolation;
4. current E2EE handshake, mixed-version `binaryCiphertext`, wrong-key and invalid-key rejection;
5. exact maximum frame and one-byte-over rejection;
6. client-before-daemon attach and bounded pending traffic;
7. multiple clients sharing one `connectionId` without premature daemon-data close;
8. idle sleep/wake traffic;
9. client network replacement and daemon control replacement;
10. relay process/DO restart followed by reconnect and a fresh E2EE handshake;
11. route-key, connection, socket, rate, pending-byte, and unsupported-control rejection;
12. captured-log scan proving that a unique plaintext marker and route identifiers do not appear.

The DO target additionally proves attachment-based rehydration and deterministic capacity/rate/pending gates. Actual cost remains a Preview-only measurement. The official target additionally proves its `/ready`, Capacity ledger, distributed owner, and delivery-pressure contract from the pinned source and its own tests.

## Local result and route decision

The isolated local comparison passed the same 12-case black-box matrix on both targets. It covered operations endpoints, bidirectional v1/v2 isolation, hibernation-compatible client-before-daemon buffering, daemon-control replacement, multiple clients and last-client cleanup, invalid keys, exact 256/257-byte route boundaries, idle wake, network replacement, and exact data/control frame boundaries. Both targets also passed a complete isolated-daemon journey through pairing, E2EE, `server_info`, directory fetch, and ping. Fresh matrices passed after Wrangler and official container restarts. Captured application logs contained none of the route, handshake, or plaintext canaries.

Keep the official Elixir Relay as the formal Production route. Its Writer barrier, Capacity ledger, memory-pressure recovery, distributed ownership, metrics, and operating record have no equivalent Preview evidence in the DO PoC. The DO path remains a promising disabled-by-default PoC. Do not promote it until a real isolated Cloudflare Preview proves eviction, deploy reconnect, edge rate limiting, slow-reader isolation, platform-log redaction, and cost. The PoC updates its direct `ws` resolution to `8.21.3`; the retained workspace-scoped Runtime audit still reports five high transitive/other-workspace findings and remains a closure gate rather than an exception.

The current matrix proves the official current v1 and v2 contracts. Executable mixed-version testing against pre-current commit `6dad3212` remains a separate compatibility gate; do not infer it from raw route tests.

The PoC removes raw handshake-frame previews from Relay errors. That changes Relay Runtime bytes. If this branch becomes a release source, rerun the Stage 7 double-clean build, manifest, SRI, license, admission, and affected Stage 6/7 journeys instead of reusing digest `9fa1a0d4`.

## Evidence and decision gate

Local Miniflare/Wrangler can sign protocol routing, E2EE, limits, hibernation-compatible rehydration, process restart, sleep/wake, network replacement, readiness, metrics shape, and log redaction. Docker can sign the same local black-box matrix against the pinned official Relay when the Docker daemon is available.

Only an isolated Cloudflare Preview can sign real edge rate limiting, actual hibernation billing behavior, deploy replacement, Preview hostname isolation, and Cloudflare cost observations. No local result may be relabeled as that evidence.

Keep results under `research-artifacts/vibes-relay-poc/<date>/` with exact source identities, command/exit receipts, redacted log digests, per-case outcomes, cleanup, and a sorted `manifest.sha256`. The formal route decision is official Elixir; Cloudflare promotion remains closed until the Preview-only gates pass. A PoC result never authorizes Production DNS, secrets, migration, or deployment.
