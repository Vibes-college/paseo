# VIBES embedding authority

VIBES embeds one complete Paseo application root. The accepted source line starts at official Paseo `v0.7.0-beta.1` commit `1860a6f3afdf7710a7e86677dd183dc7eb9b8a0d` and reaches the physical-iPhone-accepted Stage 5 implementation at tag `vibes-stage5-accepted` / commit `c9aee4df728001975f3ce05df15f64d1b8db3dbe`.

Use this standalone repository for all later VIBES Paseo work. Keep the remotes distinct:

- `origin` is the VIBES-owned repository and may receive reviewed pushes.
- `upstream` is `https://github.com/getpaseo/paseo.git`; fetch from it, never push to it.

The milestone branches are audit anchors:

| Stage                      | Branch                               | Commit     |
| -------------------------- | ------------------------------------ | ---------- |
| Complete application root  | `feature/vibes-complete-root-stage1` | `a9f3e1a2` |
| Desktop Compact            | `feature/vibes-complete-root-stage2` | `d4f8d793` |
| Retention and FAB          | `feature/vibes-complete-root-stage3` | `8d4016fb` |
| VIBES module boundary      | `feature/vibes-complete-root-stage4` | `de6971f8` |
| Physical iPhone acceptance | `feature/vibes-complete-root-stage5` | `c9aee4df` |

VIBES owns FAB and Compact chrome, placement, VIBES route/history/inert/focus behavior, module admission, and logout coordination. Paseo owns its React root, Router, providers, Host discovery, credentials, Workspace, Agent, Session, Run, Timeline, Composer, Tool, Permission, Terminal, Explorer, stores, overlays, connections, and recovery. The boundary accepts only container, surface/activity, shell slots, and opaque callbacks.

Do not restore the retired selected-surface Standalone root, `b926` Compact artifact, VIBES Runtime/Agent mirrors, iframe, profile endpoint, fallback, or compatibility adapter. Git history and the VIBES product handoff retain those decisions as historical evidence.

Stage 6 reruns the final real-daemon and Luna-only matrix from the Stage 5 accepted line. Stage 7 builds the new reproducible artifact, provenance, license/notices, admission, CSP, and same-origin production loader. Neither stage authorizes a Production deployment.
