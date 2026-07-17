import fs from "fs";
import path from "path";
import { SESSION_BINDINGS_FILE, SYLPH_DIR } from "./config.ts";

export interface SessionDirectoryBinding {
  directoryId: string;
  name: string;
  /** Actual checkout used by this session (source checkout or managed worktree). */
  path: string;
  branch?: string;
  baseBranch?: string;
  worktreeRoot?: string;
}

export interface SessionBinding {
  sessionId: string;
  projectId: string;
  /** Per-chat starting root for relative commands; not the workspace authorization boundary. */
  directoryId?: string;
  cwd: string;
  /** Every first-class root used by the session. */
  directories?: SessionDirectoryBinding[];
  sessionFile?: string;
  branch?: string;
  baseBranch?: string;
  worktree?: boolean;
  managedWorktreeRoot?: string;
  /** Legacy singular worktree metadata above is retained for old session migration. */
  /** Permission fingerprints approved for the lifetime of this session. */
  permissionApprovals?: string[];
}

function ensureStore() {
  fs.mkdirSync(SYLPH_DIR, { recursive: true });
  if (!fs.existsSync(SESSION_BINDINGS_FILE)) {
    fs.writeFileSync(SESSION_BINDINGS_FILE, JSON.stringify([]));
  }
}

export function getSessionBindings(): SessionBinding[] {
  ensureStore();
  try {
    const value = JSON.parse(fs.readFileSync(SESSION_BINDINGS_FILE, "utf-8"));
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

export function getSessionBinding(sessionId: unknown): SessionBinding | undefined {
  if (typeof sessionId !== "string") return undefined;
  return getSessionBindings().find((binding) => binding.sessionId === sessionId);
}

export function getProjectSessionBindings(projectId: unknown): SessionBinding[] {
  if (typeof projectId !== "string") return [];
  return getSessionBindings().filter((binding) => binding.projectId === projectId);
}

function writeSessionBindings(bindings: SessionBinding[]) {
  ensureStore();
  const temporary = `${SESSION_BINDINGS_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(bindings, null, 2));
  fs.renameSync(temporary, SESSION_BINDINGS_FILE);
}

export function saveSessionBinding(binding: SessionBinding) {
  const bindings = getSessionBindings();
  const index = bindings.findIndex((entry) => entry.sessionId === binding.sessionId);
  if (index >= 0) bindings[index] = binding;
  else bindings.push(binding);
  writeSessionBindings(bindings);
}

export function deleteSessionBinding(sessionId: unknown) {
  if (typeof sessionId !== "string") return;
  writeSessionBindings(getSessionBindings().filter((binding) => binding.sessionId !== sessionId));
}

export function sessionProjectPath(projectPath: string, binding: SessionBinding | undefined) {
  return binding ? { path: path.resolve(binding.cwd) } : { path: path.resolve(projectPath) };
}
