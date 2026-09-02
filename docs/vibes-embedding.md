# VIBES embedding authority

VIBES embeds one complete Paseo application root. The accepted source line starts at official Paseo `v0.7.0-beta.1` commit `1860a6f3afdf7710a7e86677dd183dc7eb9b8a0d` and reaches the physical-iPhone-accepted Stage 5 implementation at tag `vibes-stage5-accepted` / commit `c9aee4df728001975f3ce05df15f64d1b8db3dbe`.

Use this standalone repository for all later VIBES Paseo work. Keep the remotes distinct:

- `origin` is the VIBES-owned repository and may receive reviewed pushes.
- `upstream` is `https://github.com/getpaseo/paseo.git`; fetch from it, never push to it.

The milestone branches are audit anchors:

| Stage                        | Branch                                     | Commit     |
| ---------------------------- | ------------------------------------------ | ---------- |
| Complete application root    | `feature/vibes-complete-root-stage1`       | `a9f3e1a2` |
| Desktop Compact              | `feature/vibes-complete-root-stage2`       | `d4f8d793` |
| Retention and FAB            | `feature/vibes-complete-root-stage3`       | `8d4016fb` |
| VIBES module boundary        | `feature/vibes-complete-root-stage4`       | `de6971f8` |
| Physical iPhone acceptance   | `feature/vibes-complete-root-stage5`       | `c9aee4df` |
| Final daemon/Luna matrix     | `feature/vibes-complete-root-stage6`       | `1f02f72b` |
| Reproducible Artifact source | `feature/vibes-complete-root-stage7-build` | `30d60666` |

VIBES owns FAB and Compact chrome, placement, VIBES route/history/inert/focus behavior, module admission, Public Page Context resolution, and logout coordination. Paseo owns its React root, Router, providers, Host discovery, credentials, Workspace, Agent, Session, Run, Timeline, Composer, Tool, Permission, Terminal, Explorer, stores, overlays, connections, and recovery. The boundary accepts only the container, surface/activity, an opaque Launcher source carrying an unsent draft plus bounded public page data, shell slots, and opaque callbacks. Paseo resolves the active Composer, renders/removes the context chip, and serializes retained context as explicitly untrusted text without exposing Runtime identities to VIBES.

Do not restore the retired selected-surface Standalone root, `b926` Compact artifact, VIBES Runtime/Agent mirrors, iframe, profile endpoint, fallback, or compatibility adapter. Git history and the VIBES product handoff retain those decisions as historical evidence.

Stage 6 completed the final real-daemon and Luna-only matrix from the Stage 5 accepted line. The fresh standalone build found that `scripts/postinstall-patches.mjs` did not install the existing Expo Router no-linking patch, so commit `54d2e839` added the patch to every clean install and a targeted regression test. VIBES commit `7c2f9ff` restored the Host history methods and outer URL after module import. The 16/16 ego-browser matrix covered real Codex `GPT-5.6-Luna`, Tool, Terminal, Permission, Stop, reconnect, Compact/Full/FAB, routes, product regressions, and logout/remount. Tag `vibes-stage6-accepted` is the Stage 7 source anchor.

Stage 7 source tag `vibes-stage7-accepted` / `30d60666` produces 39 byte-identical files from two clean builds at `/vendor/paseo/complete-root-v1`. VIBES product commit `819494b` admits Artifact digest `9fa1a0d4` with a canonical manifest, SRI, source/build receipts, Apache notices, a served-file allowlist, and a same-origin fail-closed loader. Cloudflare build/dry-run and an admitted-byte Luna smoke passed without deployment.

VIBES uses the hosted official Relay at `relay.paseo.sh:443`; its trust boundary and completed E2EE/Luna/cellular-phone admission live in [vibes-official-relay.md](vibes-official-relay.md). The Cloudflare Durable Object PoC is not part of the maintained source or Production route. Page-aware source tag `vibes-page-aware-accepted` / `73c172b1` produced Artifact digest `d1305889`, which VIBES released at exact main `d5bb8b68`; neither that release nor Relay admission authorizes later deployments.

The Page-aware successor closes the executable browser Markdown resource-exhaustion path without relying on the nested legacy parser. The app uses `markdown-it@14.3.1` with `linkify-it@5.0.2`, bounds each render to 64 KiB and 512 top-level nodes, disables raw HTML and smartquotes, and injects that parser into every direct `react-native-markdown-display` entrypoint. Automatic linkification remains available through the bounded patched parser. The nested legacy parser remains visible to package metadata but is never selected; a source coverage test fails if any renderer returns to the library default.

Browser Web QR scanning reuses the native Pairing Offer parser and E2EE handshake without adding a Relay protocol. Its decoder is a pinned local dependency; camera frames stay in browser memory, and Runtime code must not fetch a decoder from a CDN. Tag `vibes-web-qr-accepted` names the source line after Browser camera, clean-install, CSP, Artifact, and physical-phone gates pass.
