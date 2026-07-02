# sylph

A local web UI for the [pi coding agent](https://www.npmjs.com/package/@earendil-works/pi-coding-agent). Chat with a coding agent across multiple projects, with streamed responses, tool-call output, session history, model selection, and slash-command autocomplete.

## Architecture

- `server.ts` — Express backend (port 3001, localhost only). Wraps `@earendil-works/pi-coding-agent`: manages projects (`~/.sylph/projects.json`), creates/resumes agent sessions, and broadcasts agent events to the browser over SSE (`/api/stream`).
- `src/` — SolidJS frontend (Vite, port 5173). `/api/*` requests are proxied to the backend (see `vite.config.ts`).

## Setup

Requires Node 20+ and a configured pi agent (auth/models in the agent dir, e.g. `~/.pi`).

```bash
npm install
npm run dev   # starts vite + backend concurrently
```

Open http://localhost:5173, add a project (any directory on disk), and start chatting.

## Scripts

- `npm run dev` — dev mode (vite + `tsx server.ts`)
- `npm run build` — type-check and build frontend to `dist/`
- `npm run preview` — preview the production build

## Notes

- The backend binds to `127.0.0.1` and rejects non-local `Host` headers. It intentionally has no auth — do not expose it beyond localhost, as it can read the filesystem and run an agent in any project directory.
- Idle agent runtimes are evicted from memory after 30 minutes; sessions themselves are persisted by the agent SDK and can be resumed anytime.
