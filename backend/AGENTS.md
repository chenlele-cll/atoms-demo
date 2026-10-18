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
- `src/routes/` owns HTTP routing and contracts. Keep generated-file work, model execution, and database access in concrete modules when those features are first implemented.
- `test/` contains Node test-runner behavior tests using Fastify injection. Preserve the production build's exclusion of test sources and the existing NodeNext `.js` import convention.
- Use the backend's structured logger and the logging contract. Untrusted input and provider output require runtime validation; compiler types are insufficient.
- Generated code must execute outside the host backend process and receive no backend credentials. Database and model dependencies are not installed yet; add them with real behavior and matching verification.

## Available commands

```sh
pnpm dev:backend
pnpm --filter @atoms/backend typecheck
pnpm --filter @atoms/backend test
pnpm --filter @atoms/backend build
```

After building, `pnpm --filter @atoms/backend start` runs the production entry. Configuration loading depends on the application working directory; use the workspace commands rather than bypassing that setup.

Choose final checks from the central verification guide. Injection is suitable for HTTP and configuration behavior; streaming, cancellation, timeouts, and shutdown require running-server tests. When commands or environment variables change, update README, the relevant template, and lifecycle documentation.
