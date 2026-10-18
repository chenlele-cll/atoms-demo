# Repository map

This file applies to the whole repository. Before editing an application, also read its scoped guide: [frontend/AGENTS.md](frontend/AGENTS.md) or [backend/AGENTS.md](backend/AGENTS.md). Read both for a shared HTTP contract change.

## Project

Atoms Demo has an independently runnable React + Vite frontend and Fastify + Node.js backend. Both use TypeScript; the frontend uses CSS Modules. The current application is a connection-check skeleton; generation, persistence, and generated-app preview are not implemented yet. Manager start/stop/restart/status, native Process Compose development configuration, and OpenSpec are available; use the lifecycle guide for prerequisites and process commands.

Use [README.md](README.md) for project scope, current setup, and production startup. Use [docs/README.md](docs/README.md) to find documentation by responsibility.

## Start a task

- Identify the task ID, requested outcome, scope, and acceptance criteria from the request and existing task context.
- Inspect `git status --short --branch` and relevant diffs. Preserve other tasks' pending changes; do not stash, reset, clean, or move them between branches automatically.
- Choose the relevant route below, then read only the sections and source files needed for this task. Do not preload every document for a small edit.
- For OpenSpec work, use the corresponding change as task context and follow [OpenSpec workflow](docs/engineering/openspec.md). Run CLI examples through `pnpm openspec` from the repository root; do not use a potentially different global version or invent a parallel tracker.

## Task routing

| Task | Read first |
| --- | --- |
| Frontend UI, browser state, or HTTP client | [Frontend guide](frontend/AGENTS.md) |
| Backend route, configuration, generation, or storage | [Backend guide](backend/AGENTS.md) |
| HTTP contract affecting both applications | Both scoped guides, then [runtime validation](docs/engineering/development.md#http-and-runtime-validation) |
| Workspace, dependencies, or shared code | [Monorepo contract](docs/architecture/monorepo.md); use [stack decisions](docs/architecture/stack-decisions.md) when reconsidering a technology choice |
| Documentation or navigation | [Documentation index](docs/README.md) and the document that owns the rule |
| OpenSpec planning, change artifacts, or task tracking | [OpenSpec workflow](docs/engineering/openspec.md) and the selected change |
| Startup, shutdown, process scripts, or infrastructure | [Lifecycle](docs/engineering/lifecycle.md) |
| A failing check or unexpected behavior | The affected application's guide and [Verification](docs/engineering/verification.md); reproduce the reported failure before claiming a fix |
| Skills installation or update | [Skill sources and usage](docs/engineering/skills.md) |
| Branch, commit, push, merge, or PR | [Git workflow](docs/engineering/git-workflow.md) and the skill routing below |
| Selecting checks or preparing handoff | [Verification](docs/engineering/verification.md) |

Implementation rules live in [Development conventions](docs/engineering/development.md). UI rules are reached through [DESIGN.md](DESIGN.md) and the existing design skill; update the owning contract when rules change rather than copying them into this map.

## Skill routing

- For interactive browser verification, read the repository [Playwright skill](.agents/skills/playwright/SKILL.md) directly, then use the project entry and artifact paths in [skills.md](docs/engineering/skills.md#browser-verification). Keep `pnpm smoke` as the existing regression check; do not add a test framework just to use this skill.
- Before following an OpenSpec workflow, read its repository file directly: `.agents/skills/openspec-<workflow>/SKILL.md` for Codex or `.opencode/skills/openspec-<workflow>/SKILL.md` for OpenCode, using the exact names in the OpenSpec guide. Same-named global skills may differ. Preserve the selected repository workflow's planning and implementation boundaries.
- For an authorized commit, load [git-commit](.agents/skills/git-commit/SKILL.md). Before staging, group changes by concrete purpose and follow the [commit granularity and message rules](docs/engineering/git-workflow.md#changes-and-commits); each message must identify the specific changes rather than only a broad feature.
- A request to commit includes pushing the completed commits to the confirmed remote branch by default. Follow the [push procedure](docs/engineering/git-workflow.md#push-procedure) without asking again, unless the user explicitly requests local-only commits or no push. This does not authorize PR creation, merging, deployment, or publishing.
- Use [yeet](.agents/skills/yeet/SKILL.md) only when the user explicitly requests the full stage/commit/push/PR flow.
- For a push-only request, follow the [push procedure](docs/engineering/git-workflow.md#push-procedure), preserving uncommitted work and creating no new commit or PR.
- Repository task scope, naming, validation, authentication, and authorization rules apply to upstream skills. Keep upstream files unchanged; their fixed revisions and licenses are recorded in [skills.md](docs/engineering/skills.md).

## Reliable commands

Run from the repository root, with Node from `.nvmrc` and pnpm from the root package.json:

```sh
pnpm install --frozen-lockfile
pnpm dev:frontend
pnpm dev:backend
pnpm check
pnpm build
pnpm smoke
pnpm openspec list --json
```

The independent development commands use separate terminals; [manager.sh](manager.sh) provides start/stop/restart/status after the [lifecycle prerequisites](docs/engineering/lifecycle.md#manager-commands). Do not mix manager and native operations on the same instance. Select verification by change scope using the verification guide. Planned bootstrap/doctor/logs and infrastructure commands must not be presented as available commands.

## Always-on boundaries

- Keep applications separated by HTTP under `/api`; never import backend implementation into the browser or expose backend credentials to previews.
- Keep TypeScript strict and validate untrusted data at runtime. Follow the development guide for parsing, network errors, logging, and future storage or generation work.
- Add dependencies and modules for a concrete current need; do not create empty service directories or speculative abstractions.
- Record actual activity and observed verification results. Never simulate model work or report generation, persistence, preview, or deployment as validated without evidence.
- Original notes at `docs/product/assignment.md`, when locally available, remain private reference material excluded from version control. Do not copy their contents into public documents.
- Do not commit secrets or local tool output. Commit, push, create PRs, merge, or publish only within the user's authorized scope; do not request the same authorization again while it remains valid.
