import fs from "fs";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import type { SessionBinding, SessionDirectoryBinding } from "./sessionBindings.ts";
import { getSessionBinding, getSessionBindings, saveSessionBinding } from "./sessionBindings.ts";

export const SYLPH_WORKSPACE_ENTRY_TYPE = "sylph.workspace";
export const SYLPH_WORKSPACE_METADATA_VERSION = 1;

export interface SylphWorkspaceMetadata {
  version: 1;
  projectId?: string;
  directoryId?: string;
  cwd: string;
  directories?: SessionDirectoryBinding[];
  branch?: string;
  baseBranch?: string;
  worktree?: boolean;
  managedWorktreeRoot?: string;
}

function validDirectory(value: unknown): value is SessionDirectoryBinding {
  if (!value || typeof value !== "object") return false;
  const directory = value as Record<string, unknown>;
  return typeof directory.directoryId === "string"
    && typeof directory.name === "string"
    && (directory.sourcePath === undefined || typeof directory.sourcePath === "string")
    && typeof directory.path === "string"
    && (directory.branch === undefined || typeof directory.branch === "string")
    && (directory.baseBranch === undefined || typeof directory.baseBranch === "string")
    && (directory.worktreeRoot === undefined || typeof directory.worktreeRoot === "string");
}

function parseMetadata(value: unknown): SylphWorkspaceMetadata | undefined {
  if (!value || typeof value !== "object") return undefined;
  const metadata = value as Record<string, unknown>;
  if (metadata.version !== SYLPH_WORKSPACE_METADATA_VERSION
    || (metadata.projectId !== undefined && typeof metadata.projectId !== "string")
    || typeof metadata.cwd !== "string"
    || (metadata.directoryId !== undefined && typeof metadata.directoryId !== "string")
    || (metadata.directories !== undefined && (!Array.isArray(metadata.directories) || !metadata.directories.every(validDirectory)))
    || (metadata.branch !== undefined && typeof metadata.branch !== "string")
    || (metadata.baseBranch !== undefined && typeof metadata.baseBranch !== "string")
    || (metadata.worktree !== undefined && typeof metadata.worktree !== "boolean")
    || (metadata.managedWorktreeRoot !== undefined && typeof metadata.managedWorktreeRoot !== "string")) return undefined;
  return metadata as unknown as SylphWorkspaceMetadata;
}

export function workspaceMetadataFromBinding(binding: SessionBinding): SylphWorkspaceMetadata {
  return {
    version: SYLPH_WORKSPACE_METADATA_VERSION,
    ...(binding.projectId ? { projectId: binding.projectId } : {}),
    ...(binding.directoryId ? { directoryId: binding.directoryId } : {}),
    cwd: binding.cwd,
    ...(binding.directories?.length ? { directories: binding.directories } : {}),
    ...(binding.branch ? { branch: binding.branch } : {}),
    ...(binding.baseBranch ? { baseBranch: binding.baseBranch } : {}),
    ...(binding.worktree !== undefined ? { worktree: binding.worktree } : {}),
    ...(binding.managedWorktreeRoot ? { managedWorktreeRoot: binding.managedWorktreeRoot } : {}),
  };
}

export function appendWorkspaceMetadata(sessionManager: SessionManager, binding: SessionBinding) {
  return sessionManager.appendCustomEntry(SYLPH_WORKSPACE_ENTRY_TYPE, workspaceMetadataFromBinding(binding));
}

/** Return the latest valid Sylph workspace entry; Pi sessions are append-only. */
export function getWorkspaceMetadata(sessionManager: SessionManager): SylphWorkspaceMetadata | undefined {
  const entries = sessionManager.getEntries();
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index];
    if (entry.type !== "custom" || entry.customType !== SYLPH_WORKSPACE_ENTRY_TYPE) continue;
    const metadata = parseMetadata(entry.data);
    if (metadata) return metadata;
  }
  return undefined;
}

/**
 * Make embedded Pi metadata authoritative while retaining index-only fields
 * that do not belong in the portable session (sessionFile and approvals).
 */
export function reconcileSessionBinding(sessionManager: SessionManager, sessionFile = sessionManager.getSessionFile()): SessionBinding | undefined {
  const metadata = getWorkspaceMetadata(sessionManager);
  if (!metadata) return getSessionBinding(sessionManager.getSessionId());
  const existing = getSessionBinding(sessionManager.getSessionId());
  const binding: SessionBinding = {
    sessionId: sessionManager.getSessionId(),
    ...(metadata.projectId ? { projectId: metadata.projectId } : {}),
    ...(metadata.directoryId ? { directoryId: metadata.directoryId } : {}),
    cwd: metadata.cwd,
    ...(metadata.directories?.length ? { directories: metadata.directories } : {}),
    ...(sessionFile ? { sessionFile } : existing?.sessionFile ? { sessionFile: existing.sessionFile } : {}),
    ...(metadata.branch ? { branch: metadata.branch } : {}),
    ...(metadata.baseBranch ? { baseBranch: metadata.baseBranch } : {}),
    ...(metadata.worktree !== undefined ? { worktree: metadata.worktree } : {}),
    ...(metadata.managedWorktreeRoot ? { managedWorktreeRoot: metadata.managedWorktreeRoot } : {}),
    ...(existing?.permissionApprovals?.length ? { permissionApprovals: existing.permissionApprovals } : {}),
  };
  if (JSON.stringify(existing) !== JSON.stringify(binding)) saveSessionBinding(binding);
  return binding;
}

let recoveryPromise: Promise<void> | undefined;

async function recoverBindingIndex() {
  const sessions = await SessionManager.listAll();
  for (const session of sessions) {
    if (!fs.existsSync(session.path)) continue;
    try {
      const manager = SessionManager.open(session.path);
      if (getWorkspaceMetadata(manager)) reconcileSessionBinding(manager, session.path);
    } catch { /* one malformed/unreadable Pi session must not hide the rest */ }
  }
}

/**
 * Rebuild or repair the binding index from Pi session files. Custom entries
 * are not exposed by SessionManager.list(), so scan all Pi sessions once per
 * server process and use the repaired index for subsequent project listings.
 */
export async function recoverSessionBindingsFromPi(projectId?: string): Promise<SessionBinding[]> {
  if (!recoveryPromise) {
    recoveryPromise = recoverBindingIndex().catch((error) => {
      recoveryPromise = undefined;
      throw error;
    });
  }
  await recoveryPromise;
  const bindings = getSessionBindings();
  return projectId ? bindings.filter((binding) => binding.projectId === projectId) : bindings;
}
