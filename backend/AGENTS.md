# Backend guide

Applies to `backend/` and supplements the [repository map](../AGENTS.md). Repository boundaries and user authorization still apply. Source-map paths below are relative to `backend/`; commands run from the repository root.

## Choose the relevant guidance

| Change | Read |
| --- | --- |
| Routes, request parsing, or response contracts | [HTTP and runtime validation](../docs/engineering/development.md#http-and-runtime-validation) |
| Environment, logging, or errors | [Configuration and logging](../docs/engineering/development.md#configuration-and-logging) |
| Listening, shutdown, cancellation, or process behavior | [Lifecycle](../docs/engineering/lifecycle.md) and applicable [verification scenarios](../docs/engineering/verification.md#lifecycle-scenarios) |
| First model or generated-file implementation | [Generation boundaries](../docs/engineering/development.md#generation-when-implemented) |
| First database or migration implementation | [Persistence boundaries](../docs/engineering/development.md#persistence-when-implemented) |
| Dependencies or shared code | [Monorepo contract](../docs/architecture/monorepo.md) |
| Checks and handoff | [Verification](../docs/engineering/verification.md) |

For changes to a public HTTP contract, also read the [frontend guide](../frontend/AGENTS.md) and inspect affected browser clients.

## Source map and local boundaries

- `src/app.ts` constructs Fastify and registers routes without listening; behavior tests build applications through this entry.
- `src/server.ts` loads environment configuration, listens, and handles process shutdown. Keep listening and process-signal effects out of application construction and tests that only need injection.
- `src/config.ts` parses configuration at the boundary. Pass validated values to application behavior instead of scattering unparsed environment reads through handlers.
- `src/model/config.ts` validates model settings lazily at explicit invocation; `client.ts` owns bounded single-step Responses calls, deadlines, cancellation and safe failures. `probe-cases.ts` contains public in-memory examples; runner/CLI report capability evidence without an HTTP endpoint. See [model verification](../docs/engineering/verification.md#model-access).
- `src/generation/` owns strict internal generation contracts, frozen-snapshot tools, explicit bounded orchestration and isolated smoke. It consumes the model/store modules; manager.ts owns active execution and stream.ts owns bounded SSE transport. Candidate save is unverified and does not adopt a version; see [generation boundaries](../docs/engineering/development.md#bounded-generation).
- `src/routes/` owns HTTP routing and contracts. Keep generated-file work, model execution, and database access in concrete modules when those features are first implemented.
- `@atoms/contracts` owns shared public session/template/project/message/version/snapshot/adoption/run/SSE schemas; `src/contracts/` re-exports them and retains backend-only trusted-catalog constraints. `src/storage/` owns file migrations and synchronous short transactions; `src/templates/` loads the backend's prepared catalog. Project route tests explicitly inject a store/catalog; bare buildApp does not open a database. The application stops active runs in preClose, then closes an injected store and releases optional service ownership in onClose.
- `src/routes/versions.ts` owns version reading, conditional adoption and historical restoration; restore uses the real generation manager's writable/activity checks. See [Candidate review](../docs/engineering/development.md#candidate-review) and [Version restoration](../docs/engineering/development.md#version-restoration).
- `test/` contains Node test-runner behavior tests using Fastify injection. Preserve the production build's exclusion of test sources and the existing NodeNext `.js` import convention.
- Use the backend's structured logger and the logging contract. Untrusted input and provider output require runtime validation; compiler types are insufficient.
- Generated code must execute outside the host backend process and receive no backend credentials. Persistence, bounded generation, public stream/query/cancel, version reading/adoption and the browser workspace are implemented. Never turn fixture records into claimed real-provider activity or candidate saves into preview success.

## Available commands

```sh
pnpm dev:backend
pnpm --filter @atoms/backend typecheck
pnpm --filter @atoms/backend test
pnpm --filter @atoms/backend build
pnpm model:probe --help
pnpm model:probe:built --help
pnpm generation:smoke --help
pnpm generation:smoke:built --help
```

Dev/build/typecheck/test and source generation:smoke automatically prepare shared contracts and required template assets. After building, `pnpm --filter @atoms/backend start` runs the production entry without compiling contracts. Production must include the shared package and its runtime dependencies; see [Shared contract build](../docs/architecture/monorepo.md#shared-contract-build). Configuration loading depends on the application working directory; use the workspace commands rather than bypassing that setup.

Choose final checks from the central verification guide. Injection is suitable for HTTP and configuration behavior; streaming, cancellation, timeouts, and shutdown require running-server tests. When commands or environment variables change, update README, the relevant template, and lifecycle documentation.
