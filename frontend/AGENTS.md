# Frontend guide

Applies to `frontend/` and supplements the [repository map](../AGENTS.md). Repository boundaries and user authorization still apply. Source-map paths below are relative to `frontend/`; commands run from the repository root.

## Choose the relevant guidance

| Change | Read |
| --- | --- |
| Components, layout, CSS, or visible interaction | [DESIGN.md](../DESIGN.md), then the existing [atoms-frontend-design skill](../.opencode/skills/atoms-frontend-design/SKILL.md) |
| HTTP client or response-driven state | [HTTP and runtime validation](../docs/engineering/development.md#http-and-runtime-validation); inspect the matching API contract |
| Vite proxy, environment, or startup | [Lifecycle](../docs/engineering/lifecycle.md) and the current Vite configuration |
| Dependencies or shared code | [Monorepo contract](../docs/architecture/monorepo.md) |
| Checks and handoff | [Verification](../docs/engineering/verification.md) |
| Interactive browser inspection | Repository [Playwright skill](../.agents/skills/playwright/SKILL.md), then [project invocation](../docs/engineering/skills.md#browser-verification) |

An HTTP-client-only change does not require loading the UI design contract unless it also changes visible behavior or presentation. For a shared API contract change, also read the [backend guide](../backend/AGENTS.md).

## Source map and local boundaries

- `src/main.tsx` initializes the browser application. `src/App.tsx` currently composes the connection-check screen.
- `src/api/` contains HTTP clients and response parsing. Reuse the boundary pattern in `src/api/health.ts` for timeouts, HTTP failures, and unknown response data.
- Component styles use CSS Modules; `src/styles.css` contains global foundations. Keep detailed tokens and interaction rules in the design contract. Update that contract when introducing tokens or patterns; keep `DESIGN.md` as navigation.
- Browser source uses browser APIs and relative `/api` paths for platform requests. It must not import backend source, database code, Node-only APIs, or server secrets.
- Backend unavailability must leave the frontend usable and show an honest failure state. Loading, success, error, and retry controls must reflect the actual request outcome.
- Add product controls alongside working features. Do not display simulated agent progress or describe generated output as verified without evidence.
- `vite.config.ts` owns development and local preview proxy behavior. A proxy setting does not configure production routing; frontend environment values are public.

## Available commands

```sh
pnpm dev:frontend
pnpm --filter @atoms/frontend typecheck
pnpm --filter @atoms/frontend build
```

These scoped commands help local development and diagnosis. Final checks follow the central verification guide; UI changes need running-browser checks at narrow widths and in error states. There is currently no frontend unit-test script, and passing backend tests alone does not verify UI behavior.

When frontend commands or configuration change, update the owning configuration, environment template where applicable, and README; do not duplicate their details here.
