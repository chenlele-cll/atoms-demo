# Repository map

This file applies to the whole repository. Before editing an application, also read its scoped guide: [frontend/AGENTS.md](frontend/AGENTS.md) or [backend/AGENTS.md](backend/AGENTS.md). Read both for a shared HTTP contract change.

## Project

Atoms Demo has an independently runnable React + Vite frontend and Fastify + Node.js backend. Both use TypeScript; the frontend uses CSS Modules. The current application is a connection-check skeleton; generation, persistence, and generated-app preview are not implemented yet. Lifecycle tooling and OpenSpec will be added with their implementation tasks.

Use [README.md](README.md) for project scope, current setup, and production startup. Use [docs/README.md](docs/README.md) to find documentation by responsibility.

## Start a task

- Identify the task ID, requested outcome, scope, and acceptance criteria from the request and existing task context.
- Inspect `git status --short --branch` and relevant diffs. Preserve other tasks' pending changes; do not stash, reset, clean, or move them between branches automatically.
- Choose the relevant route below, then read only the sections and source files needed for this task. Do not preload every document for a small edit.

## Task routing

| Task | Read first |
| --- | --- |
| Frontend UI, browser state, or HTTP client | [Frontend guide](frontend/AGENTS.md) |
| Backend route, configuration, generation, or storage | [Backend guide](backend/AGENTS.md) |
| HTTP contract affecting both applications | Both scoped guides, then [runtime validation](docs/engineering/development.md#http-and-runtime-validation) |
| Workspace, dependencies, or shared code | [Monorepo contract](docs/architecture/monorepo.md); use [stack decisions](docs/architecture/stack-decisions.md) when reconsidering a technology choice |
| Documentation or navigation | [Documentation index](docs/README.md) and the document that owns the rule |
| Startup, shutdown, process scripts, or infrastructure | [Lifecycle](docs/engineering/lifecycle.md) |
| A failing check or unexpected behavior | The affected application's guide and [Verification](docs/engineering/verification.md); reproduce the reported failure before claiming a fix |
| Selecting checks or preparing handoff | [Verification](docs/engineering/verification.md) |

Implementation rules live in [Development conventions](docs/engineering/development.md). UI rules are maintained in [DESIGN.md](DESIGN.md); update the owning contract when rules change rather than copying them into this map.

## Reliable commands

Run from the repository root, with Node from `.nvmrc` and pnpm from the root package.json:

```sh
pnpm install --frozen-lockfile
pnpm dev:frontend
pnpm dev:backend
pnpm check
pnpm build
pnpm smoke
```

The independent development commands use separate terminals. Select verification by change scope using the verification guide. Planned manager and infrastructure commands must not be presented as available commands.

## Always-on boundaries

- Keep applications separated by HTTP under `/api`; never import backend implementation into the browser or expose backend credentials to previews.
- Keep TypeScript strict and validate untrusted data at runtime. Follow the development guide for parsing, network errors, logging, and future storage or generation work.
- Add dependencies and modules for a concrete current need; do not create empty service directories or speculative abstractions.
- Record actual activity and observed verification results. Never simulate model work or report generation, persistence, preview, or deployment as validated without evidence.
- Original notes at `docs/product/assignment.md`, when locally available, remain private reference material excluded from version control. Do not copy their contents into public documents.
- Do not commit secrets or local tool output. Commit, push, create PRs, merge, or publish only within the user's authorized scope; do not request the same authorization again while it remains valid.
