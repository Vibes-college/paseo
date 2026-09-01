# VIBES official Relay admission

VIBES uses Paseo's hosted Relay at `relay.paseo.sh:443` for the formal remote-access route. The Cloudflare Durable Object adapter remains outside the maintained source and Production topology.

## Authority

Paseo's protocol and daemon default to `relay.paseo.sh:443`. The official Relay source reference is:

- repository: `https://github.com/getpaseo/paseo-relay.git`;
- commit: `3fc41c96c8c63f3a7109e832899cc57d473c4531`;
- tree: `b9d008468867246e9baef11a469f48c2547c09b9`;
- license: Apache-2.0.

This source pin is not proof that the hosted endpoint runs those exact bytes. Production admission remains blocked until the service operator confirms the deployed version or supplies an equivalent immutable identity, plus current terms, privacy/log retention, rate limits, and availability expectations.

## Trust boundary

The daemon connects outbound. The browser or mobile client joins with a pairing offer and negotiates Paseo E2EE. The Relay forwards encrypted frames and does not receive VIBES Cookies, tokens, D1 bindings, Public Page Context, Agent plaintext, Tool data, or pairing private keys.

The hosted service can observe IP addresses, route identifiers, public handshake metadata, timing, and frame sizes. Pairing links are credentials and must not enter logs, analytics, VIBES URLs, or evidence.

Direct connection remains available. Relay failure must fail closed and must not restore the retired VIBES Agent, Sitewide Chatbot, another Relay implementation, or plaintext transport.

## Admission gates

Before enabling remote Production:

1. confirm hosted endpoint ownership, deployed identity, terms, retention, limits, and incident contact;
2. prove pairing link and QR flows with an isolated daemon and account;
3. prove wrong-key/replay rejection, daemon outbound-only transport, reconnect, network replacement, multiple clients, and revocation;
4. scan client, daemon, Relay-facing, and platform logs for pairing material, keys, route identifiers, and plaintext canaries;
5. allow only the admitted hosted endpoint in the Paseo connection/pairing policy without widening VIBES CSP;
6. complete real remote Web and physical-phone journeys outside the daemon's LAN;
7. record exact source, Artifact digest, endpoint, evidence, rollback, and Release ownership.

No local test, source pin, or Artifact build authorizes Production by itself.
