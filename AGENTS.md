# Development Contract

## Scope And Architecture

- Read `README.md` for project scope and `docs/技术栈调研与初始化建议.md` for decisions.
- Original assignment notes in `docs/笔试背景与要求.md`, when available locally, are private reference material excluded from version control. Do not copy their contents into public documentation.
- Frontend: React, Vite, TypeScript, CSS Modules. Backend: Fastify, Node.js, TypeScript.
- Keep frontend and backend independently runnable. Use HTTP under `/api`; never import backend implementations into the frontend.
- Use pnpm workspaces and one lockfile. Do not add a framework, service, shared package, or dependency without a concrete current need.
- The skeleton has no generation, database, or preview implementation. Add their dependencies with the corresponding behavior.

## Layout

- `frontend/src/`: browser entry, UI components, and HTTP client code.
- `backend/src/app.ts`: application construction and route registration without listening.
- `backend/src/server.ts`: environment loading, listening, and process lifecycle.
- `backend/src/routes/`: HTTP endpoints. Keep generation and storage logic out of route handlers as those responsibilities grow.
- `backend/test/`: behavior tests using Node's test runner and Fastify injection.
- `docs/`: assignment background and stack research documents.
- `scripts/`: repository-level developer scripts, currently the browser smoke test.
- No empty service/repository directories or speculative abstractions. Add folders with their first implementation.

## Commands

Use Node from `.nvmrc` and the pnpm version in `package.json`.

```sh
pnpm install --frozen-lockfile
pnpm dev:frontend
pnpm dev:backend
pnpm check
pnpm build
pnpm smoke
```

Run frontend and backend in separate terminals. `pnpm check` runs lint, types, and backend tests. `pnpm build` verifies both production builds. `pnpm smoke` builds then drives a real browser through startup, proxy, responsive, and failure paths; it needs a locally installed Google Chrome. See README for production startup and proxy behavior.

## Implementation Rules

- Keep TypeScript strict. Use `unknown` at untrusted boundaries and narrow or parse it. No `any`, non-null assertions, or type-check suppression to conceal errors.
- Use platform APIs when sufficient. Configure network timeouts and handle HTTP errors explicitly.
- Validate API input and model output at the boundary; TypeScript types alone do not validate runtime data.
- Use Fastify's logger with structured fields; pass errors as `{ err }`. Do not log prompts, generated files, credentials, or session tokens by default.
- Keep secrets in backend configuration. Frontend environment variables and preview files are public.
- Use SQLite parameter binding and short transactions when persistence is added. Keep model calls outside write transactions.
- Generated code must not execute inside the backend process or receive backend credentials.
- Record actual task activity. Never simulate model work or report generated code as validated without evidence.
- Read `DESIGN.md` before UI changes; update the contract when introducing new tokens or patterns.

## Verification And Handoff

- Run `pnpm check` and `pnpm build` after relevant changes.
- Add focused behavior tests for meaningful boundaries and failure handling. Do not test prose or mirror implementation details.
- Verify UI changes in a browser, including narrow screens and error states. Stream cancellation and real network behavior need running-server tests, not only injection.
- Update README and `.env.example` when commands or configuration change.
- State what was verified and what remains unavailable. Do not claim generation, persistence, or deployment works before testing it.
- Do not commit secrets or local tool output. Do not commit or publish without an explicit request.
