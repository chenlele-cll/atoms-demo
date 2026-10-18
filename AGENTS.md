# Repository map

This file applies to the whole repository. Before editing an application, also read its scoped guide: [frontend/AGENTS.md](frontend/AGENTS.md) or [backend/AGENTS.md](backend/AGENTS.md). Read both for a shared HTTP contract change.

## Project

Atoms Demo has an independently runnable React + Vite frontend and Fastify + Node.js backend. Both use TypeScript; the frontend uses CSS Modules. Connection checking, isolated template preview, SQLite project APIs and internal bounded candidate generation are implemented. Model protocol tests use local fixtures; official OpenAI acceptance remains pending. One historical isolated quote acceptance used the separately pending GEN-002 compatible-provider changes; candidates remain preview-unverified. Public generation/stream/query/cancel controls and owned-service recovery are implemented; candidate preview/adoption and the creation/conversation/preview/read-only-code workspace are implemented. Workspace checks use a controlled SDK fixture; final live-model and deployment acceptance remain separate. Manager bootstrap/doctor/start/stop/restart/status/logs/infra, native Process Compose configuration, and OpenSpec are available; infra reports no external infrastructure configured. Use the lifecycle guide for prerequisites and process commands.

Public session/template/project/message/version/snapshot/run/adoption/error and SSE contracts are shared through `@atoms/contracts`. Historical mixed-workspace and isolated GEN-006 evidence remains separate in [GEN-006 tasks](openspec/changes/gen-006-candidate-preview-adoption/tasks.md#isolated-review-evidence). The merge from `d3cfb7a` preserves GEN-007 workspace/contracts and GEN-006 refresh/adoption guards, including the workspace manual-retry guard. Integration frozen install, check (1 contract-preparation, 169 backend and 32 frontend tests, lint/types), smoke including build, and 21 candidate cases passed; frontend build/lint and all 26 workspace scenarios passed after the final button guard. See [Integration evidence](openspec/changes/gen-006-candidate-preview-adoption/tasks.md#integration-evidence) for reports, blocked/cancelled attempts and checks not rerun. Real-model business and deployment acceptance remain separate.

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
| GitHub Actions workflows or CI failures | [CI scope and sources](docs/engineering/verification.md#github-actions), then the affected check and workflow |

Implementation rules live in [Development conventions](docs/engineering/development.md). UI rules are reached through [DESIGN.md](DESIGN.md) and the existing design skill; update the owning contract when rules change rather than copying them into this map.

## Skill routing

- For interactive browser verification, read the repository [Playwright skill](.agents/skills/playwright/SKILL.md) directly, then use the project entry and artifact paths in [skills.md](docs/engineering/skills.md#browser-verification). Keep `pnpm smoke` as the existing regression check; do not add a test framework just to use this skill.
- All repository skills live in `.agents/skills/<name>/SKILL.md`, including design, Git, browser and OpenSpec skills. Use this one source from every coding agent; do not create tool-specific copies. If a host needs a path adapter, point it here.
- Before following an OpenSpec workflow, read `.agents/skills/openspec-<workflow>/SKILL.md`, using the exact names in the OpenSpec guide. Same-named global skills may differ or override discovery. Preserve the selected repository workflow's planning and implementation boundaries.
- For an authorized commit, load [git-commit](.agents/skills/git-commit/SKILL.md). Before staging, group changes by concrete purpose and follow the [commit granularity and message rules](docs/engineering/git-workflow.md#changes-and-commits); each message must identify the specific changes rather than only a broad feature.
- Default to committing directly on `main` in this shared workspace. Do not create or switch task branches, or create worktrees, unless the user explicitly requests that workflow. Preserve concurrent work through file/patch staging; if the current branch is not `main`, inspect ownership before changing it.
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
pnpm verify
pnpm openspec list --json
```

The independent development commands use separate terminals; [manager.sh](manager.sh) provides setup, diagnostics, lifecycle commands and application logs after the [lifecycle prerequisites](docs/engineering/lifecycle.md#manager-commands). `infra start/stop/status` is available as an explicit no-configuration result; actual infrastructure integration remains future work. Do not mix manager and native operations on the same instance. Select verification by change scope using the verification guide.

`pnpm verify` runs the full local acceptance sequence; read its [prerequisites and coverage](docs/engineering/verification.md#integrated-local-acceptance) first. Keep port-using suites sequential. Daily focused checks remain selected by the change matrix.

## Always-on boundaries

- Keep applications separated by HTTP under `/api`; never import backend implementation into the browser or expose backend credentials to previews.
- Keep TypeScript strict and validate untrusted data at runtime. Follow the development guide for parsing, network errors, logging, and future storage or generation work.
- Add dependencies and modules for a concrete current need; do not create empty service directories or speculative abstractions.
- Record actual activity and observed verification results. Never simulate model work or report generation, persistence, preview, or deployment as validated without evidence.
- Original notes at `docs/product/assignment.md`, when locally available, remain private reference material excluded from version control. Do not copy their contents into public documents.
- Do not commit secrets or local tool output. Commit, push, create PRs, merge, or publish only within the user's authorized scope; do not request the same authorization again while it remains valid.
