# sylph

A local web UI for the [pi coding agent](https://www.npmjs.com/package/@earendil-works/pi-coding-agent). Chat with a coding agent across multiple projects, with streamed responses, tool-call output, session history, model selection, and slash-command autocomplete.

## Architecture

- `server/index.ts` — Express backend entry point (port 3001). Domain HTTP handlers live under `server/routes/`, while Pi runtime construction and lifecycle live under `server/runtime/`. The backend manages projects (`~/.sylph/projects.json`), creates/resumes agent sessions, and broadcasts agent events to the browser over SSE (`/api/stream`).
- `src/app/` — SolidJS application shell.
- `src/features/` — Feature-owned UI grouped by chat, composer, sessions, projects, settings, Git, changes, and browser integration.
- `src/shared/` and `src/lib/` — Reusable UI primitives and framework-independent utilities. Vite serves the frontend on port 5173 and proxies `/api/*` to the backend (see `vite.config.ts`).
- The backend automatically starts the bundled agent-browser observability dashboard on loopback port 4848 and exposes it through Sylph's existing server at `/browser/`. Its live dashboard is embedded in the Browser tab in the right panel.

## Setup

Requires Node 24+ and a configured pi agent (auth/models in the agent dir, e.g. `~/.pi`).

```bash
npm install
npm run dev   # starts vite + backend concurrently
```

Open http://localhost:5173, add a project, choose one or more directories on disk, and start chatting.

A project can contain multiple first-class directory roots (for example, separate `frontend` and `api` repositories). Choose a starting directory when opening each chat; relative shell commands begin there, while AI context, mentions, permissions, and Git can address every root. File mentions are namespaced by alias, such as `@frontend/src/App.tsx` or `@api/src/routes.ts`.

Worktree mode is project-wide: Sylph creates one isolated Git worktree per directory, using independently selected base branches and a shared generated task branch name. Creation and rollback are atomic across roots. The Git panel includes a repository selector and always resolves operations through the session-specific checkout.

Sylph stores versioned project/workspace ownership in each Pi session as a `sylph.workspace` custom entry. `session-bindings.json` remains a fast, rebuildable index and keeps machine-local fields such as the physical session-file path and permission approvals.

Sylph embeds a native permission gate for its runtimes. Workspace roots are allowed; sensitive files and external paths require confirmation; catastrophic operations are denied; and persistent session grants are stored with the session and written to an audit log. This is an interactive policy layer, not an OS sandbox—child processes still run with the Sylph server user's operating-system permissions.

## Scripts

- `npm run dev` — dev mode (Vite + `tsx server/index.ts`)
- `npm run build` — type-check and build frontend to `dist/`
- `npm run preview` — preview the production build

## Notes

- The backend binds to `0.0.0.0` by default. It intentionally has no authentication, and both Sylph and the dashboard can control local browser sessions and agent processes — only expose them on a trusted network or behind authentication.
- Idle agent runtimes are evicted from memory after 30 minutes; sessions themselves are persisted by the agent SDK and can be resumed anytime.
