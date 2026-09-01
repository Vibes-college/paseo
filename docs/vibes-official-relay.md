# VIBES official Relay admission

VIBES uses Paseo's hosted Relay at `relay.paseo.sh:443` for the formal remote-access route. The Cloudflare Durable Object adapter remains outside the maintained source and Production topology.

## Authority

Paseo's protocol and daemon default to `relay.paseo.sh:443`. The official Relay source reference is:

- repository: `https://github.com/getpaseo/paseo-relay.git`;
- commit: `3fc41c96c8c63f3a7109e832899cc57d473c4531`;
- tree: `b9d008468867246e9baef11a469f48c2547c09b9`;
- license: Apache-2.0.

This source pin is not proof that the hosted endpoint runs those exact bytes. On 2026-09-01 the VIBES product owner confirmed they had asked the official operator, accepted the hosted service for VIBES, and directed that deployed version, retention, numerical limits, and availability responsibility no longer block this admission. Hosted bytes remain operator-managed and are not represented as the pinned source commit.

## Trust boundary

The daemon connects outbound. The browser or mobile client joins with a pairing offer and negotiates Paseo E2EE. The Relay forwards encrypted frames and does not receive VIBES Cookies, tokens, D1 bindings, Public Page Context, Agent plaintext, Tool data, or pairing private keys.

The hosted service can observe IP addresses, route identifiers, public handshake metadata, timing, and frame sizes. Pairing links are credentials and must not enter logs, analytics, VIBES URLs, or evidence.

Direct connection remains available. Relay failure must fail closed and must not restore the retired VIBES Agent, Sitewide Chatbot, another Relay implementation, or plaintext transport.

## Admission result

Admission passed on 2026-09-01 against Page-aware source `vibes-page-aware-accepted` / `73c172b13` and Artifact digest `d1305889`:

- `wss://relay.paseo.sh` carried a bidirectional encrypted-frame test over TLS;
- an isolated daemon and remote client completed a real `gpt-5.6-luna` workflow only through the hosted Relay and returned `RELAY_LUNA_OK: 1591`;
- the admitted VIBES Root generated the QR without changing the VIBES outer URL or logging the offer;
- a physical phone on cellular data paired, created a Luna Agent, survived Relay disconnect/reconnect, and returned `PHONE_RELAY_OK: 437`;
- Direct desktop and Relay phone clients worked concurrently;
- daemon stdout and logs contained zero Pairing URLs, private/secret keys, plaintext canaries, or serialized server identifiers;
- stopping the isolated daemon and destroying its keypair/server identity revoked the test offer.

Paseo PR #2 CI retains wrong-key, tampered-ciphertext, replay/nonce, reconnect, socket-cleanup, pairing-parse, and outbound-config coverage. The VIBES product repository records the full redacted evidence in PR #342; Pairing credentials and full timelines are not retained.

Relay admission does not authorize Production. VIBES still requires the exact Preview pointer retest, merged-main preflight, and a separate same-turn Production authorization.
