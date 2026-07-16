import path from "path";
import os from "os";

export const HOST = process.env.HOST || "0.0.0.0";
export const PORT = Number(process.env.PORT) || 3001;
export const ALLOWED_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "0.0.0.0"]);
export const RUNTIME_IDLE_MS = 30 * 60 * 1000;
export const EVICTION_INTERVAL_MS = 5 * 60 * 1000;

export const SYLPH_DIR = path.join(os.homedir(), ".sylph");
export const PROJECTS_FILE = path.join(SYLPH_DIR, "projects.json");
export const SESSION_BINDINGS_FILE = path.join(SYLPH_DIR, "session-bindings.json");
export const WORKTREES_DIR = path.join(SYLPH_DIR, "worktrees");
