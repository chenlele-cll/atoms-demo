# Frontend guide

Applies to `frontend/` and supplements the [repository map](../AGENTS.md). Repository boundaries and user authorization still apply. Source-map paths below are relative to `frontend/`; commands run from the repository root.

## Choose the relevant guidance

| Change | Read |
| --- | --- |
| Components, layout, CSS, or visible interaction | [DESIGN.md](../DESIGN.md), then the existing [atoms-frontend-design skill](../.agents/skills/atoms-frontend-design/SKILL.md) |
| HTTP client or response-driven state | [HTTP and runtime validation](../docs/engineering/development.md#http-and-runtime-validation); inspect the matching API contract |
| Vite proxy, environment, or startup | [Lifecycle](../docs/engineering/lifecycle.md) and the current Vite configuration |
| Dependencies or shared code | [Monorepo contract](../docs/architecture/monorepo.md) |
| Checks and handoff | [Verification](../docs/engineering/verification.md) |
| Interactive browser inspection | Repository [Playwright skill](../.agents/skills/playwright/SKILL.md), then [project invocation](../docs/engineering/skills.md#browser-verification) |

An HTTP-client-only change does not require loading the UI design contract unless it also changes visible behavior or presentation. For a shared API contract change, also read the [backend guide](../backend/AGENTS.md).

## Source map and local boundaries

- `src/main.tsx` initializes the browser application. `src/App.tsx` routes `/` to creation and `/projects/:projectId` to the workspace; template/candidate routes remain direct entries. `src/diagnostics/` preserves connection-check UI at `/diagnostics/connection`.
- `src/templates/` loads the public template bundle through the neutral `templates/bundle.mjs` contract; `src/template-baseline/` owns host UI and actual Sandpack compile/error/retry states. Do not import template React components into the host tree.
- `src/api/` contains HTTP clients and response parsing. Reuse the boundary pattern in `src/api/health.ts` for timeouts, HTTP failures, and unknown response data.
- `src/preview/` owns the shared snapshot iframe and per-attempt state machine. `src/candidate-review/` reads shared contracts over HTTP and keeps adoption confirmation separate from local compilation. `test/` uses Node/tsx for pure state and client boundaries.
- `src/workspace/controller.ts` owns active requests across React subscription replay and internal views; real route changes abort the old activation. `pending.ts` stores bounded request envelopes only, while drafts/read positions/loaded messages stay in memory per project. `api/generation-stream.ts` consumes bounded POST SSE without automatic POST replay. Workspace adoption reuses `candidate-review/useCandidateReview.ts`.
- Component styles use CSS Modules; `src/styles.css` contains global foundations. Keep detailed tokens and interaction rules in the design contract. Update that contract when introducing tokens or patterns; keep `DESIGN.md` as navigation.
- Browser source uses browser APIs and relative `/api` paths for platform requests. It must not import backend source, database code, Node-only APIs, or server secrets.
- Backend unavailability must leave the frontend usable and show an honest failure state. Loading, success, error, and retry controls must reflect the actual request outcome.
- Add product controls alongside working features. Do not display simulated agent progress or describe generated output as verified without evidence.
- `vite.config.ts` owns development and local preview proxy behavior. A proxy setting does not configure production routing; frontend environment values are public.

## Available commands

```sh
pnpm dev:frontend
pnpm --filter @atoms/frontend typecheck
pnpm --filter @atoms/frontend test
pnpm --filter @atoms/frontend build
```

The dev/build scripts prepare the fixed template asset before Vite. Root `pnpm test:template` checks preparation and bundle boundaries; `pnpm smoke:template` requires a prior build and exercises actual preview/browser behavior. These scoped commands help local development and diagnosis. Final checks follow the central verification guide; UI changes need running-browser checks at narrow widths and in error states. The frontend test script uses pinned tsx with Node tests for preview/adoption state and HTTP boundaries; these do not replace actual browser compilation and interaction.

When frontend commands or configuration change, update the owning configuration, environment template where applicable, and README; do not duplicate their details here.
