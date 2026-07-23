# Backend architecture

The backend uses feature-first modules with a small composition root.

## Top-level boundaries

- `index.ts` — process startup only: construct the dashboard proxy, start timers, and listen.
- `app.ts` — create the Express application.
- `config.ts` — environment and data-path constants.
- `features/` — product behavior grouped by capability. A feature owns its routes, services, repositories, types, and tests.
- `integrations/` — adapters for external runtimes and SDKs. Pi and agent-browser implementation details live here. Pi extensions are adapters under `integrations/pi/extensions/`; the feature policy/use case they expose remains under `features/`.
- `platform/` — feature-independent primitives for HTTP, events, and local persistence.

## Dependency direction

```text
index/app -> platform HTTP composition -> feature routes -> feature services
                                                |               |
                                                v               v
                                             platform      integrations
```

- Route modules are HTTP adapters. They do not access the filesystem, spawn processes, or import Pi SDK/runtime internals.
- Services coordinate use cases and may call repositories, other feature public APIs, platform primitives, or integrations.
- Repositories own persistence and normalization.
- Platform code does not import features or integrations, except for the explicit `apiRouter.ts` composition root.
- Integrations may consume feature ports and configuration where constructing an external runtime requires it; they must not absorb feature policy, persistence, audit writing, prompt construction, or filesystem lifecycle logic. `runtimeFactory.ts` is enforced as a small, filesystem-free Pi composition adapter.
- Backend imports whose package specifier starts with `@earendil-works/` are restricted to `server/integrations/pi/`. Features and tests consume Sylph-owned gateways such as `sessionSdk.ts`, `modelSdk.ts`, runtime services, and extension adapters instead of importing the vendor packages directly.
- A capability can be both a feature and externally exposed as an extension. Artifacts own storage/presentation under `features/artifacts/`, permissions own policy under `features/permissions/`, and questions own answer formatting plus interruption recovery under `features/questions/`. Their Pi schemas, hooks, tools, and result translation live under `integrations/pi/extensions/`.

`npm run check:architecture` enforces the route, platform, import-time side-effect, composition-root, and import-cycle rules.

## Session subdomains

The session capability is large enough to use a second level of feature grouping:

- `features/sessions/lifecycle/` — create/resume workflows, the vendor-neutral session-history port, list/open/move/delete/abort, detail recovery, and session HTTP routes.
- `features/sessions/workspace/` — workspace bindings, embedded metadata, attached folders, and project views.
- `features/sessions/worktrees/` — managed worktree creation, removal, recreation, and HTTP routes.
- `features/sessions/scratch/` — private scratch/artifact environment lifecycle.
- `features/sessions/runtime/` — vendor-neutral runtime configuration, project context, and workspace prompts.

The architecture check rejects new TypeScript files directly under `features/sessions/`; new behavior must have an explicit subdomain owner. `integrations/pi/runtime/sessionResolver.ts` is constrained to thin orchestration: it selects the feature-owned create/resume workflow, builds the runtime, reconciles metadata, and subscribes the Pi event adapter.

## Domain types

Domain models live in `*Types.ts` modules rather than repositories. Repositories import and persist those models; services, integrations, and tests import types directly from the domain module. Architecture checks reject type imports from repository modules.

## Permission policy

The permission feature separates `permissionTypes.ts`, canonical path/sensitive-file logic in `pathPolicy.ts`, shell parsing in `shellParser.ts`, shell risk evaluation in `shellPolicy.ts`, and a small tool-call facade in `permissionPolicy.ts`.

## Extension UI

Browser interaction state is feature-owned: blocking requests live in `features/interactions/uiRequestBroker.ts`, extension statuses in `sessionStatusStore.ts`, and artifact presentation requests in the artifacts feature. `integrations/pi/ui/extensionUiAdapter.ts` only maps Pi UI methods to those stores and the SSE transport.

## Local persistence

Projects, settings, and workspace bindings use `platform/filesystem/jsonFileStore.ts`. Reads do not create files. Writes create parent directories and atomically replace the target via a same-directory temporary file.

## Adding a capability

Prefer a feature directory such as:

```text
features/example/
  exampleRoutes.ts
  exampleService.ts
  exampleRepository.ts   # only when persisted state exists
  exampleTypes.ts        # only when types are shared within the feature
  *.test.ts
```

Register its routes in `platform/http/apiRouter.ts`. Avoid generic `services/`, `utils/`, or root-level feature files; put shared code in `platform/` only after at least two features need the same feature-independent behavior.
